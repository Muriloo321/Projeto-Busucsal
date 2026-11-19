'use strict';

const { classificar, classificarComLimite } = require('../domain/intencoes');
const { montarOpcoesPonto, responder } = require('../domain/dialogo');
const { hashUsuario } = require('../utils/seguranca');

/**
 * Assistente de conversa independente de canal.
 * Hoje é usado pelo simulador local; o futuro webhook do WhatsApp chamará `processar`
 * com canal 'whatsapp' e o número do remetente como identificador (que é pseudonimizado aqui).
 */
function criarConversaService({ repos, config, relogio, estadoService, metricas, classificador = classificar }) {
  const { regras } = config;

  const comAtraso = (fn, ms) => (texto, contexto) => new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(fn(texto, contexto)); } catch (e) { reject(e); }
    }, ms);
  });

  async function processar({ canal = 'simulador', identificador, mensagem, demoraSimuladaMs = 0 }) {
    const inicio = process.hrtime.bigint();
    const agora = relogio.agora();
    await repos.sessao.excluirExpiradas(agora);

    const usuarioHash = hashUsuario(canal, identificador, config.hashSessaoSegredo);
    const existente = await repos.sessao.obterValida(usuarioHash, agora);
    const sessao = existente || { usuario_hash: usuarioHash, etapa_do_dialogo: 'inicio', ponto_id: null };

    const estado = await estadoService.montar();
    const opcoesPonto = montarOpcoesPonto(estado.pontos);

    const fn = demoraSimuladaMs > 0 ? comAtraso(classificador, demoraSimuladaMs) : classificador;
    const classificacao = await classificarComLimite(
      fn, mensagem, { etapa: sessao.etapa_do_dialogo, pontos: opcoesPonto }, regras.limiteClassificacaoMs,
    );

    const r = responder({ classificacao, sessao, estado, opcoesPonto });
    const pontoValido = r.ponto_id && estado.pontos.some((p) => p.id === r.ponto_id) ? r.ponto_id : null;
    const salva = await repos.sessao.salvar({
      usuarioHash, canal, etapa: r.etapa, pontoId: pontoValido, agora, validadeH: regras.validadeSessaoH,
    });

    const latenciaMs = Number(process.hrtime.bigint() - inicio) / 1e6;
    metricas.registrarResposta({ duracaoMs: latenciaMs, limiteMs: regras.limiteRespostaS * 1000 });
    if (r.previsao_emitida) metricas.registrarPrevisao({ idadeS: r.previsao_emitida.idade_dados_s, limiteS: regras.limiteDadosVencidosS });
    if (r.previsao_bloqueada) metricas.registrarBloqueioDadoVencido();
    if (classificacao.origem === 'palavras_chave' || classificacao.origem === 'tempo_excedido') {
      metricas.registrarMensagemLivre({ texto: mensagem, intencao: classificacao.intencao, origem: classificacao.origem });
    }

    return {
      resposta: r.resposta,
      intencao: classificacao.intencao,
      origem_classificacao: classificacao.origem,
      tempo_classificacao_ms: classificacao.duracao_ms,
      fallback: r.fallback,
      etapa: salva.etapa_do_dialogo,
      ponto_id: salva.ponto_id,
      latencia_ms: Math.round(latenciaMs),
      sessao: { nova: !existente, expira_em: salva.expira_em },
    };
  }

  async function reiniciar({ canal = 'simulador', identificador }) {
    const usuarioHash = hashUsuario(canal, identificador, config.hashSessaoSegredo);
    return { excluida: await repos.sessao.excluir(usuarioHash) };
  }

  return { processar, reiniciar };
}

module.exports = { criarConversaService };
