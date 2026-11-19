'use strict';

const COLUNAS = 'usuario_hash, canal, etapa_do_dialogo, ponto_id, criado_em, atualizado_em, expira_em';

function criarSessaoRepository(db) {
  return {
    async obterValida(usuarioHash, agora, cliente = db) {
      const { rows } = await cliente.query(
        `SELECT ${COLUNAS} FROM sessao_conversa WHERE usuario_hash = $1 AND expira_em > $2`, [usuarioHash, agora],
      );
      return rows[0] || null;
    },

    /**
     * Cria ou atualiza a sessão. A expiração é fixada na criação (criado_em + validade),
     * então a conversa não prolonga a retenção além de 24 h.
     */
    async salvar({ usuarioHash, canal, etapa, pontoId, agora, validadeH }, cliente = db) {
      const { rows } = await cliente.query(
        `INSERT INTO sessao_conversa (usuario_hash, canal, etapa_do_dialogo, ponto_id, criado_em, atualizado_em, expira_em)
         VALUES ($1, $2, $3, $4, $5, $5, $5::timestamptz + make_interval(hours => $6::int))
         ON CONFLICT (usuario_hash) DO UPDATE
           SET etapa_do_dialogo = EXCLUDED.etapa_do_dialogo,
               ponto_id = EXCLUDED.ponto_id,
               atualizado_em = EXCLUDED.atualizado_em
         RETURNING ${COLUNAS}`,
        [usuarioHash, canal, etapa, pontoId, agora, validadeH],
      );
      return rows[0];
    },

    async excluir(usuarioHash, cliente = db) {
      const { rowCount } = await cliente.query('DELETE FROM sessao_conversa WHERE usuario_hash = $1', [usuarioHash]);
      return rowCount > 0;
    },

    async excluirExpiradas(agora, cliente = db) {
      const { rowCount } = await cliente.query('DELETE FROM sessao_conversa WHERE expira_em <= $1', [agora]);
      return rowCount;
    },
  };
}

module.exports = { criarSessaoRepository };
