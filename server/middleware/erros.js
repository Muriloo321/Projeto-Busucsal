'use strict';

const { AppError, NotFoundError } = require('../utils/errors');
const { ehIndisponibilidadeBanco, traduzirErroRestricao } = require('../db/erros');

/** Rotas de API inexistentes respondem JSON (as páginas têm seu próprio 404). */
function naoEncontrado(req, res, next) {
  next(new NotFoundError(`Rota não encontrada: ${req.method} ${req.path}`));
}

/** Tratamento centralizado de erros: sempre { erro: { codigo, mensagem, detalhes? } }. */
function tratarErros(logger) {
  // eslint-disable-next-line no-unused-vars
  return function tratador(erro, req, res, next) {
    if (res.headersSent) return next(erro);

    let status = 500;
    let corpo = { codigo: 'erro_interno', mensagem: 'Erro interno do servidor.' };

    if (erro instanceof AppError) {
      status = erro.status;
      corpo = { codigo: erro.codigo, mensagem: erro.message };
      if (erro.detalhes !== undefined) corpo.detalhes = erro.detalhes;
    } else if (erro && erro.type === 'entity.parse.failed') {
      status = 400;
      corpo = { codigo: 'json_invalido', mensagem: 'O corpo da requisição não é um JSON válido.' };
    } else if (erro && erro.type === 'entity.too.large') {
      status = 413;
      corpo = { codigo: 'corpo_grande_demais', mensagem: 'Corpo da requisição grande demais.' };
    } else if (ehIndisponibilidadeBanco(erro)) {
      status = 503;
      corpo = { codigo: 'banco_indisponivel', mensagem: 'Banco de dados indisponível no momento. Tente novamente em instantes.' };
      logger.erro('Banco indisponível', { rota: `${req.method} ${req.path}`, mensagem: erro.message });
    } else {
      const restricao = traduzirErroRestricao(erro);
      if (restricao) {
        status = restricao.status;
        corpo = { codigo: restricao.codigo, mensagem: restricao.mensagem };
      }
    }

    if (status >= 500 && corpo.codigo === 'erro_interno') {
      logger.erro('Erro não tratado', { rota: `${req.method} ${req.path}`, mensagem: erro && erro.message, pilha: erro && erro.stack });
    }
    if (status === 503) res.setHeader('Retry-After', '10');
    return res.status(status).json({ erro: corpo });
  };
}

module.exports = { naoEncontrado, tratarErros };
