'use strict';

/** Leitura e escrita de cookies sem dependências externas. */

function lerCookies(cabecalho) {
  const resultado = {};
  if (typeof cabecalho !== 'string' || !cabecalho) return resultado;
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const nome = parte.slice(0, i).trim();
    const valor = parte.slice(i + 1).trim();
    if (!nome || Object.prototype.hasOwnProperty.call(resultado, nome)) continue;
    try {
      resultado[nome] = decodeURIComponent(valor);
    } catch {
      resultado[nome] = valor;
    }
  }
  return resultado;
}

function serializarCookie(nome, valor, { maxAgeS, httpOnly = true, sameSite = 'Strict', secure = false, path = '/' } = {}) {
  const partes = [`${nome}=${encodeURIComponent(valor)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (maxAgeS !== undefined) partes.push(`Max-Age=${Math.max(0, Math.floor(maxAgeS))}`);
  if (httpOnly) partes.push('HttpOnly');
  if (secure) partes.push('Secure');
  return partes.join('; ');
}

module.exports = { lerCookies, serializarCookie };
