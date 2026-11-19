'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../server/domain/validacao');
const { normalizarPayloadPosicao } = require('../../server/domain/traccar');

const agora = new Date('2026-11-18T13:00:00Z');
const LIM = { agora, velocidadeMaxKmh: 130, futuroMaxS: 120, passadoMaxH: 72 };
const pos = (extra) => V.validarPosicao(normalizarPayloadPosicao({ body: { dispositivo_id: 'busucsal-01', latitude: -12.96, longitude: -38.41, velocidade_kmh: 20, ...extra } }), LIM);
const campos = (r) => r.erros.map((e) => e.campo);

test('posição válida é normalizada', () => {
  const r = pos({ registrado_em: '2026-11-18T12:59:30Z' });
  assert.equal(r.valido, true);
  assert.equal(r.valor.fonte, 'rastreador');
  assert.equal(r.valor.registrado_em.toISOString(), '2026-11-18T12:59:30.000Z');
});

test('valida coordenadas', () => {
  assert.deepEqual(campos(pos({ latitude: 91 })), ['latitude']);
  assert.deepEqual(campos(pos({ longitude: -181 })), ['longitude']);
  assert.deepEqual(campos(pos({ latitude: 'abc' })), ['latitude']);
  assert.deepEqual(campos(pos({ latitude: 0, longitude: 0 })), ['latitude']);
  assert.equal(pos({ latitude: '-12.96' }).valido, true); // texto numérico (formulário/OsmAnd) é aceito
  assert.equal(pos({ latitude: true }).valido, false);
});

test('valida velocidade', () => {
  assert.deepEqual(campos(pos({ velocidade_kmh: -1 })), ['velocidade_kmh']);
  assert.deepEqual(campos(pos({ velocidade_kmh: 131 })), ['velocidade_kmh']);
  assert.deepEqual(campos(pos({ velocidade_kmh: 'rápido' })), ['velocidade_kmh']);
  assert.equal(pos({ velocidade_kmh: undefined }).valor.velocidade_kmh, null);
});

test('valida instante da posição, dispositivo e fonte', () => {
  assert.deepEqual(campos(pos({ registrado_em: '2026-11-18T13:05:00Z' })), ['registrado_em']); // futuro
  assert.deepEqual(campos(pos({ registrado_em: '2026-11-10T13:00:00Z' })), ['registrado_em']); // > 72 h
  assert.deepEqual(campos(pos({ registrado_em: 'ontem' })), ['registrado_em']);
  assert.deepEqual(campos(pos({ dispositivo_id: 'com espaço' })), ['dispositivo_id']);
  assert.deepEqual(campos(pos({ fonte: 'cenario_demo' })), ['fonte']); // reservado para uso interno
  assert.equal(V.validarPosicao(normalizarPayloadPosicao({ body: {} }), LIM).valido, false);
});

test('aviso exige texto, início e fim com fuso; fim depois do início', () => {
  const ok = V.validarAviso({ texto: '  Atraso   de 10 min ', inicio: '2026-11-18T10:00:00-03:00', fim: '2026-11-18T23:59:00-03:00' });
  assert.equal(ok.valido, true);
  assert.equal(ok.valor.texto, 'Atraso de 10 min');
  assert.equal(ok.valor.ativo, true);
  assert.equal(ok.valor.interrompe_operacao, false);
  assert.deepEqual(campos(V.validarAviso({ texto: 'oi', inicio: '2026-11-18T10:00:00Z', fim: '2026-11-18T11:00:00Z' })), ['texto']);
  assert.deepEqual(campos(V.validarAviso({ texto: 'Atraso', inicio: '2026-11-18T10:00', fim: '2026-11-18T11:00:00Z' })), ['inicio']);
  assert.deepEqual(campos(V.validarAviso({ texto: 'Atraso', inicio: '2026-11-18T12:00:00Z', fim: '2026-11-18T11:00:00Z' })), ['fim']);
  assert.deepEqual(campos(V.validarAviso({ texto: 'Atraso', inicio: '2026-11-18T10:00:00Z', fim: '2026-11-18T11:00:00Z', interrompe_operacao: 'sim' })), ['interrompe_operacao']);
  assert.deepEqual(campos(V.validarAviso({ texto: 'x'.repeat(501), inicio: '2026-11-18T10:00:00Z', fim: '2026-11-18T11:00:00Z' })), ['texto']);
  assert.equal(V.validarAviso({ ativo: false }, { parcial: true }).valido, true);
  assert.equal(V.validarAviso({}, { parcial: true }).valido, false);
});

test('ponto de embarque', () => {
  const ok = V.validarPonto({ nome: 'Portaria', latitude: -12.95, longitude: -38.41, ordem_na_rota: 3, sentido: 'ida' });
  assert.equal(ok.valido, true);
  assert.equal(ok.valor.turnos, 'M/N');
  assert.deepEqual(campos(V.validarPonto({ nome: 'P', latitude: -12.95, longitude: -38.41, ordem_na_rota: 0, sentido: 'subida', turnos: 'T' })).sort(), ['nome', 'ordem_na_rota', 'sentido', 'turnos']);
});

test('login e mensagem do simulador', () => {
  assert.equal(V.validarLogin({ email: ' Equipe@UCSAL.br ', senha: 'x' }).valor.email, 'equipe@ucsal.br');
  assert.deepEqual(campos(V.validarLogin({ email: 'sem-arroba', senha: '' })), ['email', 'senha']);
  assert.equal(V.validarMensagem({ mensagem: 'oi', sessao_local: 'abc12345-xyz' }).valido, true);
  assert.deepEqual(campos(V.validarMensagem({ mensagem: '', sessao_local: 'curto' })), ['mensagem', 'sessao_local']);
  assert.deepEqual(campos(V.validarMensagem({ mensagem: 'oi', sessao_local: 'abc12345', simular_demora_ms: 2500 })), ['simular_demora_ms']);
  assert.equal(V.validarMensagem({ mensagem: 'oi', sessao_local: 'abc12345', simular_demora_ms: 2500 }, { permitirDemora: true }).valido, true);
});
