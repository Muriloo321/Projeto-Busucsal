'use strict';

/** Encaminha erros de handlers assíncronos ao middleware central (compatível com Express 4 e 5). */
function asyncHandler(fn) {
  return function handler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Endereço do cliente, normalizado (sem prefixo IPv4-mapeado). */
function ipDoCliente(req) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function ehLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.');
}

function ehRedePrivada(ip) {
  return /^10\./.test(ip)
    || /^192\.168\./.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    || /^f[cd][0-9a-f]{2}:/i.test(ip)
    || /^fe80:/i.test(ip);
}

module.exports = { asyncHandler, ipDoCliente, ehLoopback, ehRedePrivada };
