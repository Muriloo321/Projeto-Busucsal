'use strict';

const { dentroDaJanela } = require('./tempo');

/**
 * Regras da Seção 4.2 do Planejamento Técnico (RF02 e RNF06).
 * Ordem de avaliação: Fora de operação → Sem dados → Parado → Em circulação.
 */

const STATUS = Object.freeze({
  EM_CIRCULACAO: 'em_circulacao',
  PARADO: 'parado',
  SEM_DADOS: 'sem_dados',
  FORA_DE_OPERACAO: 'fora_de_operacao',
});

const ROTULOS = Object.freeze({
  em_circulacao: 'Em circulação',
  parado: 'Parado',
  sem_dados: 'Sem dados',
  fora_de_operacao: 'Fora de operação',
});

/** Aviso vigente = ativo e com o instante atual dentro de [inicio, fim). */
function avisoVigente(aviso, agora) {
  if (!aviso || !aviso.ativo) return false;
  const inicio = new Date(aviso.inicio).getTime();
  const fim = new Date(aviso.fim).getTime();
  const t = agora.getTime();
  return t >= inicio && t < fim;
}

/** Rotas ativas cuja janela de horário contém o instante atual. */
function rotasNaGrade(rotas, agora, fuso) {
  return (rotas || []).filter((r) => r.ativa !== false && dentroDaJanela(agora, r.horario_inicio, r.horario_fim, fuso));
}

/**
 * Mantém o instante a partir do qual o veículo está com velocidade perto de zero.
 * Chamado a cada posição recebida (em ordem cronológica).
 */
function proximoParadoDesde(paradoDesdeAnterior, velocidadeKmh, registradoEm, limiarKmh) {
  // Velocidade não informada: não há evidência nova — mantém a situação anterior.
  if (velocidadeKmh === null || velocidadeKmh === undefined || !Number.isFinite(Number(velocidadeKmh))) {
    return paradoDesdeAnterior ? new Date(paradoDesdeAnterior) : null;
  }
  if (Number(velocidadeKmh) <= limiarKmh) {
    return paradoDesdeAnterior ? new Date(paradoDesdeAnterior) : new Date(registradoEm);
  }
  return null;
}

/**
 * Calcula o status do serviço a partir dos dados (não há botão manual como fonte da informação).
 * @returns {{codigo, rotulo, motivo, idade_s?, parado_ha_s?, aviso_id?}}
 */
function calcularStatus({ agora, rotas, avisos, ultimaAtualizacao, paradoDesde, parametros, fuso }) {
  const resultado = (codigo, motivo, extra = {}) => ({ codigo, rotulo: ROTULOS[codigo], motivo, ...extra });

  const interrupcao = (avisos || []).find((a) => a.interrompe_operacao && avisoVigente(a, agora));
  if (interrupcao) {
    return resultado(STATUS.FORA_DE_OPERACAO, 'aviso_interrupcao', { aviso_id: interrupcao.id });
  }

  if (rotasNaGrade(rotas, agora, fuso).length === 0) {
    return resultado(STATUS.FORA_DE_OPERACAO, 'fora_da_grade');
  }

  if (!ultimaAtualizacao) {
    return resultado(STATUS.SEM_DADOS, 'nenhuma_posicao');
  }

  const idadeS = Math.max(0, (agora.getTime() - new Date(ultimaAtualizacao).getTime()) / 1000);
  if (idadeS > parametros.limiteDadosVencidosS) {
    return resultado(STATUS.SEM_DADOS, 'posicao_vencida', { idade_s: Math.round(idadeS) });
  }

  if (paradoDesde) {
    const paradoHaS = (agora.getTime() - new Date(paradoDesde).getTime()) / 1000;
    if (paradoHaS > parametros.tempoParadoMin * 60) {
      return resultado(STATUS.PARADO, 'velocidade_perto_de_zero', {
        idade_s: Math.round(idadeS),
        parado_ha_s: Math.round(paradoHaS),
      });
    }
  }

  return resultado(STATUS.EM_CIRCULACAO, 'posicao_recente', { idade_s: Math.round(idadeS) });
}

module.exports = {
  STATUS,
  ROTULOS,
  avisoVigente,
  rotasNaGrade,
  proximoParadoDesde,
  calcularStatus,
};
