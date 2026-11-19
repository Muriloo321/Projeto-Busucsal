'use strict';

const path = require('node:path');
const { criarRotas } = require('./routes');
const { cabecalhosSeguranca, semCache, carregarAdmin } = require('./middleware/seguranca');
const { registrarRequisicoes } = require('./middleware/registro');
const { naoEncontrado, tratarErros } = require('./middleware/erros');

const PASTA_PUBLICA = path.join(__dirname, '..', 'public');

/**
 * Cria a aplicação Express. Não abre conexões nem portas: recebe os serviços prontos.
 * @param {object} p
 * @param {Function} p.express módulo express (injetado para facilitar testes)
 */
function criarApp({ express, servicos, config, logger }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(cabecalhosSeguranca);
  app.use(registrarRequisicoes(servicos.registroRequisicoes));
  app.use(express.static(PASTA_PUBLICA, { extensions: ['html'], index: 'index.html', maxAge: 0 }));
  app.use(express.json({ limit: '16kb' }));

  const prefixosApi = ['/api', '/admin', '/webhook'];
  app.use(prefixosApi, semCache, carregarAdmin(config, servicos.auth));

  const rotas = criarRotas({ express, servicos, config });
  app.use('/api', rotas.api);
  app.use('/admin', rotas.admin);
  app.use('/webhook', rotas.webhook);
  app.use(prefixosApi, naoEncontrado);

  app.use((req, res) => res.status(404).sendFile(path.join(PASTA_PUBLICA, '404.html')));
  app.use(tratarErros(logger));
  return app;
}

module.exports = { criarApp, PASTA_PUBLICA };
