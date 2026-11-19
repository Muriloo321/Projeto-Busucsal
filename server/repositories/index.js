'use strict';

const { criarRotaRepository } = require('./rota.repository');
const { criarPontoRepository } = require('./ponto.repository');
const { criarAvisoRepository } = require('./aviso.repository');
const { criarPosicaoRepository } = require('./posicao.repository');
const { criarEstadoRepository } = require('./estado.repository');
const { criarSessaoRepository } = require('./sessao.repository');
const { criarAdminRepository } = require('./admin.repository');
const { criarInspetorRepository } = require('./inspetor.repository');
const { emTransacao } = require('../db/pool');

/** Repositórios PostgreSQL + PostGIS a partir de um pool do `pg`. */
function criarRepositorios(pool) {
  return {
    rota: criarRotaRepository(pool),
    ponto: criarPontoRepository(pool),
    aviso: criarAvisoRepository(pool),
    posicao: criarPosicaoRepository(pool),
    estado: criarEstadoRepository(pool),
    sessao: criarSessaoRepository(pool),
    admin: criarAdminRepository(pool),
    inspetor: criarInspetorRepository(pool),
    transacao: (fn) => emTransacao(pool, fn),
    ping: async () => { await pool.query('SELECT 1'); },
  };
}

module.exports = { criarRepositorios };
