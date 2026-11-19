'use strict';

const { STATUS } = require('./status');

/**
 * Regras da Seção 4.1 do Planejamento Técnico (RF03).
 * As distâncias ao longo da rota (progresso em metros) são calculadas pelo PostGIS;
 * este módulo apenas aplica as regras sobre esses valores.
 */

const TIPOS = Object.freeze({
  PREVISAO: 'previsao',
  NO_PONTO: 'no_ponto',
  JA_PASSOU: 'ja_passou',
  INDISPONIVEL: 'indisponivel',
});

/**
 * Média das velocidades informadas nas posições da janela (padrão: últimos 5 min).
 * @param {Array<{registrado_em, velocidade_kmh}>} posicoes
 */
function mediaVelocidade(posicoes, agora, janelaMin) {
  const inicio = agora.getTime() - janelaMin * 60 * 1000;
  const valores = (posicoes || [])
    .filter((p) => {
      const t = new Date(p.registrado_em).getTime();
      const informada = p.velocidade_kmh !== null && p.velocidade_kmh !== undefined && p.velocidade_kmh !== '';
      return t > inicio && t <= agora.getTime() && informada && Number.isFinite(Number(p.velocidade_kmh));
    })
    .map((p) => Number(p.velocidade_kmh));
  if (valores.length === 0) return { media_kmh: null, amostras: 0 };
  const media = valores.reduce((a, b) => a + b, 0) / valores.length;
  return { media_kmh: Math.round(media * 100) / 100, amostras: valores.length };
}

/**
 * Previsão de chegada a um ponto.
 * @param {object} p
 * @param {string} p.statusCodigo           status calculado do serviço
 * @param {number|null} p.idadeDadosS       idade da última posição em segundos
 * @param {number|null} p.progressoOnibusM  distância percorrida pelo ônibus ao longo da rota atual
 * @param {number|null} p.progressoPontoM   posição do ponto ao longo da mesma rota
 * @param {boolean} p.mesmoSentido          o ponto pertence ao sentido da rota atual
 * @param {number|null} p.velocidadeMediaKmh média dos últimos minutos
 * @param {object} p.parametros             { limiteDadosVencidosS, velocidadeMinimaKmh, raioChegadaM }
 */
function calcularPrevisao({
  statusCodigo, idadeDadosS, progressoOnibusM, progressoPontoM, mesmoSentido, velocidadeMediaKmh, parametros,
}) {
  const indisponivel = (motivo) => ({ tipo: TIPOS.INDISPONIVEL, motivo });

  if (statusCodigo === STATUS.FORA_DE_OPERACAO) return indisponivel('fora_de_operacao');
  // Nunca calcular com dado vencido (RNF06), mesmo que o status ainda não tenha sido recalculado.
  if (statusCodigo === STATUS.SEM_DADOS || idadeDadosS === null || idadeDadosS === undefined
      || idadeDadosS > parametros.limiteDadosVencidosS) {
    return indisponivel('dados_vencidos');
  }
  if (progressoOnibusM === null || progressoOnibusM === undefined) return indisponivel('onibus_fora_do_trajeto');
  if (!mesmoSentido) return indisponivel('outro_sentido');
  if (progressoPontoM === null || progressoPontoM === undefined) return indisponivel('ponto_fora_do_trajeto');

  const distanciaM = progressoPontoM - progressoOnibusM;

  if (distanciaM <= -parametros.raioChegadaM) {
    return { tipo: TIPOS.JA_PASSOU, distancia_rota_m: Math.round(-distanciaM) };
  }
  if (Math.abs(distanciaM) < parametros.raioChegadaM) {
    return { tipo: TIPOS.NO_PONTO, distancia_rota_m: Math.round(Math.max(0, distanciaM)) };
  }

  const medida = Number.isFinite(velocidadeMediaKmh) ? velocidadeMediaKmh : 0;
  const velocidadeUsada = Math.max(medida, parametros.velocidadeMinimaKmh);
  const minutosExatos = (distanciaM / 1000 / velocidadeUsada) * 60;

  return {
    tipo: TIPOS.PREVISAO,
    minutos: Math.max(1, Math.round(minutosExatos)),
    minutos_exatos: Math.round(minutosExatos * 100) / 100,
    distancia_rota_m: Math.round(distanciaM),
    velocidade_usada_kmh: Math.round(velocidadeUsada * 10) / 10,
    velocidade_minima_aplicada: medida < parametros.velocidadeMinimaKmh,
  };
}

module.exports = { TIPOS, mediaVelocidade, calcularPrevisao };
