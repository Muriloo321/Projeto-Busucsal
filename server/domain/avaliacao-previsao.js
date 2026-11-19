'use strict';

const { mediaVelocidade, calcularPrevisao, TIPOS } = require('./previsao');
const { STATUS } = require('./status');

/**
 * Avaliação do erro da previsão (critério da Seção 8: erro médio ≤ 3 min em pelo menos 10 viagens).
 *
 * Reprocessa o histórico gravado em posicao_veiculo: para cada viagem detectada, descobre o
 * instante real em que o ônibus alcançou cada ponto e compara com a previsão que o sistema
 * teria informado em cada posição anterior, usando exatamente as mesmas regras do RF03.
 */

const tempo = (p) => new Date(p.registrado_em).getTime();

function segmentarViagens(posicoes, { toleranciaRetrocessoM, intervaloMaxViagemMin }) {
  const viagens = [];
  let atual = null;
  for (const p of posicoes) {
    if (p.rota_id === null || p.rota_id === undefined || !Number.isFinite(Number(p.progresso_m))) {
      atual = null;
      continue;
    }
    const progresso = Number(p.progresso_m);
    const quebra = !atual
      || atual.rota_id !== p.rota_id
      || progresso < Number(atual.ultimo.progresso_m) - toleranciaRetrocessoM
      || tempo(p) - tempo(atual.ultimo) > intervaloMaxViagemMin * 60 * 1000;
    if (quebra) {
      atual = { rota_id: p.rota_id, posicoes: [], fontes: new Set(), ultimo: null };
      viagens.push(atual);
    }
    atual.posicoes.push({ ...p, progresso_m: progresso });
    atual.fontes.add(p.fonte);
    atual.ultimo = p;
  }
  return viagens.map((v) => ({ rota_id: v.rota_id, posicoes: v.posicoes, fontes: [...v.fontes] }));
}

/** Instante (ms) em que a viagem alcança o ponto, com interpolação linear entre duas posições. */
function instanteChegada(posicoes, progressoPonto, raioM) {
  const alvo = progressoPonto - raioM;
  for (let i = 0; i < posicoes.length; i += 1) {
    if (posicoes[i].progresso_m >= alvo) {
      if (i === 0) return null; // a viagem já começou no ponto ou depois dele
      const a = posicoes[i - 1];
      const b = posicoes[i];
      const avanco = b.progresso_m - a.progresso_m;
      const fracao = avanco > 0 ? (alvo - a.progresso_m) / avanco : 1;
      return tempo(a) + Math.min(1, Math.max(0, fracao)) * (tempo(b) - tempo(a));
    }
  }
  return null;
}

function avaliarViagem(viagem, pontos, parametros) {
  const resultados = [];
  for (const ponto of pontos) {
    if (!Number.isFinite(Number(ponto.progresso_m))) continue;
    const chegada = instanteChegada(viagem.posicoes, Number(ponto.progresso_m), parametros.raioChegadaM);
    if (chegada === null) continue;
    for (let i = 0; i < viagem.posicoes.length; i += 1) {
      const pos = viagem.posicoes[i];
      const t = tempo(pos);
      if (t >= chegada) break;
      const agora = new Date(t);
      const { media_kmh } = mediaVelocidade(viagem.posicoes.slice(0, i + 1), agora, parametros.janelaVelocidadeMin);
      const prev = calcularPrevisao({
        statusCodigo: STATUS.EM_CIRCULACAO,
        idadeDadosS: 0,
        progressoOnibusM: pos.progresso_m,
        progressoPontoM: Number(ponto.progresso_m),
        mesmoSentido: true,
        velocidadeMediaKmh: media_kmh,
        parametros,
      });
      if (prev.tipo !== TIPOS.PREVISAO) continue;
      const previsto = t + prev.minutos * 60 * 1000;
      resultados.push({
        ponto_id: ponto.id,
        erro_min: Math.abs(previsto - chegada) / 60000,
        antecedencia_min: (chegada - t) / 60000,
      });
    }
  }
  return resultados;
}

const media = (valores) => (valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null);
const arred = (v) => (v === null ? null : Math.round(v * 100) / 100);

/**
 * @param {object} p
 * @param {Array} p.posicoes posições em ordem cronológica
 * @param {Map<number, Array<{id, progresso_m}>>} p.pontosPorRota
 * @param {object} p.parametros
 */
function avaliarHistorico({ posicoes, pontosPorRota, parametros }) {
  const viagens = segmentarViagens(posicoes, parametros);
  const avaliadas = [];
  const erros = [];
  for (const v of viagens) {
    const res = avaliarViagem(v, pontosPorRota.get(v.rota_id) || [], parametros);
    if (res.length === 0) continue;
    erros.push(...res.map((r) => r.erro_min));
    avaliadas.push({
      rota_id: v.rota_id,
      inicio: v.posicoes[0].registrado_em,
      fim: v.posicoes[v.posicoes.length - 1].registrado_em,
      fontes: v.fontes,
      previsoes: res.length,
      pontos_alcancados: new Set(res.map((r) => r.ponto_id)).size,
      erro_medio_min: arred(media(res.map((r) => r.erro_min))),
    });
  }
  return {
    viagens_detectadas: viagens.length,
    viagens_avaliadas: avaliadas.length,
    previsoes_avaliadas: erros.length,
    erro_medio_min: arred(media(erros)),
    somente_dados_simulados: avaliadas.length > 0 && avaliadas.every((v) => !v.fontes.includes('rastreador')),
    viagens: avaliadas.slice(-20),
  };
}

module.exports = { segmentarViagens, instanteChegada, avaliarViagem, avaliarHistorico };
