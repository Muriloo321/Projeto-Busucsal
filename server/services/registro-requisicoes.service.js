'use strict';

const { urlSemSegredos } = require('../utils/seguranca');

/**
 * Registro em memória das últimas requisições à API (logs reais, exibidos na página técnica)
 * e estatísticas de tempo de resposta por rota.
 */
function criarRegistroRequisicoes({ capacidade = 300 } = {}) {
  const itens = [];
  const porRota = new Map();

  const chaveRota = (metodo, caminho) => `${metodo} ${caminho.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[0-9a-f-]{36}(?=\/|$)/gi, '/:id')}`;

  return {
    registrar({ metodo, url, status, duracaoMs }) {
      const caminho = urlSemSegredos(url);
      const semQuery = caminho.split('?')[0];
      itens.unshift({ em: new Date().toISOString(), metodo, caminho, status, duracao_ms: Math.round(duracaoMs * 10) / 10 });
      if (itens.length > capacidade) itens.length = capacidade;

      const chave = chaveRota(metodo, semQuery);
      const e = porRota.get(chave) || { rota: chave, total: 0, erros: 0, soma_ms: 0, max_ms: 0, amostras: [] };
      e.total += 1;
      if (status >= 500) e.erros += 1;
      e.soma_ms += duracaoMs;
      e.max_ms = Math.max(e.max_ms, duracaoMs);
      e.amostras.push(duracaoMs);
      if (e.amostras.length > 200) e.amostras.shift();
      porRota.set(chave, e);
    },

    listar(limite = 100) {
      return itens.slice(0, limite);
    },

    estatisticas() {
      return [...porRota.values()].map((e) => {
        const ordenadas = [...e.amostras].sort((a, b) => a - b);
        const p95 = ordenadas.length ? ordenadas[Math.min(ordenadas.length - 1, Math.floor(ordenadas.length * 0.95))] : null;
        return {
          rota: e.rota,
          total: e.total,
          erros_5xx: e.erros,
          media_ms: Math.round((e.soma_ms / e.total) * 10) / 10,
          p95_ms: p95 === null ? null : Math.round(p95 * 10) / 10,
          max_ms: Math.round(e.max_ms * 10) / 10,
        };
      }).sort((a, b) => b.total - a.total);
    },

    limpar() {
      itens.length = 0;
      porRota.clear();
    },
  };
}

module.exports = { criarRegistroRequisicoes };
