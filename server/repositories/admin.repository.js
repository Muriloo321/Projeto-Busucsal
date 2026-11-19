'use strict';

function criarAdminRepository(db) {
  return {
    async obterPorEmail(email, cliente = db) {
      const { rows } = await cliente.query(
        'SELECT id, nome, email, senha_hash, ativo FROM usuario_admin WHERE email = $1', [email],
      );
      return rows[0] || null;
    },

    async obterPorId(id, cliente = db) {
      const { rows } = await cliente.query('SELECT id, nome, email, ativo FROM usuario_admin WHERE id = $1', [id]);
      return rows[0] || null;
    },

    async registrarLogin(id, agora, cliente = db) {
      await cliente.query('UPDATE usuario_admin SET ultimo_login_em = $2 WHERE id = $1', [id, agora]);
    },

    async criarOuAtualizar({ nome, email, senhaHash }, cliente = db) {
      const { rows } = await cliente.query(
        `INSERT INTO usuario_admin (nome, email, senha_hash) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, ativo = TRUE
         RETURNING id, nome, email, ativo`,
        [nome, email, senhaHash],
      );
      return rows[0];
    },
  };
}

module.exports = { criarAdminRepository };
