'use strict';

const COLUNAS = `e.dispositivo_id, e.ultima_posicao_id, ST_Y(e.ultima_posicao) AS latitude, ST_X(e.ultima_posicao) AS longitude,
                 e.ultima_atualizacao, e.velocidade_kmh, e.rota_id, e.progresso_m, e.distancia_rota_m, e.parado_desde,
                 e.status, e.status_calculado_em, e.proximo_ponto_id, e.atualizado_em`;

function criarEstadoRepository(db) {
  const repo = {
    async obter(dispositivoId, cliente = db) {
      const { rows } = await cliente.query(`SELECT ${COLUNAS} FROM estado_veiculo e WHERE e.dispositivo_id = $1`, [dispositivoId]);
      return rows[0] || null;
    },

    /** Garante o registro e o bloqueia até o fim da transação (posições simultâneas ficam em fila). */
    async travar(cliente, dispositivoId) {
      await cliente.query(
        'INSERT INTO estado_veiculo (dispositivo_id) VALUES ($1) ON CONFLICT (dispositivo_id) DO NOTHING', [dispositivoId],
      );
      const { rows } = await cliente.query(`SELECT ${COLUNAS} FROM estado_veiculo e WHERE e.dispositivo_id = $1 FOR UPDATE`, [dispositivoId]);
      return rows[0];
    },

    async atualizarPosicao(cliente, dispositivoId, d) {
      await cliente.query(
        `UPDATE estado_veiculo SET
            ultima_posicao_id = $2,
            ultima_posicao = ST_SetSRID(ST_MakePoint($3, $4), 4326),
            ultima_atualizacao = $5,
            velocidade_kmh = $6,
            rota_id = $7,
            progresso_m = $8,
            distancia_rota_m = $9,
            parado_desde = $10,
            atualizado_em = now()
          WHERE dispositivo_id = $1`,
        [dispositivoId, d.ultima_posicao_id, d.longitude, d.latitude, d.ultima_atualizacao, d.velocidade_kmh,
          d.rota_id, d.progresso_m, d.distancia_rota_m, d.parado_desde],
      );
    },

    async salvarStatus(dispositivoId, { status, calculadoEm, proximoPontoId }, cliente = db) {
      await cliente.query(
        `UPDATE estado_veiculo SET status = $2, status_calculado_em = $3, proximo_ponto_id = $4
          WHERE dispositivo_id = $1`,
        [dispositivoId, status, calculadoEm, proximoPontoId],
      );
    },

    /** Restaura o estado a partir de uma posição (ou zera, se não houver nenhuma). */
    async redefinir(cliente, dispositivoId, posicao) {
      if (!posicao) {
        await cliente.query('DELETE FROM estado_veiculo WHERE dispositivo_id = $1', [dispositivoId]);
        return;
      }
      await cliente.query(
        `INSERT INTO estado_veiculo (dispositivo_id) VALUES ($1) ON CONFLICT (dispositivo_id) DO NOTHING`, [dispositivoId],
      );
      await repo.atualizarPosicao(cliente, dispositivoId, {
        ultima_posicao_id: posicao.id,
        longitude: posicao.longitude,
        latitude: posicao.latitude,
        ultima_atualizacao: posicao.registrado_em,
        velocidade_kmh: posicao.velocidade_kmh,
        rota_id: posicao.rota_id,
        progresso_m: posicao.progresso_m,
        distancia_rota_m: posicao.distancia_rota_m,
        parado_desde: null,
      });
    },
  };
  return repo;
}

module.exports = { criarEstadoRepository };
