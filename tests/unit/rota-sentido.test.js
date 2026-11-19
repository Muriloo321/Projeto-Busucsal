'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escolherRota } = require('../../server/domain/rota-sentido');

const P = { toleranciaRetrocessoM: 80 };
// Ida e volta pelas mesmas ruas: o mesmo ponto físico tem progressos diferentes em cada sentido.
const ida = (progresso, distancia = 10) => ({ rota_id: 1, sentido: 'ida', distancia_m: distancia, progresso_m: progresso });
const volta = (progresso, distancia = 12) => ({ rota_id: 2, sentido: 'volta', distancia_m: distancia, progresso_m: progresso });
const ambas = new Set([1, 2]);

test('sem histórico escolhe a rota mais próxima', () => {
  assert.equal(escolherRota({ candidatos: [volta(300, 30), ida(900, 5)], anterior: null, idsNaGrade: ambas, parametros: P }).candidato.rota_id, 1);
});

test('mantém o sentido enquanto o progresso avança', () => {
  const r = escolherRota({ candidatos: [ida(1200, 15), volta(1300, 5)], anterior: { rota_id: 1, progresso_m: 1100 }, idsNaGrade: ambas, parametros: P });
  assert.equal(r.candidato.rota_id, 1);
  assert.equal(r.nova_viagem, false);
});

test('tolera pequeno retrocesso causado por ruído do GPS', () => {
  const r = escolherRota({ candidatos: [ida(1050), volta(1400)], anterior: { rota_id: 1, progresso_m: 1100 }, idsNaGrade: ambas, parametros: P });
  assert.equal(r.candidato.rota_id, 1);
});

test('troca de sentido quando o progresso retrocede além da tolerância', () => {
  const r = escolherRota({ candidatos: [ida(800), volta(1700)], anterior: { rota_id: 1, progresso_m: 1100 }, idsNaGrade: ambas, parametros: P });
  assert.equal(r.candidato.rota_id, 2);
  assert.equal(r.nova_viagem, true);
});

test('única rota: retrocesso grande significa nova viagem no mesmo trajeto', () => {
  const r = escolherRota({ candidatos: [ida(20)], anterior: { rota_id: 1, progresso_m: 2500 }, idsNaGrade: new Set([1]), parametros: P });
  assert.equal(r.candidato.rota_id, 1);
  assert.equal(r.nova_viagem, true);
});

test('prefere rotas dentro da grade de horários', () => {
  const r = escolherRota({ candidatos: [ida(100, 5), volta(100, 20)], anterior: null, idsNaGrade: new Set([2]), parametros: P });
  assert.equal(r.candidato.rota_id, 2);
});

test('sem candidatos dentro da tolerância: fora do trajeto', () => {
  assert.equal(escolherRota({ candidatos: [], anterior: null, idsNaGrade: ambas, parametros: P }).candidato, null);
});
