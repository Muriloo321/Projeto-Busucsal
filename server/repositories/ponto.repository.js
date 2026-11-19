'use strict';

const COLUNAS = `id, nome, referencia, latitude, longitude, ordem_na_rota, sentido, turnos, ativo,
                 demonstrativo, criado_em, atualizado_em`;
const EDITAVEIS = ['nome', 'referencia', 'latitude', 'longitude', 'ordem_na_rota', 'sentido', 'turnos', 'ativo'];

function criarPontoRepository(db) {
  const repo = {
    async listar({ incluirInativos = false } = {}, cliente = db) {
      const { rows } = await cliente.query(
        `SELECT ${COLUNAS} FROM ponto_embarque ${incluirInativos ? '' : 'WHERE ativo'} ORDER BY sentido, ordem_na_rota, id`,
      );
      return rows;
    },

    async obter(id, cliente = db) {
      const { rows } = await cliente.query(`SELECT ${COLUNAS} FROM ponto_embarque WHERE id = $1`, [id]);
      return rows[0] || null;
    },

    async criar(dados, cliente = db) {
      const { rows } = await cliente.query(
        `INSERT INTO ponto_embarque (nome, referencia, latitude, longitude, ordem_na_rota, sentido, turnos, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUNAS}`,
        [dados.nome, dados.referencia, dados.latitude, dados.longitude, dados.ordem_na_rota, dados.sentido, dados.turnos, dados.ativo],
      );
      return rows[0];
    },

    /** Atualização parcial apenas das colunas permitidas (lista fixa → sem SQL dinâmico inseguro). */
    async atualizar(id, campos, cliente = db) {
      const chaves = EDITAVEIS.filter((c) => campos[c] !== undefined);
      if (chaves.length === 0) return repo.obter(id, cliente);
      const sets = chaves.map((c, i) => `${c} = $${i + 2}`);
      // Um ponto editado pela equipe deixa de ser demonstrativo.
      const { rows } = await cliente.query(
        `UPDATE ponto_embarque SET ${sets.join(', ')}, demonstrativo = FALSE, atualizado_em = now()
          WHERE id = $1 RETURNING ${COLUNAS}`,
        [id, ...chaves.map((c) => campos[c])],
      );
      return rows[0] || null;
    },
  };
  return repo;
}

module.exports = { criarPontoRepository };
