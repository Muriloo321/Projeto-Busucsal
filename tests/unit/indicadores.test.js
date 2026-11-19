'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarContexto, gravarTrajeto } = require('../helpers/contexto');
const { avaliarHistorico, instanteChegada } = require('../../server/domain/avaliacao-previsao');

const P = { janelaVelocidadeMin: 5, velocidadeMinimaKmh: 10, raioChegadaM: 50, limiteDadosVencidosS: 180, toleranciaRetrocessoM: 80, intervaloMaxViagemMin: 10 };

/** Viagem sintética a velocidade constante (posições a cada 30 s). */
function viagem(inicio, kmh, metrosTotais, fonte = 'rastreador') {
  const passo = (kmh / 3.6) * 30;
  const pos = [];
  for (let m = 0, i = 0; m <= metrosTotais; m += passo, i += 1) {
    pos.push({ registrado_em: new Date(inicio.getTime() + i * 30000), velocidade_kmh: kmh, fonte, rota_id: 1, progresso_m: m });
  }
  return pos;
}

test('instante de chegada é interpolado entre duas posições', () => {
  const t0 = new Date('2026-11-18T13:00:00Z');
  const pos = [{ registrado_em: t0, progresso_m: 0 }, { registrado_em: new Date(t0.getTime() + 60000), progresso_m: 1000 }];
  assert.equal(instanteChegada(pos, 550, 50), t0.getTime() + 30000);
  assert.equal(instanteChegada(pos, 5000, 50), null);
});

test('velocidade constante acima do mínimo: erro médio pequeno, por arredondamento apenas', () => {
  const t0 = new Date('2026-11-18T13:00:00Z');
  const r = avaliarHistorico({ posicoes: viagem(t0, 18, 2400), pontosPorRota: new Map([[1, [{ id: 2, progresso_m: 1200 }, { id: 3, progresso_m: 2300 }]]]), parametros: P });
  assert.equal(r.viagens_avaliadas, 1);
  assert.ok(r.previsoes_avaliadas > 5);
  assert.ok(r.erro_medio_min < 0.6, `erro ${r.erro_medio_min}`);
  assert.equal(r.somente_dados_simulados, false);
});

test('separa viagens quando o progresso volta ao início e marca dados simulados', () => {
  const t0 = new Date('2026-11-18T13:00:00Z');
  const v1 = viagem(t0, 15, 2400, 'simulador');
  const v2 = viagem(new Date(v1[v1.length - 1].registrado_em.getTime() + 30000), 15, 2400, 'simulador');
  const r = avaliarHistorico({ posicoes: [...v1, ...v2], pontosPorRota: new Map([[1, [{ id: 2, progresso_m: 1200 }]]]), parametros: P });
  assert.equal(r.viagens_detectadas, 2);
  assert.equal(r.viagens_avaliadas, 2);
  assert.equal(r.somente_dados_simulados, true);
});

test('sem medições, indicadores aparecem como "ainda não aferido" — nenhum valor fixo', () => {
  const ctx = criarContexto();
  const ind = ctx.servicos.tecnico.indicadores();
  assert.equal(ind.itens.length, 5);
  for (const i of ind.itens) {
    assert.equal(i.situacao, 'nao_aferido', i.id);
    assert.equal(i.valor, null, i.id);
  }
});

test('indicadores refletem medições reais registradas', async () => {
  const ctx = criarContexto();
  await gravarTrajeto(ctx, { deM: 0, ateM: 400 });
  await ctx.servicos.conversa.processar({ identificador: 'avaliacao-01', mensagem: 'estou na portaria' });
  const [msg] = ctx.servicos.metricas.mensagensRecentes();
  ctx.servicos.tecnico.avaliarMensagem(msg.id, true);
  for (let i = 0; i < 4; i += 1) ctx.servicos.tecnico.adicionarParticipante({ turno: 'M', data: '2026-11-18' });
  const ind = Object.fromEntries(ctx.servicos.tecnico.indicadores().itens.map((i) => [i.id, i]));
  assert.equal(ind.respostas_5s.valor, '100%');
  assert.equal(ind.respostas_5s.situacao, 'atende');
  assert.equal(ind.mensagens_compreendidas.valor, '100%');
  assert.equal(ind.previsao_dado_vencido.valor, '0');
  assert.equal(ind.previsao_dado_vencido.situacao, 'atende');
  assert.equal(ind.teste_estudantes.situacao, 'em_andamento'); // só um turno e menos de 10
  assert.equal(ind.erro_previsao.situacao, 'nao_aferido');
  assert.throws(() => ctx.servicos.tecnico.adicionarParticipante({ turno: 'X', data: 'hoje' }), (e) => e.status === 400);
});

test('avaliação do histórico com menos de 10 viagens continua "não aferido"', async () => {
  const ctx = criarContexto();
  await gravarTrajeto(ctx, { deM: 0, ateM: 1500, quantidade: 12 });
  const r = await ctx.servicos.tecnico.avaliarPrevisoes();
  assert.equal(r.viagens_avaliadas, 1);
  const ind = ctx.servicos.tecnico.indicadores().itens.find((i) => i.id === 'erro_previsao');
  assert.equal(ind.situacao, 'nao_aferido');
  assert.notEqual(ind.valor, null);
});

test('conjunto interno de frases do classificador', async () => {
  const ctx = criarContexto();
  const r = await ctx.servicos.tecnico.conjuntoInterno();
  assert.equal(r.corretas, r.total);
});
