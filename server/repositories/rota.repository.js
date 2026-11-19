'use strict';

/**
 * Consultas de rota e geometria. Todos os cálculos de distância ao longo do trajeto
 * são feitos no PostGIS (ST_LineLocatePoint + ST_LineSubstring + geography).
 */

const COLUNAS = `
  r.id, r.nome, r.sentido, to_char(r.horario_inicio, 'HH24:MI') AS horario_inicio,
  to_char(r.horario_fim, 'HH24:MI') AS horario_fim, r.turno, r.ativa, r.demonstrativa,
  ST_Length(r.trajeto::geography) AS extensao_m`;

function criarRotaRepository(db) {
  return {
    async listarAtivas(cliente = db) {
      const { rows } = await cliente.query(`SELECT ${COLUNAS} FROM rota r WHERE r.ativa ORDER BY r.sentido, r.horario_inicio, r.id`);
      return rows;
    },

    async listarTodas(cliente = db) {
      const { rows } = await cliente.query(`SELECT ${COLUNAS} FROM rota r ORDER BY r.sentido, r.horario_inicio, r.id`);
      return rows;
    },

    /** Rotas ativas com o trajeto em GeoJSON (para desenhar a representação da rota). */
    async listarComTrajeto(cliente = db) {
      const { rows } = await cliente.query(
        `SELECT ${COLUNAS}, ST_AsGeoJSON(r.trajeto, 6)::json AS trajeto_geojson
           FROM rota r WHERE r.ativa ORDER BY r.sentido, r.horario_inicio, r.id`,
      );
      return rows;
    },

    /**
     * Rotas ativas a até `toleranciaM` metros da posição, com o progresso (metros percorridos
     * desde o início do trajeto até a projeção do ponto sobre a linha).
     */
    async candidatosParaPosicao({ longitude, latitude, toleranciaM }, cliente = db) {
      const { rows } = await cliente.query(
        `SELECT r.id AS rota_id, r.sentido,
                ST_Distance(r.trajeto::geography, p.g::geography) AS distancia_m,
                ST_Length(ST_LineSubstring(r.trajeto, 0, ST_LineLocatePoint(r.trajeto, p.g))::geography) AS progresso_m,
                ST_Length(r.trajeto::geography) AS extensao_m
           FROM rota r
          CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS g) p
          WHERE r.ativa AND ST_DWithin(r.trajeto::geography, p.g::geography, $3)
          ORDER BY distancia_m, r.id`,
        [longitude, latitude, toleranciaM],
      );
      return rows;
    },

    /**
     * Pontos ativos do mesmo sentido da rota, com:
     *  - progresso_m: distância ao longo do trajeto até o ponto;
     *  - distancia_trajeto_m: afastamento do ponto em relação à linha;
     *  - distancia_reta_m: distância em linha reta até o ônibus (apenas para comparação técnica).
     */
    async pontosComProgresso(rotaId, onibus = null, cliente = db) {
      const lon = onibus ? onibus.longitude : null;
      const lat = onibus ? onibus.latitude : null;
      const { rows } = await cliente.query(
        `SELECT pe.id,
                ST_Length(ST_LineSubstring(r.trajeto, 0, ST_LineLocatePoint(r.trajeto, pe.geom))::geography) AS progresso_m,
                ST_Distance(r.trajeto::geography, pe.geom::geography) AS distancia_trajeto_m,
                CASE WHEN $2::float8 IS NULL OR $3::float8 IS NULL THEN NULL
                     ELSE ST_Distance(pe.geom::geography, ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography)
                END AS distancia_reta_m
           FROM ponto_embarque pe
           JOIN rota r ON r.id = $1 AND r.sentido = pe.sentido
          WHERE pe.ativo
          ORDER BY pe.ordem_na_rota`,
        [rotaId, lon, lat],
      );
      return rows;
    },

    /** Coordenada situada a `metros` do início do trajeto (usada pelo simulador e cenários). */
    async coordenadaNaDistancia(rotaId, metros, cliente = db) {
      const { rows } = await cliente.query(
        `SELECT ST_Y(s.pt) AS latitude, ST_X(s.pt) AS longitude, s.extensao_m
           FROM (SELECT ST_LineInterpolatePoint(r.trajeto,
                          LEAST(1, GREATEST(0, $2::float8 / NULLIF(ST_Length(r.trajeto::geography), 0)))) AS pt,
                        ST_Length(r.trajeto::geography) AS extensao_m
                   FROM rota r WHERE r.id = $1) s`,
        [rotaId, metros],
      );
      return rows[0] || null;
    },

    /** Menor distância (m) entre uma coordenada e as rotas ativas de um sentido. */
    async distanciaAteRotas({ longitude, latitude, sentido }, cliente = db) {
      const { rows } = await cliente.query(
        `SELECT MIN(ST_Distance(r.trajeto::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)) AS distancia_m,
                COUNT(*)::int AS rotas
           FROM rota r WHERE r.ativa AND r.sentido = $3`,
        [longitude, latitude, sentido],
      );
      return rows[0];
    },
  };
}

module.exports = { criarRotaRepository };
