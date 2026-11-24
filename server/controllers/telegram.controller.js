'use strict';

const { AppError, UnauthorizedError } = require('../utils/errors');

/** POST /webhook/telegram — atualizações enviadas pelo Telegram. */
function criarTelegramController({ servicos }) {
  const { telegram } = servicos;
  return {
    receber(req, res) {
      if (!telegram.ativo()) {
        throw new AppError('Integração com o Telegram desativada. Defina TELEGRAM_ENABLED=true e o token do bot no .env.', { status: 501, codigo: 'nao_implementado' });
      }
      if (!telegram.segredoValido(req.get('x-telegram-bot-api-secret-token'))) {
        throw new UnauthorizedError('Segredo do webhook inválido.', 'segredo_invalido');
      }
      res.sendStatus(200);
      telegram.agendar(req.body);
    },
  };
}

module.exports = { criarTelegramController };
