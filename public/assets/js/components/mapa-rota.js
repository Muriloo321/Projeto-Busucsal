import { svg, el, substituir, vazio } from '../dom.js';

/**
 * Representação da rota em SVG a partir das coordenadas cadastradas (sem mapa externo, funciona offline).
 * Projeção equirretangular simples — adequada para um trajeto curto. As coordenadas demonstrativas
 * são sinalizadas pela página e não representam a localização oficial.
 */

const L = 640;
const MARGEM = 44;

function haversine([lon1, lat1], [lon2, lat2]) {
  const r = (g) => (g * Math.PI) / 180;
  const dLat = r(lat2 - lat1);
  const dLon = r(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

/** Trecho do trajeto do início até `metros` (apenas para desenhar o trecho percorrido). */
function trechoAte(coords, metros) {
  const saida = [coords[0]];
  let acumulado = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const d = haversine(coords[i - 1], coords[i]);
    if (acumulado + d >= metros) {
      const f = d > 0 ? (metros - acumulado) / d : 0;
      saida.push([coords[i - 1][0] + f * (coords[i][0] - coords[i - 1][0]), coords[i - 1][1] + f * (coords[i][1] - coords[i - 1][1])]);
      return saida;
    }
    acumulado += d;
    saida.push(coords[i]);
  }
  return saida;
}

function escalaBonita(metrosPorPx) {
  const opcoes = [25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  return opcoes.find((m) => m / metrosPorPx >= 70) || opcoes[opcoes.length - 1];
}

/**
 * @param {HTMLElement} alvo
 * @param {{rotas: Array, estado: object, linhaReta?: boolean}} dados
 */
export function desenharMapa(alvo, { rotas, estado, linhaReta = false }) {
  const todos = [];
  for (const r of rotas) todos.push(...r.coordenadas);
  for (const p of estado.pontos) todos.push([p.longitude, p.latitude]);
  const v = estado.veiculo;
  const temOnibus = v && Number.isFinite(v.latitude) && Number.isFinite(v.longitude);
  if (temOnibus) todos.push([v.longitude, v.latitude]);

  if (todos.length < 2) {
    substituir(alvo, vazio('Nenhum trajeto cadastrado para desenhar.'));
    return;
  }

  const lat0 = todos.reduce((s, c) => s + c[1], 0) / todos.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = todos.map((c) => c[0] * kx);
  const ys = todos.map((c) => c[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Altura acompanha o formato do trajeto (trajetos verticais ganham mais altura, até um limite).
  const proporcao = (maxY - minY) / Math.max(maxX - minX, 1e-6);
  const A = Math.round(Math.min(520, Math.max(320, (L - 2 * MARGEM) * proporcao * 0.55 + 2 * MARGEM)));
  const escala = Math.min((L - 2 * MARGEM) / Math.max(maxX - minX, 1e-6), (A - 2 * MARGEM) / Math.max(maxY - minY, 1e-6));
  const offX = (L - (maxX - minX) * escala) / 2;
  const offY = (A - (maxY - minY) * escala) / 2;
  const xy = ([lon, lat]) => [offX + (lon * kx - minX) * escala, A - offY - (lat - minY) * escala];
  const caminho = (coords) => coords.map((c, i) => { const [x, y] = xy(c); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ');

  const camadas = [];
  for (let x = 0; x <= L; x += 40) camadas.push(svg('line', { class: 'svg-grade', x1: x, y1: 0, x2: x, y2: A }));
  for (let y = 0; y <= A; y += 40) camadas.push(svg('line', { class: 'svg-grade', x1: 0, y1: y, x2: L, y2: y }));

  for (const r of rotas) {
    camadas.push(svg('path', { class: 'svg-rota-base', d: caminho(r.coordenadas) }));
    camadas.push(svg('path', { class: 'svg-rota', d: caminho(r.coordenadas) }));
  }

  const rotaAtual = estado.rota ? rotas.find((r) => r.id === estado.rota.id) : null;
  if (rotaAtual && estado.rota.progresso_m > 0) {
    camadas.push(svg('path', { class: 'svg-rota-percorrida', d: caminho(trechoAte(rotaAtual.coordenadas, estado.rota.progresso_m)) }));
  }

  const proximoId = estado.localizacao && estado.localizacao.proximo_ponto ? estado.localizacao.proximo_ponto.id : null;
  if (linhaReta && temOnibus && proximoId) {
    const alvoPonto = estado.pontos.find((p) => p.id === proximoId);
    if (alvoPonto) {
      const [x1, y1] = xy([v.longitude, v.latitude]);
      const [x2, y2] = xy([alvoPonto.longitude, alvoPonto.latitude]);
      camadas.push(svg('line', { class: 'svg-reta', x1, y1, x2, y2 }));
    }
  }

  const ordenados = [...estado.pontos].sort((a, b) => (a.progresso_m ?? a.ordem_na_rota * 1e6) - (b.progresso_m ?? b.ordem_na_rota * 1e6));
  ordenados.forEach((p, i) => {
    const [x, y] = xy([p.longitude, p.latitude]);
    const passado = p.previsao && p.previsao.tipo === 'ja_passou';
    // Rótulos alternam de lado para não se sobreporem em pontos próximos; respeitam as bordas.
    const largura = p.nome.length * 7.2 + 18;
    let direita = i % 2 === 0;
    if (direita && x + largura > L - 6) direita = false;
    if (!direita && x - largura < 6) direita = true;
    camadas.push(svg('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` },
      svg('circle', { r: 10, class: ['svg-ponto', passado && 'svg-ponto--passado'] }),
      svg('text', { class: 'svg-ponto-numero' }, String(p.ordem_na_rota)),
      svg('text', { class: 'svg-rotulo', x: direita ? 16 : -16, y: 4.5, 'text-anchor': direita ? 'start' : 'end' }, p.nome)));
  });

  if (temOnibus) {
    const [x, y] = xy([v.longitude, v.latitude]);
    const ativo = ['em_circulacao', 'parado'].includes(estado.status.codigo);
    camadas.push(svg('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, role: 'img', 'aria-label': 'Posição do ônibus' },
      svg('circle', { r: 18, class: 'svg-onibus-halo' }),
      svg('rect', { x: -10, y: -10, width: 20, height: 20, rx: 5, class: ['svg-onibus', !ativo && 'svg-onibus--inativo'] }),
      svg('path', { d: 'M-5 -4h10M-5 1h10', stroke: '#fff', 'stroke-width': 2, 'stroke-linecap': 'round' })));
  }

  const metrosPorPx = 111320 / escala;
  const metrosEscala = escalaBonita(metrosPorPx);
  const pxEscala = metrosEscala / metrosPorPx;
  camadas.push(svg('g', { transform: `translate(16 ${A - 18})` },
    svg('line', { class: 'svg-escala', x1: 0, y1: 0, x2: pxEscala, y2: 0 }),
    svg('line', { class: 'svg-escala', x1: 0, y1: -4, x2: 0, y2: 4 }),
    svg('line', { class: 'svg-escala', x1: pxEscala, y1: -4, x2: pxEscala, y2: 4 }),
    svg('text', { class: 'svg-escala-texto', x: pxEscala + 6, y: 4 }, metrosEscala >= 1000 ? `${metrosEscala / 1000} km` : `${metrosEscala} m`)));
  camadas.push(svg('g', { transform: `translate(${L - 22} 24)` },
    svg('path', { d: 'M0 -12 L5 2 L0 -1 L-5 2 Z', fill: '#3b4a66' }),
    svg('text', { class: 'svg-escala-texto', x: 0, y: 14, 'text-anchor': 'middle' }, 'N')));

  substituir(alvo, el('div', { class: 'mapa' },
    svg('svg', { viewBox: `0 0 ${L} ${A}`, role: 'img', 'aria-label': 'Representação do trajeto, dos pontos de embarque e da posição do ônibus' }, camadas)));
}
