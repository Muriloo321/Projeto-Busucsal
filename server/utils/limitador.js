'use strict';

/** Limite de tentativas de login por chave (IP + e-mail), em memória. */
function criarLimitador({ maxFalhas = 5, janelaMs = 15 * 60 * 1000, relogio = { agora: () => new Date() } } = {}) {
  const registros = new Map();

  function vigente(chave) {
    const r = registros.get(chave);
    if (!r) return null;
    if (relogio.agora().getTime() - r.inicio > janelaMs) {
      registros.delete(chave);
      return null;
    }
    return r;
  }

  return {
    bloqueado: (chave) => {
      const r = vigente(chave);
      return Boolean(r && r.falhas >= maxFalhas);
    },
    falha: (chave) => {
      const r = vigente(chave) || { falhas: 0, inicio: relogio.agora().getTime() };
      r.falhas += 1;
      registros.set(chave, r);
    },
    sucesso: (chave) => registros.delete(chave),
  };
}

module.exports = { criarLimitador };
