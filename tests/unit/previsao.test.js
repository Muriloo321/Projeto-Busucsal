'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mediaVelocidade, calcularPrevisao } = require('../../server/domain/previsao');
const { descreverLocalizacao } = require('../../server/domain/localizacao');

const P = { limiteDadosVencidosS: 180, velocidadeMinimaKmh: 10, raioChegadaM: 50 };
const base = { statusCodigo: 'em_circulacao', idadeDadosS: 20, mesmoSentido: true, parametros: P };

test('previsão usa a distância ao longo da rota (progresso), não a linha reta', () => {
  // Ônibus a 400 m do início; ponto a 1.400 m pela rota → faltam 1.000 m. A 12 km/h: 5 min.
  const r = calcularPrevisao({ ...base, progressoOnibusM: 400, progressoPontoM: 1400, velocidadeMediaKmh: 12 });
  assert.equal(r.tipo, 'previsao');
  assert.equal(r.distancia_rota_m, 1000);
  assert.equal(r.minutos, 5);
  assert.equal(r.velocidade_minima_aplicada, false);
});

test('reconhece o exemplo do planejamento: 1,6 km a 12 km/h ≈ 8 minutos', () => {
  const r = calcularPrevisao({ ...base, progressoOnibusM: 200, progressoPontoM: 1800, velocidadeMediaKmh: 12 });
  assert.equal(r.minutos, 8);
});

test('identifica ponto já ultrapassado naquele sentido', () => {
  const r = calcularPrevisao({ ...base, progressoOnibusM: 1500, progressoPontoM: 1169, velocidadeMediaKmh: 20 });
  assert.equal(r.tipo, 'ja_passou');
  assert.ok(r.distancia_rota_m > 300);
});

test('dentro do raio de chegada informa "chegando ao ponto"', () => {
  assert.equal(calcularPrevisao({ ...base, progressoOnibusM: 1150, progressoPontoM: 1169, velocidadeMediaKmh: 20 }).tipo, 'no_ponto');
  assert.equal(calcularPrevisao({ ...base, progressoOnibusM: 1190, progressoPontoM: 1169, velocidadeMediaKmh: 20 }).tipo, 'no_ponto');
});

test('aplica velocidade mínima para evitar previsão infinita', () => {
  const parado = calcularPrevisao({ ...base, progressoOnibusM: 0, progressoPontoM: 1000, velocidadeMediaKmh: 0 });
  assert.equal(parado.tipo, 'previsao');
  assert.equal(parado.velocidade_usada_kmh, 10);
  assert.equal(parado.velocidade_minima_aplicada, true);
  assert.equal(parado.minutos, 6);
  const semAmostras = calcularPrevisao({ ...base, progressoOnibusM: 0, progressoPontoM: 1000, velocidadeMediaKmh: null });
  assert.equal(semAmostras.velocidade_usada_kmh, 10);
});

test('previsão aproximada nunca é menor que 1 minuto', () => {
  const r = calcularPrevisao({ ...base, progressoOnibusM: 0, progressoPontoM: 60, velocidadeMediaKmh: 40 });
  assert.equal(r.minutos, 1);
});

test('bloqueia previsão com dado vencido, mesmo se o status ainda disser em circulação', () => {
  const r = calcularPrevisao({ ...base, idadeDadosS: 181, progressoOnibusM: 0, progressoPontoM: 1000, velocidadeMediaKmh: 20 });
  assert.deepEqual(r, { tipo: 'indisponivel', motivo: 'dados_vencidos' });
  assert.equal(calcularPrevisao({ ...base, statusCodigo: 'sem_dados', progressoOnibusM: 0, progressoPontoM: 1000 }).motivo, 'dados_vencidos');
  assert.equal(calcularPrevisao({ ...base, idadeDadosS: null, progressoOnibusM: 0, progressoPontoM: 1000 }).motivo, 'dados_vencidos');
});

test('fora de operação, fora do trajeto e outro sentido não geram previsão', () => {
  assert.equal(calcularPrevisao({ ...base, statusCodigo: 'fora_de_operacao', progressoOnibusM: 0, progressoPontoM: 1000 }).motivo, 'fora_de_operacao');
  assert.equal(calcularPrevisao({ ...base, progressoOnibusM: null, progressoPontoM: 1000 }).motivo, 'onibus_fora_do_trajeto');
  assert.equal(calcularPrevisao({ ...base, mesmoSentido: false, progressoOnibusM: 0, progressoPontoM: 1000 }).motivo, 'outro_sentido');
  assert.equal(calcularPrevisao({ ...base, progressoOnibusM: 0, progressoPontoM: null }).motivo, 'ponto_fora_do_trajeto');
});

test('velocidade média considera só as posições dos últimos 5 minutos', () => {
  const agora = new Date('2026-11-18T13:00:00Z');
  const em = (s) => new Date(agora.getTime() - s * 1000);
  const posicoes = [
    { registrado_em: em(400), velocidade_kmh: 60 }, // fora da janela
    { registrado_em: em(240), velocidade_kmh: 10 },
    { registrado_em: em(120), velocidade_kmh: 20 },
    { registrado_em: em(0), velocidade_kmh: 30 },
    { registrado_em: em(60), velocidade_kmh: null }, // ignorada
  ];
  assert.deepEqual(mediaVelocidade(posicoes, agora, 5), { media_kmh: 20, amostras: 3 });
  assert.deepEqual(mediaVelocidade([], agora, 5), { media_kmh: null, amostras: 0 });
});

test('descreve a localização entre pontos sem expor coordenadas', () => {
  const pontos = [
    { id: 1, nome: 'A', ordem_na_rota: 1, progresso_m: 0 },
    { id: 2, nome: 'B', ordem_na_rota: 2, progresso_m: 1000 },
    { id: 3, nome: 'C', ordem_na_rota: 3, progresso_m: 2000 },
  ];
  assert.equal(descreverLocalizacao(500, pontos, 50).texto, 'entre A e B');
  assert.equal(descreverLocalizacao(1010, pontos, 50).texto, 'no ponto B');
  assert.equal(descreverLocalizacao(1010, pontos, 50).proximo_ponto.id, 3);
  assert.equal(descreverLocalizacao(2500, pontos, 50).tipo, 'apos_ultimo');
  assert.equal(descreverLocalizacao(null, pontos, 50).tipo, 'desconhecida');
});
