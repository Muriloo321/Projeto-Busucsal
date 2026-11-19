'use strict';

const COLUNAS = `id, dispositivo_id, latitude, longitude, velocidade_kmh, precisao_m, registrado_em, recebido_em,
                 fonte, rota_id, progresso_m, distancia_rota_m`;

function criarPosicaoRepository(db) {
  return {
    /** Insere a posição; retorna o id ou null se já existia (reenvio do mesmo instante). */
    async inserir(p, cliente = db) {
      const { rows } = await cliente.query(
        `INSERT INTO posicao_veiculo
           (dispositivo_id, latitude, longitude, velocidade_kmh, precisao_m, registrado_em, fonte,
            rota_id, progresso_m, distancia_rota_m)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT ON CONSTRAINT posicao_unica_por_instante DO NOTHING
         RETURNING id`,
        [p.dispositivo_id, p.latitude, p.longitude, p.velocidade_kmh, p.precisao_m, p.registrado_em, p.fonte,
          p.rota_id, p.progresso_m, p.distancia_rota_m],
      );
      return rows[0] ? rows[0].id : null;
    },

    /** Posições do dispositivo registradas a partir de `desde` (janela da velocidade média). */
    async recentes(dispositivoId, desde, cliente = db) {
      const { rows } = await cliente.query(
        `SELECT registrado_em, velocidade_kmh FROM posicao_veiculo
          WHERE dispositivo_id = $1 AND registrado_em > $2
          ORDER BY registrado_em`,
        [dispositivoId, desde],
      );
      return rows;
    },

    async historico(dispositivoId, limite = 30, cliente = db) {
      const { rows } = await cliente.query(
        `SELECT ${COLUNAS} FROM posicao_veiculo WHERE dispositivo_id = $1 ORDER BY registrado_em DESC LIMIT $2`,
        [dispositivoId, limite],
      );
      return rows;
    },

    /** Histórico em ordem cronológica para a avaliação do erro de previsão. */
    async paraAvaliacao(dispositivoId, fontes, limite = 20000, cliente = db) {
      const { rows } = await cliente.query(
        `SELECT registrado_em, velocidade_kmh, fonte, rota_id, progresso_m FROM (
           SELECT registrado_em, velocidade_kmh, fonte, rota_id, progresso_m FROM posicao_veiculo
            WHERE dispositivo_id = $1 AND fonte = ANY($2::text[])
            ORDER BY registrado_em DESC LIMIT $3) s
          ORDER BY registrado_em`,
        [dispositivoId, fontes, limite],
      );
      return rows;
    },

    /** Remove posições não reais (simulador e cenários). Posições do rastreador nunca são apagadas aqui. */
    async excluirNaoReais(dispositivoId, cliente = db) {
      const { rowCount } = await cliente.query(
        "DELETE FROM posicao_veiculo WHERE dispositivo_id = $1 AND fonte <> 'rastreador'", [dispositivoId],
      );
      return rowCount;
    },

    async ultimaReal(dispositivoId, cliente = db) {
      const { rows } = await cliente.query(
        `SELECT ${COLUNAS} FROM posicao_veiculo WHERE dispositivo_id = $1 AND fonte = 'rastreador'
          ORDER BY registrado_em DESC LIMIT 1`, [dispositivoId],
      );
      return rows[0] || null;
    },
  };
}

module.exports = { criarPosicaoRepository };
