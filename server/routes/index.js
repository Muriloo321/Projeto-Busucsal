'use strict';

const { asyncHandler: h } = require('../utils/http');
const {
  exigirTokenDispositivo, exigirAdmin, exigirAcessoInterno, exigirJson, exigirModoDemo,
} = require('../middleware/seguranca');
const { criarPublicoController } = require('../controllers/publico.controller');
const { criarAdminController } = require('../controllers/admin.controller');
const { criarTecnicoController } = require('../controllers/tecnico.controller');

/**
 * Define as rotas HTTP. Endpoints do planejamento: POST /api/posicao, GET /api/estado,
 * POST /webhook/whatsapp (fora do escopo — 501) e /admin/avisos, /admin/pontos.
 */
function criarRotas({ express, servicos, config }) {
  const pub = criarPublicoController({ servicos, config });
  const adm = criarAdminController({ servicos, config });
  const tec = criarTecnicoController({ servicos, config });
  const interno = exigirAcessoInterno(config);
  const demo = exigirModoDemo(config);

  // ---- /api ----------------------------------------------------------------
  const api = express.Router();
  api.get('/saude', h(pub.saude));
  api.post('/posicao', express.urlencoded({ extended: false, limit: '16kb' }), exigirTokenDispositivo(config), h(pub.receberPosicao));
  api.get('/estado', interno, h(pub.obterEstado));
  api.get('/rota', interno, h(pub.obterRota));
  api.post('/conversa/simulador', interno, exigirJson, h(pub.conversar));
  api.post('/conversa/simulador/reiniciar', interno, exigirJson, h(pub.reiniciarConversa));

  // Demonstração (DEMO_MODE=true)
  api.get('/demo/config', interno, tec.configDemo);
  api.post('/demo/cenarios/:id', demo, interno, exigirJson, h(tec.aplicarCenario));
  api.get('/demo/simulador', demo, exigirAdmin, tec.simulador);
  api.post('/demo/simulador/iniciar', demo, exigirAdmin, exigirJson, h(tec.iniciarSimulador));
  api.post('/demo/simulador/parar', demo, exigirAdmin, exigirJson, tec.pararSimulador);
  api.post('/demo/simulador/sinal', demo, exigirAdmin, exigirJson, tec.sinalSimulador);
  api.post('/demo/simulador/parado', demo, exigirAdmin, exigirJson, tec.paradoSimulador);
  api.post('/demo/simulador/velocidade', demo, exigirAdmin, exigirJson, tec.velocidadeSimulador);
  api.post('/demo/simulador/reiniciar-percurso', demo, exigirAdmin, exigirJson, tec.reiniciarPercurso);

  // Página técnica (equipe autenticada)
  const tecnico = express.Router();
  tecnico.use(exigirAdmin, exigirJson);
  tecnico.get('/sistema', h(tec.sistema));
  tecnico.get('/tabelas', h(tec.tabelas));
  tecnico.get('/tabelas/:nome', h(tec.tabela));
  tecnico.get('/posicoes', h(tec.posicoes));
  tecnico.get('/requisicoes', tec.requisicoes);
  tecnico.delete('/requisicoes', tec.limparRequisicoes);
  tecnico.get('/endpoints', tec.endpoints);
  tecnico.get('/indicadores', tec.indicadores);
  tecnico.post('/indicadores/avaliar-previsoes', h(tec.avaliarPrevisoes));
  tecnico.post('/indicadores/conjunto-interno', h(tec.conjuntoInterno));
  tecnico.get('/indicadores/mensagens', tec.mensagens);
  tecnico.post('/indicadores/mensagens/:id/avaliacao', tec.avaliarMensagem);
  tecnico.post('/indicadores/participantes', tec.adicionarParticipante);
  tecnico.delete('/indicadores/participantes/:id', tec.removerParticipante);
  api.use('/tecnico', tecnico);

  // ---- /admin (API do painel; a página fica em /admin → admin.html) --------
  const admin = express.Router();
  admin.post('/login', exigirJson, h(adm.login));
  admin.post('/logout', exigirJson, adm.logout);
  admin.get('/sessao', exigirAdmin, adm.sessao);
  admin.use(exigirAdmin, exigirJson);
  admin.get('/avisos', h(adm.listarAvisos));
  admin.post('/avisos', h(adm.criarAviso));
  admin.put('/avisos/:id', h(adm.atualizarAviso));
  admin.patch('/avisos/:id/ativo', h(adm.ativarAviso));
  admin.delete('/avisos/:id', h(adm.excluirAviso));
  admin.get('/pontos', h(adm.listarPontos));
  admin.post('/pontos', h(adm.criarPonto));
  admin.put('/pontos/:id', h(adm.atualizarPonto));
  admin.patch('/pontos/:id/ativo', h(adm.ativarPonto));
  admin.get('/rotas', h(adm.listarRotas));

  // ---- /webhook -------------------------------------------------------------
  const webhook = express.Router();
  webhook.post('/whatsapp', pub.whatsappForaDoEscopo);

  return { api, admin, webhook };
}

module.exports = { criarRotas };
