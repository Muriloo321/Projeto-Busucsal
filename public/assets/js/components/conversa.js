import { el } from '../dom.js';
import { api } from '../api.js';

/**
 * Simulador local da conversa com o assistente. Cada navegador tem um identificador de
 * demonstração próprio (nunca uma sessão global); o servidor guarda apenas o hash dele.
 */

const CHAVE = 'busucsal.sessao_local';
let memoria = null; // fallback quando o armazenamento do navegador não está disponível

function novoId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

function lerId() {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo && /^[A-Za-z0-9-]{8,64}$/.test(salvo)) return salvo;
    const id = novoId();
    localStorage.setItem(CHAVE, id);
    return id;
  } catch {
    memoria = memoria || novoId();
    return memoria;
  }
}

function trocarId() {
  const id = novoId();
  try { localStorage.setItem(CHAVE, id); } catch { memoria = id; }
  return id;
}

function agoraHHMM() {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

/**
 * @param {{mensagens: HTMLElement, formulario: HTMLFormElement, entrada: HTMLInputElement, aoResponder?: Function}} p
 */
export function criarConversa({ mensagens, formulario, entrada, aoResponder }) {
  let sessaoLocal = lerId();
  let fila = Promise.resolve();

  const rolar = () => { mensagens.scrollTop = mensagens.scrollHeight; };

  function balao(tipo, texto) {
    const b = el('div', { class: ['balao', `balao--${tipo}`] }, texto, tipo === 'sistema' ? null : el('span', { class: 'balao__hora' }, agoraHHMM()));
    mensagens.append(b);
    rolar();
    return b;
  }

  async function processar(texto, extras = {}) {
    balao('estudante', texto);
    const digitando = el('div', { class: 'balao balao--assistente balao--digitando', 'aria-hidden': 'true' }, 'digitando…');
    mensagens.append(digitando);
    rolar();
    try {
      const r = await api.post('/api/conversa/simulador', { sessao_local: sessaoLocal, mensagem: texto, ...extras });
      digitando.remove();
      balao('assistente', r.resposta);
      if (aoResponder) aoResponder(r);
    } catch (erro) {
      digitando.remove();
      balao('sistema', `Não foi possível enviar: ${erro.message}`);
    }
  }

  /** Envia em ordem (mensagens enfileiradas não se atropelam). */
  function enviar(texto, extras) {
    const limpo = String(texto || '').trim();
    if (!limpo) return fila;
    fila = fila.then(() => processar(limpo.slice(0, 500), extras));
    return fila;
  }

  async function reiniciar({ silencioso = false } = {}) {
    await fila;
    try { await api.post('/api/conversa/simulador/reiniciar', { sessao_local: sessaoLocal }); } catch { /* sessão pode nem existir */ }
    sessaoLocal = trocarId();
    mensagens.replaceChildren();
    if (!silencioso) balao('sistema', 'Nova conversa. A sessão anterior foi apagada.');
  }

  formulario.addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = entrada.value;
    entrada.value = '';
    enviar(texto);
  });

  balao('sistema', 'Simulação local da conversa. No serviço real, a conversa será pelo WhatsApp.');
  return { enviar, reiniciar, balao };
}
