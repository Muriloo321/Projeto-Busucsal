'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { responder, montarOpcoesPonto } = require('../../server/domain/dialogo');
const { classificar } = require('../../server/domain/intencoes');

const pontosBase = [
  { id: 1, nome: 'Ponto A', ordem_na_rota: 1, sentido: 'ida', previsao: { tipo: 'ja_passou' } },
  { id: 2, nome: 'Ponto B', ordem_na_rota: 2, sentido: 'ida', previsao: { tipo: 'previsao', minutos: 8 } },
  { id: 3, nome: 'Ponto C', ordem_na_rota: 3, sentido: 'ida', previsao: { tipo: 'previsao', minutos: 12 } },
];

function estado(extra = {}) {
  return {
    status: { codigo: 'em_circulacao', motivo: 'posicao_recente', idade_s: 20 },
    veiculo: { ultima_atualizacao_local: '07:42', idade_s: 20 },
    localizacao: { texto: 'entre Ponto A e Ponto B' },
    pontos: pontosBase,
    avisos: [],
    grade: [{ horario: '06:30–22:40' }],
    ...extra,
  };
}

function conversar(texto, sessao, e = estado()) {
  const opcoesPonto = montarOpcoesPonto(e.pontos);
  const classificacao = classificar(texto, { etapa: sessao.etapa_do_dialogo, pontos: opcoesPonto });
  return responder({ classificacao, sessao, estado: e, opcoesPonto });
}

test('fluxo da Seção 5: "oi, cadê o bus?" → pergunta o ponto → "2" → previsão com horário', () => {
  const r1 = conversar('oi, cadê o bus?', { etapa_do_dialogo: 'inicio', ponto_id: null });
  assert.equal(r1.etapa, 'aguardando_ponto');
  assert.match(r1.resposta, /Em qual ponto você está\?\n1\) Ponto A\n2\) Ponto B\n3\) Ponto C/);

  const r2 = conversar('2', { etapa_do_dialogo: r1.etapa, ponto_id: r1.ponto_id });
  assert.equal(r2.etapa, 'ponto_definido');
  assert.equal(r2.ponto_id, 2);
  assert.match(r2.resposta, /^O BusUCSAL está em circulação e deve chegar ao ponto Ponto B em cerca de 8 minutos \(atualizado às 07:42\)\.\nSem avisos de atraso no momento\./);
  assert.deepEqual(r2.previsao_emitida, { ponto_id: 2, minutos: 8, idade_dados_s: 20 });
});

test('a sessão lembra o ponto: nova pergunta responde direto', () => {
  const r = conversar('quanto tempo falta?', { etapa_do_dialogo: 'ponto_definido', ponto_id: 3 });
  assert.match(r.resposta, /ponto Ponto C em cerca de 12 minutos/);
});

test('ponto já ultrapassado é informado em vez de previsão', () => {
  const r = conversar('1', { etapa_do_dialogo: 'aguardando_ponto', ponto_id: null });
  assert.match(r.resposta, /já passou pelo ponto Ponto A neste sentido/);
  assert.equal(r.previsao_emitida, null);
});

test('sem dados: não calcula previsão e informa o horário da última posição', () => {
  const e = estado({
    status: { codigo: 'sem_dados', motivo: 'posicao_vencida', idade_s: 300 },
    veiculo: { ultima_atualizacao_local: '07:37', idade_s: 300 },
    pontos: pontosBase.map((p) => ({ ...p, previsao: { tipo: 'indisponivel', motivo: 'dados_vencidos' } })),
  });
  const r = conversar('cadê o bus?', { etapa_do_dialogo: 'inicio', ponto_id: 2 }, e);
  assert.match(r.resposta, /sem dados recentes.*07:37 \(há 5 min\)/s);
  assert.doesNotMatch(r.resposta, /cerca de \d+ minuto/);
  assert.equal(r.previsao_bloqueada, true);
  assert.equal(r.previsao_emitida, null);
});

test('fora de operação por interrupção mostra o aviso', () => {
  const e = estado({
    status: { codigo: 'fora_de_operacao', motivo: 'aviso_interrupcao' },
    avisos: [{ texto: 'Ônibus em manutenção.' }],
  });
  const r = conversar('o ônibus está rodando?', { etapa_do_dialogo: 'inicio', ponto_id: null }, e);
  assert.match(r.resposta, /fora de operação: o serviço foi interrompido/);
  assert.match(r.resposta, /Aviso da equipe: Ônibus em manutenção\./);
});

test('avisos ativos acompanham a previsão', () => {
  const r = conversar('2', { etapa_do_dialogo: 'aguardando_ponto', ponto_id: null }, estado({ avisos: [{ texto: 'Atraso de 15 min.' }] }));
  assert.match(r.resposta, /cerca de 8 minutos.*\nAviso da equipe: Atraso de 15 min\./s);
});

test('intenção desconhecida mostra o menu numerado e as opções numéricas seguem o menu', () => {
  const r1 = conversar('qual o preço da passagem?', { etapa_do_dialogo: 'inicio', ponto_id: null });
  assert.equal(r1.fallback, true);
  assert.equal(r1.etapa, 'menu_principal');
  assert.match(r1.resposta, /1\) Onde está o ônibus.*\n2\) Status do serviço\n3\) Avisos da equipe\n4\) Trocar ponto/s);
  const r2 = conversar('3', { etapa_do_dialogo: 'menu_principal', ponto_id: null });
  assert.match(r2.resposta, /Sem avisos de atraso no momento\./);
  const r3 = conversar('4', { etapa_do_dialogo: 'menu_principal', ponto_id: 2 });
  assert.equal(r3.etapa, 'aguardando_ponto');
});

test('número inválido pede o ponto novamente', () => {
  const r = conversar('9', { etapa_do_dialogo: 'aguardando_ponto', ponto_id: null });
  assert.match(r.resposta, /^Não encontrei a opção 9\. Em qual ponto você está\?/);
  assert.equal(r.etapa, 'aguardando_ponto');
});

test('tempo excedido na classificação leva ao menu numerado', () => {
  const opcoesPonto = montarOpcoesPonto(pontosBase);
  const r = responder({ classificacao: { intencao: 'desconhecida', tempo_excedido: true, origem: 'tempo_excedido' }, sessao: { etapa_do_dialogo: 'inicio', ponto_id: 2 }, estado: estado(), opcoesPonto });
  assert.equal(r.fallback, true);
  assert.equal(r.ponto_id, 2); // não perde o ponto já escolhido
  assert.match(r.resposta, /^Não consegui entender sua mensagem a tempo\. Escolha uma opção/);
});
