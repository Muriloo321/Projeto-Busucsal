'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { motivoParaPular, prepararBanco } = require('./apoio');

const pular = motivoParaPular();

describe('PostGIS: distância ao longo da rota e integridade do schema', { skip: pular }, () => {
  let cliente;
  let pool;
  let repos;

  before(async () => {
    cliente = await prepararBanco();
    /* eslint-disable global-require */
    const { criarPool } = require('../../server/db/pool');
    const { criarRepositorios } = require('../../server/repositories');
    /* eslint-enable global-require */
    pool = criarPool(process.env.DATABASE_URL_TEST, { erro() {} });
    repos = criarRepositorios(pool);
  });

  after(async () => {
    if (pool) await pool.end();
    if (cliente) await cliente.end();
  });

  test('extensão da rota demonstrativa calculada em metros (geography)', async () => {
    const [rota] = await repos.rota.listarAtivas();
    assert.ok(rota.extensao_m > 2400 && rota.extensao_m < 2700, `extensão ${rota.extensao_m}`);
    assert.equal(rota.demonstrativa, true);
  });

  test('progresso dos pontos cresce no sentido da rota, do início ao fim do trajeto', async () => {
    const [rota] = await repos.rota.listarAtivas();
    const pontos = await repos.rota.pontosComProgresso(rota.id);
    assert.equal(pontos.length, 4);
    for (let i = 1; i < pontos.length; i += 1) assert.ok(pontos[i].progresso_m > pontos[i - 1].progresso_m);
    assert.ok(pontos[0].progresso_m < 1);
    assert.ok(Math.abs(pontos[3].progresso_m - rota.extensao_m) < 1);
    assert.ok(pontos.every((p) => p.distancia_trajeto_m < 1));
  });

  test('distância ao longo da rota é maior que a linha reta', async () => {
    const [rota] = await repos.rota.listarAtivas();
    const inicio = await repos.rota.coordenadaNaDistancia(rota.id, 0);
    const pontos = await repos.rota.pontosComProgresso(rota.id, inicio);
    const ultimo = pontos[pontos.length - 1];
    assert.ok(ultimo.distancia_reta_m < ultimo.progresso_m, `${ultimo.distancia_reta_m} < ${ultimo.progresso_m}`);
  });

  test('localiza uma posição sobre o trajeto e ignora posições distantes', async () => {
    const [rota] = await repos.rota.listarAtivas();
    const c = await repos.rota.coordenadaNaDistancia(rota.id, 500);
    const [cand] = await repos.rota.candidatosParaPosicao({ ...c, toleranciaM: 150 });
    assert.equal(cand.rota_id, rota.id);
    assert.ok(Math.abs(cand.progresso_m - 500) < 5, `progresso ${cand.progresso_m}`);
    assert.ok(cand.distancia_m < 1);
    assert.deepEqual(await repos.rota.candidatosParaPosicao({ latitude: -12.99, longitude: -38.45, toleranciaM: 150 }), []);
  });

  test('geometria do ponto é derivada da latitude/longitude', async () => {
    const { rows } = await cliente.query('SELECT latitude, longitude, ST_Y(geom) AS y, ST_X(geom) AS x, ST_SRID(geom) AS srid FROM ponto_embarque LIMIT 1');
    assert.equal(rows[0].y, rows[0].latitude);
    assert.equal(rows[0].x, rows[0].longitude);
    assert.equal(rows[0].srid, 4326);
  });

  test('restrições do schema: domínio, período do aviso e ordem única por sentido', async () => {
    await assert.rejects(cliente.query("INSERT INTO ponto_embarque (nome, latitude, longitude, ordem_na_rota, sentido) VALUES ('X', 0.1, 0.1, 9, 'subida')"), (e) => e.code === '23514');
    await assert.rejects(cliente.query("INSERT INTO aviso (texto, inicio, fim) VALUES ('Aviso', now(), now() - interval '1 hour')"), (e) => e.code === '23514');
    await assert.rejects(cliente.query("INSERT INTO ponto_embarque (nome, latitude, longitude, ordem_na_rota, sentido) VALUES ('Duplicado', -12.96, -38.41, 2, 'ida')"), (e) => e.code === '23505');
    await assert.rejects(cliente.query("INSERT INTO sessao_conversa (usuario_hash, etapa_do_dialogo, ponto_id, expira_em) VALUES (repeat('a', 64), 'inicio', 9999, now() + interval '1 day')"), (e) => e.code === '23503');
    await assert.rejects(cliente.query("INSERT INTO usuario_admin (nome, email, senha_hash) VALUES ('X', 'x@ucsal.br', 'senha-em-texto')"), (e) => e.code === '23514');
  });
});
