import { el } from '../dom.js';

let area = null;

/** Mensagem breve no canto da tela (sucesso, erro ou informação). */
export function notificar(texto, tipo = 'info', duracaoMs = 4200) {
  if (!area) {
    area = el('div', { class: 'notificacoes', role: 'status', 'aria-live': 'polite' });
    document.body.append(area);
  }
  const item = el('div', { class: ['notificacao', tipo !== 'info' && `notificacao--${tipo}`] }, texto);
  area.append(item);
  setTimeout(() => item.remove(), duracaoMs);
}

/** Diálogo de confirmação acessível (elemento <dialog>). Resolve true/false. */
export function confirmar({ titulo, mensagem, confirmar: rotulo = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    const botaoOk = el('button', { class: ['botao', perigo && 'botao--perigo'], type: 'button' }, rotulo);
    const botaoCancelar = el('button', { class: 'botao botao--secundario', type: 'button' }, 'Cancelar');
    const dialogo = el('dialog', { class: 'dialogo', 'aria-labelledby': 'dialogo-titulo' },
      el('h2', { id: 'dialogo-titulo' }, titulo),
      el('p', {}, mensagem),
      el('div', { class: 'grupo-botoes' }, botaoOk, botaoCancelar));
    const fechar = (valor) => { dialogo.close(); dialogo.remove(); resolve(valor); };
    botaoOk.addEventListener('click', () => fechar(true));
    botaoCancelar.addEventListener('click', () => fechar(false));
    dialogo.addEventListener('cancel', (e) => { e.preventDefault(); fechar(false); });
    document.body.append(dialogo);
    dialogo.showModal();
    botaoCancelar.focus();
  });
}
