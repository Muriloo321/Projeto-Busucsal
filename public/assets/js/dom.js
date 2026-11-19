/**
 * Construção de elementos sem innerHTML: todo texto entra como nó de texto,
 * então mensagens, avisos e dados vindos do servidor nunca são interpretados como HTML.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function aplicar(elemento, props) {
  for (const [chave, valor] of Object.entries(props || {})) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (chave === 'class') elemento.setAttribute('class', Array.isArray(valor) ? valor.filter(Boolean).join(' ') : valor);
    else if (chave === 'text') elemento.textContent = String(valor);
    else if (chave === 'dataset') Object.assign(elemento.dataset, valor);
    else if (chave === 'style') for (const [k, v] of Object.entries(valor)) elemento.style.setProperty(k, String(v));
    else if (chave.startsWith('on') && typeof valor === 'function') elemento.addEventListener(chave.slice(2), valor);
    else if (valor === true) elemento.setAttribute(chave, '');
    else elemento.setAttribute(chave, String(valor));
  }
}

function anexar(elemento, filhos) {
  for (const filho of filhos.flat(Infinity)) {
    if (filho === null || filho === undefined || filho === false) continue;
    elemento.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
}

/** el('p', { class: 'x' }, 'texto', outroElemento) */
export function el(tag, props = {}, ...filhos) {
  const elemento = document.createElement(tag);
  aplicar(elemento, props);
  anexar(elemento, filhos);
  return elemento;
}

export function svg(tag, props = {}, ...filhos) {
  const elemento = document.createElementNS(SVG_NS, tag);
  aplicar(elemento, props);
  anexar(elemento, filhos);
  return elemento;
}

export function substituir(alvo, ...filhos) {
  alvo.replaceChildren();
  anexar(alvo, filhos);
}

export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
export const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

export function carregando(texto = 'Carregando…') {
  return el('div', { class: 'estado-carregando', role: 'status' }, texto);
}

export function vazio(texto) {
  return el('div', { class: 'estado-vazio' }, texto);
}

export function erro(texto) {
  return el('div', { class: 'estado-erro', role: 'alert' }, texto);
}

/** Ícone de ônibus (SVG local, sem fonte de ícones). */
export function iconeOnibus() {
  return svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    svg('rect', { x: '4', y: '3', width: '16', height: '15', rx: '3' }),
    svg('path', { d: 'M4 11h16M8 21v-3M16 21v-3' }),
    svg('circle', { cx: '8', cy: '14.5', r: '0.6', fill: 'currentColor' }),
    svg('circle', { cx: '16', cy: '14.5', r: '0.6', fill: 'currentColor' }));
}
