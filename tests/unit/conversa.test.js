'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarContexto, gravarTrajeto } = require('../helpers/contexto');
const { hashUsuario } = require('../../server/utils/seguranca');

async function preparar() {
  const ctx = criarContexto();
  await gravarTrajeto(ctx, { deM: 0, ateM: 400 });
  const falar = (identificador, mensagem, extra = {}) => ctx.servicos.conversa.processar({ identificador, mensagem, ...extra });
  return { ctx, falar };
}

test('cada usuário tem a própria sessão (nada de sessão global)', async () => {
  const { ctx, falar } = await preparar();
  await falar('estudante-aaaa', 'oi, cadê o bus?');
  const b = await falar('estudante-bbbb', '2');
  assert.equal(b.etapa, 'menu_principal'); // para B, "2" não responde a nenhuma pergunta anterior
  const a = await falar('estudante-aaaa', '2');
  assert.equal(a.intencao, 'escolher_ponto');
  assert.match(a.resposta, /Av\. Pinto de Aguiar em cerca de \d+ minutos \(atualizado às 10:00\)/);
  assert.equal(ctx.repos._dados.sessoes.size, 2);
});

test('a sessão guarda etapa e ponto, e só o hash do identificador', async () => {
  const { ctx, falar } = await preparar();
  await falar('estudante-cccc', 'oi, cadê o bus?');
  await falar('estudante-cccc', '3');
  const hash = hashUsuario('simulador', 'estudante-cccc', ctx.config.hashSessaoSegredo);
  const s = ctx.repos._dados.sessoes.get(hash);
  assert.equal(s.etapa_do_dialogo, 'ponto_definido');
  assert.equal(s.ponto_id, 3);
  assert.ok(![...ctx.repos._dados.sessoes.keys()].some((k) => k.includes('estudante')));
  const r = await falar('estudante-cccc', 'quanto tempo falta?');
  assert.match(r.resposta, /Portaria Principal UCSAL/);
});

test('sessão expira e é excluída 24 horas após a criação', async () => {
  const { ctx, falar } = await preparar();
  const r1 = await falar('estudante-dddd', 'estou na portaria');
  assert.equal(r1.ponto_id, 3);
  assert.equal(new Date(r1.sessao.expira_em) - ctx.relogio.agora(), 24 * 3600 * 1000);

  ctx.relogio.avancar(23 * 3600 * 1000);
  const r2 = await falar('estudante-dddd', 'menu');
  assert.equal(r2.sessao.nova, false);
  assert.equal(r2.ponto_id, 3);

  ctx.relogio.avancar(3600 * 1000); // 24 h desde a criação
  await gravarTrajeto(ctx, { deM: 0, ateM: 400 }); // ônibus circulando de novo
  const r3 = await falar('estudante-dddd', 'quanto tempo falta?');
  assert.equal(r3.sessao.nova, true);
  assert.equal(r3.ponto_id, null); // ponto esquecido
  assert.equal(r3.etapa, 'aguardando_ponto');

  ctx.relogio.avancar(24 * 3600 * 1000);
  assert.equal(await ctx.repos.sessao.excluirExpiradas(ctx.relogio.agora()), 1);
  assert.equal(ctx.repos._dados.sessoes.size, 0);
});

test('reiniciar a conversa apaga a sessão', async () => {
  const { ctx, falar } = await preparar();
  await falar('estudante-eeee', 'oi');
  assert.equal((await ctx.servicos.conversa.reiniciar({ identificador: 'estudante-eeee' })).excluida, true);
  assert.equal(ctx.repos._dados.sessoes.size, 0);
});

test('classificação acima de 2 s mostra o menu numerado e registra métricas', async () => {
  const { ctx, falar } = await preparar();
  const r = await falar('estudante-ffff', 'será que vai demorar?', { demoraSimuladaMs: 2300 });
  assert.equal(r.fallback, true);
  assert.equal(r.origem_classificacao, 'tempo_excedido');
  assert.match(r.resposta, /^Não consegui entender sua mensagem a tempo\./);
  assert.ok(r.latencia_ms >= 1990 && r.latencia_ms < 2600);
  const m = ctx.servicos.metricas.instantaneo();
  assert.equal(m.respostas.total, 1);
  assert.equal(m.respostas.dentro_do_limite, 1);
  assert.equal(ctx.servicos.metricas.mensagensRecentes()[0].origem, 'tempo_excedido');
});

test('previsões emitidas e bloqueios por dado vencido são contados', async () => {
  const { ctx, falar } = await preparar();
  await falar('estudante-gggg', 'estou na portaria');
  ctx.relogio.avancar(200 * 1000); // sinal perdido
  const r = await falar('estudante-gggg', 'quanto tempo falta?');
  assert.doesNotMatch(r.resposta, /cerca de \d+ minuto/);
  const m = ctx.servicos.metricas.instantaneo();
  assert.equal(m.previsoes.emitidas, 1);
  assert.equal(m.previsoes.com_dado_vencido, 0);
  assert.equal(m.previsoes.bloqueadas_por_dado_vencido, 1);
});
