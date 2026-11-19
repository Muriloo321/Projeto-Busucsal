-- ============================================================================
-- BusUCSAL — DADOS DEMONSTRATIVOS (não oficiais)
--
-- Coordenadas, nomes de pontos e horário vieram do protótipo anterior e servem
-- apenas para demonstração. Os pontos reais da Seção 6 do Planejamento ainda
-- precisam ser levantados ("preencher antes da Semana 8").
--
-- Todos os registros ficam marcados com demonstrativa/demonstrativo = TRUE e
-- aparecem identificados na interface. Para substituí-los:
--   1. cadastre os pontos reais pelo painel /admin (ou edite este arquivo);
--   2. carregue o trajeto real numa nova linha da tabela rota e desative esta;
--   3. desative os pontos demonstrativos no painel.
-- Execução: npm run db:seed  (pode ser repetida; não duplica registros)
-- ============================================================================

BEGIN;

INSERT INTO rota (nome, sentido, trajeto, horario_inicio, horario_fim, turno, ativa, demonstrativa)
SELECT 'Rota demonstrativa — Estação Pituaçu → Campus UCSAL',
       'ida',
       ST_GeomFromText('LINESTRING(-38.4192 -12.9694, -38.4148 -12.9598, -38.4139 -12.9495, -38.4125 -12.9478)', 4326),
       '06:30', '22:40', 'M/N', TRUE, TRUE
 WHERE NOT EXISTS (SELECT 1 FROM rota WHERE demonstrativa);

INSERT INTO ponto_embarque (nome, referencia, latitude, longitude, ordem_na_rota, sentido, turnos, ativo, demonstrativo)
SELECT v.nome, v.referencia, v.latitude, v.longitude, v.ordem, 'ida', 'M/N', TRUE, TRUE
  FROM (VALUES
          ('Estação Pituaçu',          'Saída do metrô (demonstrativo)',        -12.9694, -38.4192, 1),
          ('Av. Pinto de Aguiar',      'Passarela (demonstrativo)',             -12.9598, -38.4148, 2),
          ('Portaria Principal UCSAL', 'Guarita principal (demonstrativo)',     -12.9495, -38.4139, 3),
          ('Bloco B / Biblioteca',     'Estacionamento interno (demonstrativo)', -12.9478, -38.4125, 4)
       ) AS v (nome, referencia, latitude, longitude, ordem)
 WHERE NOT EXISTS (SELECT 1 FROM ponto_embarque WHERE demonstrativo);

COMMIT;
