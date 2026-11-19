'use strict';

const crypto = require('node:crypto');

/** Comparação em tempo constante de segredos (tokens). */
function iguaisEmTempoConstante(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * Identificador pseudonimizado da sessão de conversa (LGPD): HMAC-SHA-256 com segredo do servidor.
 * Hoje recebe um identificador local de demonstração; no futuro, o número do WhatsApp.
 */
function hashUsuario(canal, identificador, segredo) {
  return crypto.createHmac('sha256', segredo).update(`${canal}:${identificador}`).digest('hex');
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Token de sessão administrativa assinado (HMAC-SHA-256), sem estado no servidor. */
function assinarToken(payload, segredo, validadeS, agora = Date.now()) {
  const corpo = b64url(JSON.stringify({ ...payload, iat: Math.floor(agora / 1000), exp: Math.floor(agora / 1000) + validadeS }));
  const assinatura = b64url(crypto.createHmac('sha256', segredo).update(corpo).digest());
  return `${corpo}.${assinatura}`;
}

function verificarToken(token, segredo, agora = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  const [corpo, assinatura] = partes;
  const esperada = b64url(crypto.createHmac('sha256', segredo).update(corpo).digest());
  if (!iguaisEmTempoConstante(assinatura, esperada)) return null;
  try {
    const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 <= agora) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Remove valores sensíveis de query strings antes de registrar logs. */
function urlSemSegredos(url) {
  return String(url || '').replace(/([?&](?:token|senha|password|key)=)[^&]*/gi, '$1***');
}

module.exports = { iguaisEmTempoConstante, hashUsuario, assinarToken, verificarToken, urlSemSegredos };
