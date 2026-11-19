/**
 * Mapeamento de requisitos → implementação. Apenas os requisitos cujo significado aparece nos
 * documentos fornecidos (Planejamento Técnico e rótulos do protótipo) foram descritos.
 */
export const REQUISITOS = [
  {
    codigo: 'RF02 · RNF06',
    descricao: 'Status do serviço (fora de operação, sem dados, parado, em circulação) e transparência quando não há dado recente.',
    fonte: 'Planejamento, Seção 4.2',
    implementacao: 'server/domain/status.js (calcularStatus); gravado em estado_veiculo.status pelo estado.service.js e pela tarefa periódica de 30 s.',
    verificacao: 'tests/unit/status.test.js e posicao-estado.test.js · cenários “Sem sinal”, “Veículo parado” e “Interrupção”.',
  },
  {
    codigo: 'RF03',
    descricao: 'Previsão pela distância ao longo da rota, ponto já ultrapassado no sentido, velocidade média de 5 min com valor mínimo, resposta aproximada com horário.',
    fonte: 'Planejamento, Seção 4.1',
    implementacao: 'PostGIS em server/repositories/rota.repository.js (ST_LineLocatePoint, ST_LineSubstring, geography); regras em server/domain/previsao.js; sentido em server/domain/rota-sentido.js.',
    verificacao: 'tests/unit/previsao.test.js, rota-sentido.test.js e posicao-estado.test.js · tests/integration/postgis.test.js · tabela “Estado do veículo” (rota × linha reta).',
  },
  {
    codigo: 'RF05 · RF06',
    descricao: 'A IA devolve apenas a intenção; intenção desconhecida ou classificação acima de 2 s mostra o menu numerado.',
    fonte: 'Planejamento, Seção 4.3',
    implementacao: 'server/domain/intencoes.js (classificador local determinístico e classificarComLimite) e server/domain/dialogo.js.',
    verificacao: 'tests/unit/intencoes.test.js e dialogo.test.js · cenário “Assistente demorou a entender”.',
  },
  {
    codigo: 'RF09',
    descricao: 'Página web com login para a equipe cadastrar avisos (e pontos).',
    fonte: 'Planejamento, Seções 2 e 3',
    implementacao: '/admin + rotas /admin/avisos e /admin/pontos protegidas por middleware; senha com bcrypt; cookie HttpOnly assinado.',
    verificacao: 'tests/unit/admin.test.js e http.test.js · tests/integration/api.test.js.',
  },
  {
    codigo: 'RF04',
    descricao: 'Avisos da equipe chegam ao estudante junto das respostas.',
    fonte: 'Rótulo do protótipo anterior (“Aviso da Equipe (RF04/RF09)”)',
    implementacao: 'server/domain/respostas.js (textoAvisos) e lista pública de avisos na página inicial.',
    verificacao: 'tests/unit/dialogo.test.js · cenário “Aviso da equipe”.',
  },
  {
    codigo: 'RF08',
    descricao: 'Menu numerado quando o estudante pede ajuda.',
    fonte: 'Comentário do protótipo anterior (“menu numerado (RF06 e RF08)”)',
    implementacao: 'MENU em server/domain/intencoes.js e intenção “ajuda” em server/domain/dialogo.js.',
    verificacao: 'tests/unit/dialogo.test.js.',
  },
  {
    codigo: 'RNF07',
    descricao: 'Privacidade (LGPD): identificador guardado só como hash; sessão apagada após 24 h.',
    fonte: 'Planejamento, nota da Seção 3, e rótulo do protótipo',
    implementacao: 'HMAC-SHA-256 em server/utils/seguranca.js; sessao_conversa.expira_em; limpeza a cada 10 min (server/jobs/manutencao.js).',
    verificacao: 'tests/unit/conversa.test.js.',
  },
  {
    codigo: 'RF01 · RF07 · RNF01',
    descricao: 'Aparecem no protótipo, mas os documentos fornecidos não dizem o que significam.',
    fonte: 'Não descrito',
    implementacao: 'Não mapeado. Confirme no documento de requisitos da Etapa 1.',
    verificacao: '—',
  },
  {
    codigo: 'Seção 8',
    descricao: 'Critérios de sucesso do protótipo.',
    fonte: 'Planejamento, Seção 8',
    implementacao: 'Indicadores desta página (server/services/tecnico.service.js e metricas.service.js).',
    verificacao: 'Seção “Indicadores” acima.',
  },
];
