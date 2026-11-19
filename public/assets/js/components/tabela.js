import { el, vazio } from '../dom.js';

/**
 * Tabela genérica. Cada coluna: { titulo, valor: (linha) => texto|Node, classe? }.
 * Valores são sempre inseridos como texto/nós (sem HTML).
 */
export function tabela({ colunas, linhas, textoVazio = 'Nenhum registro.', compacta = false, rotulo }) {
  if (!linhas || linhas.length === 0) return vazio(textoVazio);
  return el('div', { class: 'tabela-rolagem' },
    el('table', { class: ['tabela', compacta && 'tabela--compacta'], 'aria-label': rotulo },
      el('thead', {}, el('tr', {}, colunas.map((c) => el('th', { class: c.classe, scope: 'col' }, c.titulo)))),
      el('tbody', {}, linhas.map((l) => el('tr', {}, colunas.map((c) => {
        const v = c.valor(l);
        return el('td', { class: c.classe }, v === null || v === undefined || v === '' ? '—' : v);
      }))))));
}

/** Converte qualquer valor vindo do banco em texto legível para o inspetor. */
export function textoCelula(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
