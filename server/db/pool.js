'use strict';

/**
 * Conexão com PostgreSQL + PostGIS (biblioteca `pg`).
 * Carregada apenas pelo ponto de entrada do servidor e pelos scripts de banco.
 */

function configurarTipos(pg) {
  // NUMERIC (1700) e BIGINT (20) chegam como texto por padrão; os valores deste projeto cabem em Number.
  pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
  pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
}

function criarPool(connectionString, logger) {
  // eslint-disable-next-line global-require
  const pg = require('pg');
  configurarTipos(pg);
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: 'busucsal',
  });
  pool.on('error', (erro) => logger.erro('Conexão ociosa do PostgreSQL falhou', { mensagem: erro.message }));
  return pool;
}

/** Executa `fn(cliente)` dentro de BEGIN/COMMIT, com ROLLBACK em caso de erro. */
async function emTransacao(pool, fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    try { await cliente.query('ROLLBACK'); } catch { /* conexão já perdida */ }
    throw erro;
  } finally {
    cliente.release();
  }
}

module.exports = { criarPool, emTransacao };
