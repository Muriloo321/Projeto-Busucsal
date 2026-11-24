'use strict';

const { iguaisEmTempoConstante } = require('../utils/seguranca');

const LIMITE_TEXTO_ENTRADA = 500; // mesmo limite do simulador e do WhatsApp
const LIMITE_TEXTO_SAIDA = 4096; // máximo do Telegram por mensagem
const RETENCAO_IDS_MS = 60 * 60 * 1000;

const MSG_SOMENTE_TEXTO = 'Por enquanto eu só entendo mensagens de texto. Escreva, por exemplo: "quando o ônibus chega?"';
const MSG_ERRO = 'Tive um problema para consultar as informações agora. Tente novamente em instantes.';

// Comandos do Telegram viram frases que o assistente já entende.
const COMANDOS = { start: 'oi', menu: 'menu', ajuda: 'menu', help: 'menu' };

/**
 * Canal Telegram (Bot API): confere o segredo do webhook, extrai a mensagem de texto, entrega ao assistente
 * (`conversa.processar`, canal 'telegram') e envia a resposta. Mesma lógica do canal WhatsApp.
 */
function criarTelegramService({ config, conversaService, logger, relogio = { agora: () => new Date() }, fetchImpl = globalThis.fetch }) {
  const tg = config.telegram;
  const vistos = new Map(); // update_id -> instante (o Telegram reenvia se não receber 200)
  const pendentes = new Set();

  const ativo = () => tg.ativo;

  /** Cabeçalho X-Telegram-Bot-Api-Secret-Token, definido no setWebhook. */
  function segredoValido(cabecalho) {
    return tg.ativo && typeof cabecalho === 'string' && iguaisEmTempoConstante(cabecalho, tg.webhookSecret);
  }

  function normalizarTexto(bruto) {
    const t = bruto.trim();
    const m = /^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/s.exec(t);
    if (!m) return t;
    const comando = m[1].toLowerCase();
    return COMANDOS[comando] || t;
  }

  /** Extrai a mensagem de um "update" do Telegram (só conversas privadas). */
  function extrairMensagem(update) {
    const msg = update && typeof update === 'object' ? update.message : null;
    if (!msg || !msg.chat || msg.chat.type !== 'private') return null;
    if (!Number.isSafeInteger(msg.chat.id)) return null;
    if (msg.from && msg.from.is_bot) return null;
    return {
      updateId: Number.isSafeInteger(update.update_id) ? update.update_id : null,
      chatId: msg.chat.id,
      texto: typeof msg.text === 'string' ? msg.text : null,
    };
  }

  function jaProcessada(id) {
    const agora = relogio.agora().getTime();
    for (const [chave, quando] of vistos) if (agora - quando > RETENCAO_IDS_MS) vistos.delete(chave);
    if (id === null) return false;
    if (vistos.has(id)) return true;
    vistos.set(id, agora);
    return false;
  }

  /** Envia texto pelo sendMessage. A URL contém o token do bot: nunca vai para logs. */
  async function enviarTexto(chatId, texto) {
    const corpo = texto.length > LIMITE_TEXTO_SAIDA ? `${texto.slice(0, LIMITE_TEXTO_SAIDA - 1)}…` : texto;
    const resposta = await fetchImpl(`${tg.baseUrl}/bot${tg.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: corpo, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(tg.timeoutEnvioMs),
    });
    let json = null;
    try { json = await resposta.json(); } catch { /* sem corpo */ }
    if (!resposta.ok || (json && json.ok === false)) {
      const detalhe = json && json.description ? `: ${json.description}` : '';
      throw new Error(`Telegram respondeu HTTP ${resposta.status}${detalhe}`);
    }
  }

  async function processarUpdate(update) {
    const m = extrairMensagem(update);
    if (!m) return { ignorada: 'sem_mensagem_privada' };
    if (jaProcessada(m.updateId)) return { ignorada: 'duplicada' };

    let resposta;
    if (!m.texto || !m.texto.trim()) {
      resposta = MSG_SOMENTE_TEXTO;
    } else {
      try {
        const r = await conversaService.processar({
          canal: 'telegram', identificador: String(m.chatId), mensagem: normalizarTexto(m.texto).slice(0, LIMITE_TEXTO_ENTRADA),
        });
        resposta = r.resposta;
      } catch (erro) {
        logger.erro('Telegram: falha ao processar a mensagem', { mensagem: erro.message });
        resposta = MSG_ERRO;
      }
    }
    try {
      await enviarTexto(m.chatId, resposta);
      return { enviada: true };
    } catch (erro) {
      logger.erro('Telegram: falha ao enviar a resposta', { mensagem: erro.message });
      return { enviada: false };
    }
  }

  /** Agenda em segundo plano (o Telegram quer HTTP 200 rápido). Nunca lança. */
  function agendar(update) {
    const tarefa = processarUpdate(update)
      .catch((erro) => logger.erro('Telegram: falha inesperada no processamento', { mensagem: erro.message }))
      .finally(() => pendentes.delete(tarefa));
    pendentes.add(tarefa);
    return tarefa;
  }
  const aguardarPendentes = () => Promise.all([...pendentes]);

  return { ativo, segredoValido, extrairMensagem, processarUpdate, enviarTexto, agendar, aguardarPendentes };
}

module.exports = { criarTelegramService, MSG_SOMENTE_TEXTO, MSG_ERRO };
