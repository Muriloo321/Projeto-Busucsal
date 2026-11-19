'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarContexto } = require('../helpers/contexto');

/** Os cenários gravam dados; o status resultante vem das regras normais. */
async function aplicar(id) {
  const ctx = criarContexto();
  const r = await ctx.servicos.cenarios.aplicar(id);
  return { ctx, r, estado: await ctx.servicos.estado.montar() };
}

test('cenário "Ônibus a caminho": em circulação com previsão para o 2º ponto', async () => {
  const { r, estado } = await aplicar('a_caminho');
  assert.equal(estado.status.codigo, 'em_circulacao');
  assert.equal(estado.pontos[1].previsao.tipo, 'previsao');
  assert.deepEqual(r.conversa.map((m) => m.texto), ['oi, cadê o bus?', '2']);
  assert.equal(r.observacao, null);
});

test('cenário "Já passou": 2º ponto ultrapassado', async () => {
  const { estado } = await aplicar('ja_passou');
  assert.equal(estado.pontos[1].previsao.tipo, 'ja_passou');
});

test('cenário "Sem sinal": sem dados e sem previsão', async () => {
  const { estado } = await aplicar('sem_sinal');
  assert.equal(estado.status.codigo, 'sem_dados');
  assert.ok(estado.pontos.every((p) => p.previsao.tipo === 'indisponivel'));
});

test('cenários "Veículo parado" e "Interrupção"', async () => {
  assert.equal((await aplicar('parado')).estado.status.codigo, 'parado');
  const { estado } = await aplicar('interrupcao');
  assert.equal(estado.status.codigo, 'fora_de_operacao');
  assert.equal(estado.avisos[0].demonstrativo, true);
});

test('limpar remove apenas dados não reais', async () => {
  const { ctx } = await aplicar('aviso_equipe');
  await ctx.repos.posicao.inserir({ dispositivo_id: 'busucsal-01', latitude: -12.96, longitude: -38.41, velocidade_kmh: 10, registrado_em: new Date('2026-11-18T12:00:00Z'), fonte: 'rastreador' });
  await ctx.servicos.cenarios.aplicar('restaurar');
  assert.deepEqual(ctx.repos._dados.posicoes.map((p) => p.fonte), ['rastreador']);
  assert.equal(ctx.repos._dados.avisos.length, 0);
});

test('fora da grade, o cenário avisa que o status será "Fora de operação"', async () => {
  const ctx = criarContexto({ instante: new Date('2026-11-19T03:00:00Z') });
  const r = await ctx.servicos.cenarios.aplicar('a_caminho');
  assert.match(r.observacao, /fora da grade/);
  assert.equal((await ctx.servicos.estado.montar()).status.codigo, 'fora_de_operacao');
});

test('simulador integrado envia posições por HTTP para /api/posicao com o token', async () => {
  const chamadas = [];
  const fetchFalso = async (url, opcoes) => { chamadas.push({ url, opcoes }); return { ok: true, status: 200 }; };
  const ctx = criarContexto({ fetchImpl: fetchFalso });
  const s = await ctx.servicos.simulador.iniciar({ modo: 'tempo_real', velocidade_kmh: 18 });
  ctx.servicos.simulador.parar();
  assert.equal(s.intervalo_s, 30);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, 'http://127.0.0.1:3000/api/posicao');
  assert.equal(chamadas[0].opcoes.headers['x-device-token'], ctx.config.rastreador.token);
  const corpo = JSON.parse(chamadas[0].opcoes.body);
  assert.equal(corpo.fonte, 'simulador');
  assert.equal(corpo.dispositivo_id, 'busucsal-01');
  const acelerado = await ctx.servicos.simulador.iniciar({ modo: 'acelerado' });
  ctx.servicos.simulador.parar();
  assert.equal(acelerado.intervalo_s, 2);
  assert.equal(JSON.parse(chamadas[1].opcoes.body).fonte, 'simulador_acelerado');
  await assert.rejects(ctx.servicos.simulador.iniciar({ modo: 'turbo' }), (e) => e.status === 400);
});
