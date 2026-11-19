'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarPayloadPosicao, interpretarInstante } = require('../../server/domain/traccar');

test('formato JSON do simulador (velocidade já em km/h)', () => {
  const n = normalizarPayloadPosicao({ body: { dispositivo_id: 'busucsal-01', latitude: -12.96, longitude: -38.41, velocidade_kmh: 18, fonte: 'simulador' } });
  assert.equal(n.formato, 'busucsal_json');
  assert.equal(n.velocidade_kmh, 18);
  assert.equal(n.fonte, 'simulador');
});

test('formato JSON do Traccar Client: velocidade em m/s convertida para km/h', () => {
  const n = normalizarPayloadPosicao({
    body: { device_id: '123456', location: { timestamp: '2026-11-18T12:59:40.000Z', coords: { latitude: -12.96, longitude: -38.41, speed: 5, accuracy: 7 } } },
  });
  assert.equal(n.formato, 'traccar_json');
  assert.equal(n.dispositivo_id, '123456');
  assert.equal(n.velocidade_kmh, 18);
  assert.equal(n.precisao_m, 7);
  assert.equal(n.registrado_em.toISOString(), '2026-11-18T12:59:40.000Z');
  const negativa = normalizarPayloadPosicao({ body: { device_id: '1', location: { coords: { latitude: 1, longitude: 1, speed: -1 } } } });
  assert.equal(negativa.velocidade_kmh, null); // Android usa -1 para velocidade desconhecida
});

test('protocolo OsmAnd (query string): velocidade em nós e instante Unix', () => {
  const n = normalizarPayloadPosicao({ query: { id: 'busucsal-01', lat: '-12.96', lon: '-38.41', speed: '10', timestamp: '1795093200' } });
  assert.equal(n.formato, 'osmand');
  assert.equal(n.velocidade_kmh, 18.52);
  assert.equal(n.registrado_em.toISOString(), new Date(1795093200 * 1000).toISOString());
});

test('instantes em segundos, milissegundos, ISO e inválidos', () => {
  assert.equal(interpretarInstante(1795093200).getTime(), 1795093200000);
  assert.equal(interpretarInstante('1795093200000').getTime(), 1795093200000);
  assert.equal(interpretarInstante('2026-11-18T10:00:00-03:00').toISOString(), '2026-11-18T13:00:00.000Z');
  assert.equal(interpretarInstante(undefined), null);
  assert.ok(Number.isNaN(interpretarInstante('ontem').getTime()));
});

test('corpo sem coordenadas não é reconhecido', () => {
  assert.equal(normalizarPayloadPosicao({ body: { foo: 1 } }).formato, 'desconhecido');
  assert.equal(normalizarPayloadPosicao({ body: [1, 2] }).formato, 'desconhecido');
});
