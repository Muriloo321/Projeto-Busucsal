'use strict';

const COLUNAS = `a.id, a.texto, a.inicio, a.fim, a.ativo, a.interrompe_operacao, a.demonstrativo,
                 a.criado_por, u.nome AS criado_por_nome, a.criado_em, a.atualizado_em`;
const EDITAVEIS = ['texto', 'inicio', 'fim', 'ativo', 'interrompe_operacao'];

function criarAvisoRepository(db) {
  const repo = {
    async listar(cliente = db) {
      const { rows } = await cliente.query(
        `SELECT ${COLUNAS} FROM aviso a LEFT JOIN usuario_admin u ON u.id = a.criado_por
          ORDER BY a.ativo DESC, a.inicio DESC, a.id DESC LIMIT 200`,
      );
      return rows;
    },

    async listarVigentes(agora, cliente = db) {
      const { rows } = await cliente.query(
        `SELECT ${COLUNAS} FROM aviso a LEFT JOIN usuario_admin u ON u.id = a.criado_por
          WHERE a.ativo AND a.inicio <= $1 AND a.fim > $1
          ORDER BY a.interrompe_operacao DESC, a.inicio DESC`,
        [agora],
      );
      return rows;
    },

    async obter(id, cliente = db) {
      const { rows } = await cliente.query(
        `SELECT ${COLUNAS} FROM aviso a LEFT JOIN usuario_admin u ON u.id = a.criado_por WHERE a.id = $1`, [id],
      );
      return rows[0] || null;
    },

    async criar(dados, cliente = db) {
      const { rows } = await cliente.query(
        `INSERT INTO aviso (texto, inicio, fim, ativo, interrompe_operacao, demonstrativo, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [dados.texto, dados.inicio, dados.fim, dados.ativo, dados.interrompe_operacao, Boolean(dados.demonstrativo), dados.criado_por || null],
      );
      return repo.obter(rows[0].id, cliente);
    },

    async atualizar(id, campos, cliente = db) {
      const chaves = EDITAVEIS.filter((c) => campos[c] !== undefined);
      if (chaves.length === 0) return repo.obter(id, cliente);
      const sets = chaves.map((c, i) => `${c} = $${i + 2}`);
      const { rowCount } = await cliente.query(
        `UPDATE aviso SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $1`,
        [id, ...chaves.map((c) => campos[c])],
      );
      return rowCount ? repo.obter(id, cliente) : null;
    },

    async excluir(id, cliente = db) {
      const { rowCount } = await cliente.query('DELETE FROM aviso WHERE id = $1', [id]);
      return rowCount > 0;
    },

    async excluirDemonstrativos(cliente = db) {
      const { rowCount } = await cliente.query('DELETE FROM aviso WHERE demonstrativo');
      return rowCount;
    },
  };
  return repo;
}

module.exports = { criarAvisoRepository };
