'use strict';

const { INTENCOES } = require('./intencoes');
const { STATUS } = require('./status');
const { TIPOS } = require('./previsao');
const R = require('./respostas');

/**
 * Máquina de estados da conversa (tabela sessao_conversa).
 * Etapas: inicio → aguardando_ponto → ponto_definido; menu_principal quando o menu numerado é mostrado.
 * Função pura: recebe a classificação, a sessão e o estado calculado e devolve a resposta e a nova etapa.
 */

const ETAPAS = Object.freeze({
  INICIO: 'inicio',
  AGUARDANDO_PONTO: 'aguardando_ponto',
  MENU_PRINCIPAL: 'menu_principal',
  PONTO_DEFINIDO: 'ponto_definido',
});

const RODAPE_PONTO = '\n\nPara consultar outro ponto, envie o número dele. Para ver as opções, envie "menu".';
const RODAPE_MENU = '\n\nPara ver as opções, envie "menu".';

/** Numera os pontos ativos na ordem exibida ao estudante (sentido, ordem na rota). */
function montarOpcoesPonto(pontos) {
  return [...(pontos || [])]
    .sort((a, b) => String(a.sentido).localeCompare(String(b.sentido)) || a.ordem_na_rota - b.ordem_na_rota)
    .map((p, i) => ({ ...p, numero_opcao: i + 1 }));
}

function responder({ classificacao, sessao, estado, opcoesPonto }) {
  const pontoSessao = sessao.ponto_id || null;
  const pontoDoEstado = (id) => estado.pontos.find((p) => p.id === id) || null;
  const statusSemPrevisao = [STATUS.FORA_DE_OPERACAO, STATUS.SEM_DADOS].includes(estado.status.codigo);

  const saida = (resposta, etapa, pontoId = pontoSessao, extra = {}) => ({
    resposta,
    etapa,
    ponto_id: pontoId,
    fallback: false,
    previsao_emitida: null,
    previsao_bloqueada: false,
    ...extra,
  });

  const responderPonto = (ponto) => {
    const texto = `${R.textoPrevisao(estado, ponto)}\n${R.textoAvisos(estado.avisos)}${RODAPE_PONTO}`;
    const prev = ponto.previsao || {};
    return saida(texto, ETAPAS.PONTO_DEFINIDO, ponto.id, {
      previsao_emitida: prev.tipo === TIPOS.PREVISAO
        ? { ponto_id: ponto.id, minutos: prev.minutos, idade_dados_s: estado.veiculo.idade_s }
        : null,
      previsao_bloqueada: prev.tipo === TIPOS.INDISPONIVEL && prev.motivo === 'dados_vencidos',
    });
  };

  if (classificacao.tempo_excedido || classificacao.origem === 'erro_classificador') {
    return saida(R.menu('Não consegui entender sua mensagem a tempo. '), ETAPAS.MENU_PRINCIPAL, pontoSessao, { fallback: true });
  }

  switch (classificacao.intencao) {
    case INTENCOES.ESCOLHER_PONTO: {
      const ponto = classificacao.ponto_id ? pontoDoEstado(classificacao.ponto_id) : null;
      if (ponto) return responderPonto(ponto);
      if (classificacao.numero_invalido) {
        return saida(R.pedirPonto(opcoesPonto, `Não encontrei a opção ${classificacao.numero}. `), ETAPAS.AGUARDANDO_PONTO);
      }
      const prefixo = classificacao.ponto_ambiguo ? 'Encontrei mais de um ponto com esse nome. ' : '';
      return saida(R.pedirPonto(opcoesPonto, prefixo), ETAPAS.AGUARDANDO_PONTO);
    }

    case INTENCOES.LOCALIZACAO:
    case INTENCOES.PREVISAO: {
      const pontoId = classificacao.ponto_id || pontoSessao;
      if (statusSemPrevisao) {
        const texto = `${R.textoStatus(estado)}\n${R.textoAvisos(estado.avisos)}${RODAPE_MENU}`;
        return saida(texto, pontoId ? ETAPAS.PONTO_DEFINIDO : ETAPAS.INICIO, pontoId, {
          previsao_bloqueada: estado.status.codigo === STATUS.SEM_DADOS,
        });
      }
      const ponto = pontoId ? pontoDoEstado(pontoId) : null;
      if (ponto) return responderPonto(ponto);
      return saida(R.pedirPonto(opcoesPonto), ETAPAS.AGUARDANDO_PONTO);
    }

    case INTENCOES.STATUS:
      return saida(`${R.textoStatus(estado)}\n${R.textoAvisos(estado.avisos)}${RODAPE_MENU}`, ETAPAS.INICIO);

    case INTENCOES.AVISOS:
      return saida(`${R.textoAvisos(estado.avisos)}${RODAPE_MENU}`, ETAPAS.INICIO);

    case INTENCOES.AJUDA:
      return saida(R.menu('Sou o assistente do BusUCSAL. '), ETAPAS.MENU_PRINCIPAL);

    default: {
      const prefixo = classificacao.numero_invalido ? 'Opção inválida. ' : 'Não entendi sua mensagem. ';
      return saida(R.menu(prefixo), ETAPAS.MENU_PRINCIPAL, pontoSessao, { fallback: true });
    }
  }
}

module.exports = { ETAPAS, montarOpcoesPonto, responder };
