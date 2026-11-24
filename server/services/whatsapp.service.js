'use strict';

const crypto = require('node:crypto');
const { iguaisEmTempoConstante } = require('../utils/seguranca');

const LIMITE_TEXTO_ENTRADA = 500; // mesmo limite do simulador (validarMensagem)
const LIMITE_TEXTO_SAIDA = 4096; // máximo do WhatsApp para mensagens de texto
const RETENCAO_IDS_MS = 60 * 60 * 1000;

const MSG_SOMENTE_TEXTO = 'Por enquanto eu só entendo mensagens de texto. Escreva, por exemplo: "quando o ônibus chega?"';
const MSG_ERRO = 'Tive um problema para consultar as informações agora. Tente novamente em instantes.';

/**
 * Integração com a WhatsApp Cloud API (Meta): valida a assinatura do webhook, extrai as mensagens de
 * texto, entrega ao assistente (`conversa.processar`, canal 'whatsapp') e envia a resposta.
 */
function criarWhatsappService({ config, conversaService, logger, relogio = { agora: () => new Date() }, fetchImpl = globalThis.fetch }) {
  const wa = config.whatsapp;
  const vistos = new Map(); // id da mensagem -> instante (a Meta reenvia o webhook se não receber 200)

  const ativo = () => wa.ativo;

  /** Verificação inicial (GET): devolve o `hub.challenge` ou null. */
  function verificarInscricao(query) {
    if (!wa.ativo) return null;
    const q = query || {};
    if (q['hub.mode'] !== 'subscribe') return null;
    if (!iguaisEmTempoConstante(String(q['hub.verify_token'] || ''), wa.verifyToken)) return null;
    const desafio = q['hub.challenge'];
    return typeof desafio === 'string' && desafio.length > 0 && desafio.length <= 200 ? desafio : null;
  }

  /** Confere o cabeçalho X-Hub-Signature-256 (HMAC-SHA-256 do corpo bruto com o App Secret). */
  function assinaturaValida(corpoBruto, cabecalho) {
    if (!wa.ativo || !Buffer.isBuffer(corpoBruto) || typeof cabecalho !== 'string') return false;
    const m = /^sha256=([0-9a-f]{64})$/i.exec(cabecalho.trim());
    if (!m) return false;
    const esperado = crypto.createHmac('sha256', wa.appSecret).update(corpoBruto).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(esperado, 'hex'), Buffer.from(m[1].toLowerCase(), 'hex'));
  }

  /** Extrai as mensagens recebidas do payload da Meta (ignora status de entrega, etc.). */
  function extrairMensagens(payload) {
    const saida = [];
    if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return saida;
    for (const entrada of payload.entry) {
      for (const mudanca of (entrada && Array.isArray(entrada.changes) ? entrada.changes : [])) {
        const valor = mudanca && mudanca.field === 'messages' ? mudanca.value : null;
        if (!valor || !Array.isArray(valor.messages)) continue;
        // Ignora eventos de outro número da mesma conta.
        if (valor.metadata && valor.metadata.phone_number_id && valor.metadata.phone_number_id !== wa.phoneNumberId) continue;
        for (const msg of valor.messages) {
          if (!msg || typeof msg.from !== 'string' || !/^\d{5,20}$/.test(msg.from)) continue;
          saida.push({
            id: typeof msg.id === 'string' ? msg.id : null,
            de: msg.from,
            tipo: msg.type,
            texto: msg.type === 'text' && msg.text && typeof msg.text.body === 'string' ? msg.text.body : null,
          });
        }
      }
    }
    return saida;
  }

  function jaProcessada(id) {
    const agora = relogio.agora().getTime();
    for (const [chave, quando] of vistos) if (agora - quando > RETENCAO_IDS_MS) vistos.delete(chave);
    if (!id) return false;
    if (vistos.has(id)) return true;
    vistos.set(id, agora);
    return false;
  }

  /** Envia uma mensagem de texto pela Cloud API. */
  async function enviarTexto(para, texto) {
    const corpo = texto.length > LIMITE_TEXTO_SAIDA ? `${texto.slice(0, LIMITE_TEXTO_SAIDA - 1)}…` : texto;
    const url = `${wa.baseUrl}/${wa.versaoApi}/${wa.phoneNumberId}/messages`;
    const resposta = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${wa.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'text', text: { preview_url: false, body: corpo } }),
      signal: AbortSignal.timeout(wa.timeoutEnvioMs),
    });
    if (!resposta.ok) {
      let detalhe = '';
      try { const j = await resposta.json(); detalhe = j && j.error ? `${j.error.code || ''} ${j.error.message || ''}`.trim() : ''; } catch { /* sem corpo */ }
      throw new Error(`WhatsApp respondeu HTTP ${resposta.status}${detalhe ? `: ${detalhe}` : ''}`);
    }
  }

  async function tratarMensagem(m) {
    if (jaProcessada(m.id)) return { ignorada: 'duplicada' };
    let resposta;
    if (m.tipo !== 'text' || !m.texto || !m.texto.trim()) {
      resposta = MSG_SOMENTE_TEXTO;
    } else {
      try {
        const r = await conversaService.processar({
          canal: 'whatsapp', identificador: m.de, mensagem: m.texto.trim().slice(0, LIMITE_TEXTO_ENTRADA),
        });
        resposta = r.resposta;
      } catch (erro) {
        logger.erro('WhatsApp: falha ao processar a mensagem', { mensagem: erro.message });
        resposta = MSG_ERRO;
      }
    }
    try {
      await enviarTexto(m.de, resposta);
      return { enviada: true };
    } catch (erro) {
      logger.erro('WhatsApp: falha ao enviar a resposta', { mensagem: erro.message });
      return { enviada: false };
    }
  }

  /** Processa o payload inteiro. Nunca lança: o webhook já respondeu 200 à Meta. */
  async function processarPayload(payload) {
    const mensagens = extrairMensagens(payload);
    const resultados = [];
    for (const m of mensagens) resultados.push(await tratarMensagem(m));
    return resultados;
  }

  const pendentes = new Set();
  /** Agenda o processamento em segundo plano (a Meta exige resposta HTTP 200 rápida). */
  function agendar(payload) {
    const tarefa = processarPayload(payload)
      .catch((erro) => logger.erro('WhatsApp: falha inesperada no processamento', { mensagem: erro.message }))
      .finally(() => pendentes.delete(tarefa));
    pendentes.add(tarefa);
    return tarefa;
  }
  /** Espera o que está em andamento (encerramento do servidor e testes). */
  const aguardarPendentes = () => Promise.all([...pendentes]);

  return { ativo, verificarInscricao, assinaturaValida, extrairMensagens, enviarTexto, processarPayload, agendar, aguardarPendentes };
}

module.exports = { criarWhatsappService, MSG_SOMENTE_TEXTO, MSG_ERRO };
