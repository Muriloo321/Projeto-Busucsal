'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Registro dos indicadores da Seção 8. Só guarda o que foi realmente medido:
 * nada é preenchido com valores fixos. Persistência simples em JSON local (sem tabelas extras).
 *
 * O texto das mensagens livres fica apenas em memória (para avaliação manual) e nunca é gravado em disco.
 */
function estadoVazio() {
  return {
    versao: 1,
    iniciado_em: new Date().toISOString(),
    respostas: { total: 0, dentro_do_limite: 0, soma_ms: 0, max_ms: 0 },
    previsoes: { emitidas: 0, com_dado_vencido: 0, bloqueadas_por_dado_vencido: 0 },
    classificacao_manual: { avaliadas: 0, corretas: 0 },
    participantes: [],
  };
}

function criarMetricasService({ arquivo, logger, persistir = true }) {
  let dados = estadoVazio();
  const mensagens = []; // memória volátil: {id, texto, intencao, origem, em, avaliacao}
  let temporizador = null;

  if (persistir && arquivo) {
    try {
      if (fs.existsSync(arquivo)) {
        const lido = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
        if (lido && lido.versao === 1) dados = { ...estadoVazio(), ...lido };
      }
    } catch (erro) {
      logger.aviso('Arquivo de métricas ilegível; iniciando vazio', { arquivo, mensagem: erro.message });
    }
  }

  function agendarGravacao() {
    if (!persistir || !arquivo || temporizador) return;
    temporizador = setTimeout(() => {
      temporizador = null;
      try {
        fs.mkdirSync(path.dirname(arquivo), { recursive: true });
        const tmp = `${arquivo}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
        fs.renameSync(tmp, arquivo);
      } catch (erro) {
        logger.aviso('Falha ao gravar métricas', { mensagem: erro.message });
      }
    }, 1000);
    temporizador.unref?.();
  }

  return {
    registrarResposta({ duracaoMs, limiteMs }) {
      const r = dados.respostas;
      r.total += 1;
      if (duracaoMs <= limiteMs) r.dentro_do_limite += 1;
      r.soma_ms += duracaoMs;
      r.max_ms = Math.max(r.max_ms, duracaoMs);
      agendarGravacao();
    },

    registrarPrevisao({ idadeS, limiteS }) {
      dados.previsoes.emitidas += 1;
      if (idadeS === null || idadeS === undefined || idadeS > limiteS) dados.previsoes.com_dado_vencido += 1;
      agendarGravacao();
    },

    registrarBloqueioDadoVencido() {
      dados.previsoes.bloqueadas_por_dado_vencido += 1;
      agendarGravacao();
    },

    registrarMensagemLivre({ texto, intencao, origem }) {
      mensagens.unshift({
        id: crypto.randomUUID(), texto: String(texto).slice(0, 200), intencao, origem, em: new Date().toISOString(), avaliacao: null,
      });
      if (mensagens.length > 50) mensagens.length = 50;
    },

    mensagensRecentes: () => mensagens.map((m) => ({ ...m })),

    avaliarMensagem(id, correta) {
      const m = mensagens.find((x) => x.id === id);
      if (!m) return null;
      const c = dados.classificacao_manual;
      if (m.avaliacao !== null) { // reavaliação: desfaz a anterior
        c.avaliadas -= 1;
        if (m.avaliacao) c.corretas -= 1;
      }
      m.avaliacao = Boolean(correta);
      c.avaliadas += 1;
      if (m.avaliacao) c.corretas += 1;
      agendarGravacao();
      return { ...m };
    },

    adicionarParticipante({ turno, data }) {
      const p = { id: crypto.randomUUID(), turno, data, registrado_em: new Date().toISOString() };
      dados.participantes.push(p);
      agendarGravacao();
      return p;
    },

    removerParticipante(id) {
      const antes = dados.participantes.length;
      dados.participantes = dados.participantes.filter((p) => p.id !== id);
      agendarGravacao();
      return dados.participantes.length < antes;
    },

    zerar(secao) {
      const vazio = estadoVazio();
      if (secao && Object.prototype.hasOwnProperty.call(vazio, secao)) dados[secao] = vazio[secao];
      else dados = vazio;
      agendarGravacao();
    },

    instantaneo: () => JSON.parse(JSON.stringify(dados)),
  };
}

module.exports = { criarMetricasService };
