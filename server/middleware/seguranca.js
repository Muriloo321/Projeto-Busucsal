'use strict';

const { UnauthorizedError, ForbiddenError, AppError } = require('../utils/errors');
const { iguaisEmTempoConstante } = require('../utils/seguranca');
const { lerCookies } = require('../utils/cookies');
const { ipDoCliente, ehLoopback, ehRedePrivada, asyncHandler } = require('../utils/http');

/** Cabeçalhos de segurança. CSP sem 'unsafe-inline': todo JS e CSS vêm de arquivos locais. */
function cabecalhosSeguranca(req, res, next) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
    "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'self'",
    "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
}

/** Respostas da API nunca são guardadas em cache. */
function semCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Token do dispositivo rastreador: cabeçalho X-Device-Token, Authorization: Bearer ou ?token= (Traccar Client). */
function exigirTokenDispositivo(config) {
  return function tokenDispositivo(req, res, next) {
    const autorizacao = req.get('authorization') || '';
    const bearer = autorizacao.toLowerCase().startsWith('bearer ') ? autorizacao.slice(7).trim() : null;
    const token = req.get('x-device-token') || bearer || (req.query && typeof req.query.token === 'string' ? req.query.token : null);
    if (!token) return next(new UnauthorizedError('Token do dispositivo ausente.', 'token_ausente'));
    if (!iguaisEmTempoConstante(token, config.rastreador.token)) {
      return next(new UnauthorizedError('Token do dispositivo inválido.', 'token_invalido'));
    }
    return next();
  };
}

/** Lê o cookie de sessão e, se válido, preenche req.admin. */
function carregarAdmin(config, authService) {
  return asyncHandler(async (req, res, next) => {
    const token = lerCookies(req.headers.cookie)[config.sessaoAdmin.nomeCookie];
    req.admin = token ? await authService.autenticar(token) : null;
    next();
  });
}

function exigirAdmin(req, res, next) {
  if (!req.admin) return next(new UnauthorizedError('Faça login para continuar.'));
  return next();
}

/**
 * Proteção "Interno" do planejamento para GET /api/estado e endpoints da demonstração:
 * aceita chamadas locais (loopback), da rede privada (se habilitado), com X-Internal-Token
 * ou de um membro da equipe autenticado. Não é uma API pública.
 */
function exigirAcessoInterno(config) {
  return function acessoInterno(req, res, next) {
    const ip = ipDoCliente(req);
    if (ehLoopback(ip)) return next();
    if (config.acessoInterno.permitirRedePrivada && ehRedePrivada(ip)) return next();
    const token = req.get('x-internal-token');
    if (config.acessoInterno.token && token && iguaisEmTempoConstante(token, config.acessoInterno.token)) return next();
    if (req.admin) return next();
    return next(new ForbiddenError('Endpoint de uso interno.', 'acesso_interno'));
  };
}

/** Exige corpo JSON em métodos que alteram dados (mitiga CSRF: formulários de outros sites não enviam JSON). */
function exigirJson(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const tipo = String(req.get('content-type') || '');
    const temCorpo = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding');
    if ((req.method !== 'DELETE' || temCorpo) && !tipo.toLowerCase().startsWith('application/json')) {
      return next(new AppError('Envie o corpo como application/json.', { status: 415, codigo: 'tipo_nao_suportado' }));
    }
  }
  return next();
}

function exigirModoDemo(config) {
  return function modoDemo(req, res, next) {
    if (!config.demo.ativo) return next(new AppError('Modo de demonstração desativado (DEMO_MODE=false).', { status: 404, codigo: 'demo_desativado' }));
    return next();
  };
}

module.exports = {
  cabecalhosSeguranca,
  semCache,
  exigirTokenDispositivo,
  carregarAdmin,
  exigirAdmin,
  exigirAcessoInterno,
  exigirJson,
  exigirModoDemo,
};
