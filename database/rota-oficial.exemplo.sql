-- ============================================================================
-- MODELO para cadastrar o trajeto OFICIAL (não execute sem editar).
--
-- Rotas e horários não são editáveis pelo painel (fora do escopo). Quando o trajeto
-- e a grade reais forem levantados, um desenvolvedor executa uma versão preenchida
-- deste arquivo:   psql "$DATABASE_URL" -f database/rota-oficial.sql
--
-- Dica: o trajeto pode ser montado a partir de uma viagem real gravada pelo rastreador:
--   SELECT ST_AsText(ST_Simplify(ST_MakeLine(geom ORDER BY registrado_em), 0.00002))
--     FROM posicao_veiculo
--    WHERE dispositivo_id = 'busucsal-01' AND fonte = 'rastreador'
--      AND registrado_em BETWEEN '<INICIO DA VIAGEM>' AND '<FIM DA VIAGEM>';
-- ============================================================================

BEGIN;

-- 1. Desativa a rota demonstrativa (o histórico é preservado).
UPDATE rota SET ativa = FALSE WHERE demonstrativa;

-- 2. Uma linha por janela de operação. Coordenadas na ordem do percurso: "longitude latitude".
INSERT INTO rota (nome, sentido, trajeto, horario_inicio, horario_fim, turno) VALUES
  ('<NOME DA ROTA — IDA>', 'ida',
   ST_GeomFromText('LINESTRING(<LON_1> <LAT_1>, <LON_2> <LAT_2>, <LON_3> <LAT_3>)', 4326),
   '<HH:MM>', '<HH:MM>', '<M | N | M/N>');

-- 3. Desative os pontos demonstrativos depois de cadastrar os oficiais pelo painel (/admin):
-- UPDATE ponto_embarque SET ativo = FALSE WHERE demonstrativo;

COMMIT;
