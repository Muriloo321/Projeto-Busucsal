'use strict';

/**
 * Leitura somente das sete tabelas, com consultas fixas (nomes de tabela nunca vêm da requisição).
 * Geometrias aparecem como WKT abreviado; hashes de senha e de usuário são mascarados.
 */

const TABELAS = Object.freeze({
  posicao_veiculo: {
    descricao: 'Histórico das posições recebidas em POST /api/posicao (rastreador, simulador ou cenários).',
    consulta: `SELECT id, dispositivo_id, latitude, longitude, ST_AsText(geom) AS geom, velocidade_kmh, precisao_m,
                      registrado_em, recebido_em, fonte, rota_id, round(progresso_m::numeric, 1) AS progresso_m,
                      round(distancia_rota_m::numeric, 1) AS distancia_rota_m
                 FROM posicao_veiculo ORDER BY registrado_em DESC LIMIT $1`,
  },
  estado_veiculo: {
    descricao: 'Estado consolidado do veículo: última posição, rota/sentido, progresso e status calculado.',
    consulta: `SELECT dispositivo_id, ultima_posicao_id, ST_AsText(ultima_posicao) AS ultima_posicao, ultima_atualizacao,
                      velocidade_kmh, rota_id, round(progresso_m::numeric, 1) AS progresso_m,
                      round(distancia_rota_m::numeric, 1) AS distancia_rota_m, parado_desde, status,
                      status_calculado_em, proximo_ponto_id, atualizado_em
                 FROM estado_veiculo ORDER BY dispositivo_id LIMIT $1`,
  },
  ponto_embarque: {
    descricao: 'Pontos de embarque (Seção 6), com geometria derivada da latitude/longitude.',
    consulta: `SELECT id, nome, referencia, latitude, longitude, ST_AsText(geom) AS geom, ordem_na_rota, sentido, turnos,
                      ativo, demonstrativo, criado_em, atualizado_em
                 FROM ponto_embarque ORDER BY sentido, ordem_na_rota, id LIMIT $1`,
  },
  rota: {
    descricao: 'Trajeto (polilinha PostGIS) e janela de horário por turno. Não editável pelo painel.',
    consulta: `SELECT id, nome, sentido, left(ST_AsText(trajeto), 120) || CASE WHEN length(ST_AsText(trajeto)) > 120 THEN '…' ELSE '' END AS trajeto,
                      ST_NPoints(trajeto) AS vertices, round(ST_Length(trajeto::geography)::numeric, 1) AS extensao_m,
                      horario_inicio, horario_fim, turno, ativa, demonstrativa, criado_em
                 FROM rota ORDER BY id LIMIT $1`,
  },
  aviso: {
    descricao: 'Avisos operacionais da equipe; interrompe_operacao força o status "Fora de operação".',
    consulta: `SELECT id, texto, inicio, fim, ativo, interrompe_operacao, demonstrativo, criado_por, criado_em, atualizado_em
                 FROM aviso ORDER BY id DESC LIMIT $1`,
  },
  sessao_conversa: {
    descricao: 'Contexto de cada conversa (etapa e ponto escolhido). Identificador pseudonimizado; expira em 24 h.',
    consulta: `SELECT left(usuario_hash, 12) || '…' AS usuario_hash, canal, etapa_do_dialogo, ponto_id, criado_em,
                      atualizado_em, expira_em
                 FROM sessao_conversa ORDER BY atualizado_em DESC LIMIT $1`,
  },
  usuario_admin: {
    descricao: 'Equipe com acesso ao painel. A senha é guardada apenas como hash bcrypt (mascarado aqui).',
    consulta: `SELECT id, nome, email, left(senha_hash, 7) || '…(' || length(senha_hash) || ' caracteres)' AS senha_hash,
                      ativo, criado_em, ultimo_login_em
                 FROM usuario_admin ORDER BY id LIMIT $1`,
  },
});

const CONTAGEM = `
  SELECT 'posicao_veiculo' AS tabela, COUNT(*)::int AS registros FROM posicao_veiculo UNION ALL
  SELECT 'estado_veiculo', COUNT(*)::int FROM estado_veiculo UNION ALL
  SELECT 'ponto_embarque', COUNT(*)::int FROM ponto_embarque UNION ALL
  SELECT 'rota', COUNT(*)::int FROM rota UNION ALL
  SELECT 'aviso', COUNT(*)::int FROM aviso UNION ALL
  SELECT 'sessao_conversa', COUNT(*)::int FROM sessao_conversa UNION ALL
  SELECT 'usuario_admin', COUNT(*)::int FROM usuario_admin`;

function criarInspetorRepository(db) {
  return {
    tabelasConhecidas: () => Object.keys(TABELAS),

    async resumo() {
      const { rows } = await db.query(CONTAGEM);
      const porNome = new Map(rows.map((r) => [r.tabela, r.registros]));
      return Object.entries(TABELAS).map(([nome, t]) => ({ nome, descricao: t.descricao, registros: porNome.get(nome) ?? 0 }));
    },

    async linhas(nome, limite) {
      const t = TABELAS[nome];
      if (!t) return null;
      const resultado = await db.query(t.consulta, [limite]);
      return {
        nome,
        descricao: t.descricao,
        colunas: resultado.fields.map((f) => f.name),
        linhas: resultado.rows,
      };
    },

    async infoBanco() {
      const { rows } = await db.query(
        "SELECT current_setting('server_version') AS postgres, postgis_lib_version() AS postgis, current_database() AS banco",
      );
      return rows[0];
    },
  };
}

module.exports = { criarInspetorRepository, TABELAS };
