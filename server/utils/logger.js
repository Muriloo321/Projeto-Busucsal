'use strict';

/** Logger mínimo em uma linha por evento. Nunca registre senhas ou tokens. */
function criarLogger({ silencioso = false } = {}) {
  const escrever = (nivel, mensagem, extra) => {
    if (silencioso) return;
    const linha = `[${new Date().toISOString()}] ${nivel.toUpperCase()} ${mensagem}`;
    const sufixo = extra ? ` ${JSON.stringify(extra)}` : '';
    (nivel === 'erro' ? console.error : console.log)(linha + sufixo);
  };
  return {
    info: (m, e) => escrever('info', m, e),
    aviso: (m, e) => escrever('aviso', m, e),
    erro: (m, e) => escrever('erro', m, e),
  };
}

module.exports = { criarLogger };
