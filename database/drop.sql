-- Remove as tabelas do BusUCSAL (usado por npm run db:reset e pelos testes de integração).
-- A extensão PostGIS é mantida.
DROP TABLE IF EXISTS sessao_conversa, aviso, estado_veiculo, posicao_veiculo, ponto_embarque, rota, usuario_admin CASCADE;
