'use strict';

/** Catálogo dos endpoints, exibido na página técnica. Mantido junto às rotas. */
module.exports = Object.freeze([
  { metodo: 'POST', caminho: '/api/posicao', protecao: 'Token do dispositivo', descricao: 'Recebe posições do rastreador (JSON do simulador, JSON do Traccar Client ou parâmetros OsmAnd).', planejamento: true, situacao: 'implementado' },
  { metodo: 'GET', caminho: '/api/estado', protecao: 'Interno (loopback, token interno ou sessão da equipe)', descricao: 'Status, posição, previsões por ponto e avisos vigentes.', planejamento: true, situacao: 'implementado' },
  { metodo: 'POST', caminho: '/webhook/whatsapp', protecao: 'Assinatura da Meta (futuro)', descricao: 'Integração com o WhatsApp Cloud API — fora do escopo desta etapa (responde 501).', planejamento: true, situacao: 'fora do escopo' },
  { metodo: 'GET/POST', caminho: '/admin/avisos', protecao: 'Login da equipe', descricao: 'Lista e cadastra avisos operacionais.', planejamento: true, situacao: 'implementado' },
  { metodo: 'PUT/PATCH/DELETE', caminho: '/admin/avisos/:id', protecao: 'Login da equipe', descricao: 'Edita, ativa/desativa (PATCH …/ativo) e exclui avisos.', planejamento: false, situacao: 'implementado' },
  { metodo: 'GET/POST', caminho: '/admin/pontos', protecao: 'Login da equipe', descricao: 'Consulta e cadastro inicial de pontos de embarque (validados contra o trajeto no PostGIS).', planejamento: true, situacao: 'implementado' },
  { metodo: 'PUT/PATCH', caminho: '/admin/pontos/:id', protecao: 'Login da equipe', descricao: 'Edita ou ativa/desativa (PATCH …/ativo) um ponto.', planejamento: false, situacao: 'implementado' },
  { metodo: 'GET', caminho: '/admin/rotas', protecao: 'Login da equipe', descricao: 'Consulta somente leitura das rotas e da grade de horários.', planejamento: false, situacao: 'implementado' },
  { metodo: 'POST', caminho: '/admin/login · /admin/logout', protecao: 'Pública / sessão', descricao: 'Autenticação com bcrypt e cookie HttpOnly assinado.', planejamento: false, situacao: 'implementado' },
  { metodo: 'GET', caminho: '/api/rota', protecao: 'Interno', descricao: 'Trajeto das rotas ativas em GeoJSON (representação da rota e simulador Python).', planejamento: false, situacao: 'implementado' },
  { metodo: 'POST', caminho: '/api/conversa/simulador', protecao: 'Interno', descricao: 'Simulador local da conversa (mesmo fluxo que o futuro webhook usará).', planejamento: false, situacao: 'demonstração local' },
  { metodo: 'POST', caminho: '/api/demo/cenarios/:id', protecao: 'Interno + DEMO_MODE', descricao: 'Aplica um cenário de demonstração.', planejamento: false, situacao: 'demonstração local' },
  { metodo: 'GET/POST', caminho: '/api/demo/simulador/*', protecao: 'Login da equipe + DEMO_MODE', descricao: 'Controle do simulador GPS integrado.', planejamento: false, situacao: 'demonstração local' },
  { metodo: 'GET', caminho: '/api/tecnico/*', protecao: 'Login da equipe', descricao: 'Inspetor das tabelas, logs, métricas e informações do sistema.', planejamento: false, situacao: 'implementado' },
  { metodo: 'GET', caminho: '/api/saude', protecao: 'Pública', descricao: 'Verificação simples de funcionamento do servidor e do banco.', planejamento: false, situacao: 'implementado' },
]);
