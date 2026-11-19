'use strict';

/**
 * Descrição textual da localização do ônibus em relação aos pontos de embarque,
 * usando apenas o progresso ao longo da rota (sem coordenadas cruas para o estudante).
 *
 * @param {number|null} progressoM progresso do ônibus na rota atual
 * @param {Array<{id, nome, ordem_na_rota, progresso_m}>} pontos pontos do mesmo sentido
 * @param {number} raioM raio para considerar "no ponto"
 */
function descreverLocalizacao(progressoM, pontos, raioM) {
  if (progressoM === null || progressoM === undefined || !Number.isFinite(Number(progressoM))) {
    return { tipo: 'desconhecida', texto: 'em local não identificado no trajeto', ponto_anterior: null, proximo_ponto: null, ponto_atual: null };
  }
  const ordenados = (pontos || [])
    .filter((p) => Number.isFinite(Number(p.progresso_m)))
    .sort((a, b) => a.progresso_m - b.progresso_m);
  if (ordenados.length === 0) {
    return { tipo: 'desconhecida', texto: 'no trajeto', ponto_anterior: null, proximo_ponto: null, ponto_atual: null };
  }

  const resumo = (p) => (p ? { id: p.id, nome: p.nome, ordem_na_rota: p.ordem_na_rota } : null);
  const atual = ordenados.find((p) => Math.abs(p.progresso_m - progressoM) < raioM) || null;
  const proximo = ordenados.find((p) => p.progresso_m - progressoM >= raioM) || null;
  const anteriores = ordenados.filter((p) => progressoM - p.progresso_m >= raioM);
  const anterior = anteriores.length ? anteriores[anteriores.length - 1] : null;

  if (atual) {
    return { tipo: 'no_ponto', texto: `no ponto ${atual.nome}`, ponto_atual: resumo(atual), ponto_anterior: resumo(anterior), proximo_ponto: resumo(proximo) };
  }
  if (!anterior && proximo) {
    return { tipo: 'antes_do_primeiro', texto: `a caminho do ponto ${proximo.nome}`, ponto_atual: null, ponto_anterior: null, proximo_ponto: resumo(proximo) };
  }
  if (anterior && proximo) {
    return { tipo: 'entre_pontos', texto: `entre ${anterior.nome} e ${proximo.nome}`, ponto_atual: null, ponto_anterior: resumo(anterior), proximo_ponto: resumo(proximo) };
  }
  return { tipo: 'apos_ultimo', texto: `após ${anterior.nome}, último ponto deste sentido`, ponto_atual: null, ponto_anterior: resumo(anterior), proximo_ponto: null };
}

module.exports = { descreverLocalizacao };
