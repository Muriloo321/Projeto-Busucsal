'use strict';

const { MENU } = require('./intencoes');
const { STATUS } = require('./status');
const { TIPOS } = require('./previsao');

/**
 * Textos do assistente. Todo número exibido (minutos, horários) vem do estado calculado
 * pelo backend — nunca do classificador.
 */

function minutosPorExtenso(n) {
  return `${n} ${n === 1 ? 'minuto' : 'minutos'}`;
}

function atualizado(estado) {
  const hora = estado.veiculo && estado.veiculo.ultima_atualizacao_local;
  return hora ? `atualizado às ${hora}` : 'sem posição recebida';
}

function textoAvisos(avisos) {
  if (!avisos || avisos.length === 0) return 'Sem avisos de atraso no momento.';
  return avisos.map((a) => `Aviso da equipe: ${a.texto}`).join('\n');
}

function listaPontos(opcoesPonto) {
  const sentidos = new Set(opcoesPonto.map((p) => p.sentido));
  return opcoesPonto
    .map((p) => `${p.numero_opcao}) ${p.nome}${sentidos.size > 1 ? ` (${p.sentido})` : ''}`)
    .join('\n');
}

function pedirPonto(opcoesPonto, prefixo = '') {
  if (!opcoesPonto || opcoesPonto.length === 0) {
    return `${prefixo}Ainda não há pontos de embarque cadastrados.`;
  }
  return `${prefixo}Em qual ponto você está?\n${listaPontos(opcoesPonto)}`;
}

function menu(prefixo = '') {
  return `${prefixo}Escolha uma opção enviando o número:\n${MENU.map((o) => `${o.numero}) ${o.texto}`).join('\n')}`;
}

function descricaoGrade(estado) {
  const grade = estado.grade || [];
  if (grade.length === 0) return '';
  return ` Horário de operação: ${grade.map((g) => g.horario).join(', ')}.`;
}

function textoStatus(estado) {
  const s = estado.status;
  const local = estado.localizacao ? estado.localizacao.texto : 'no trajeto';
  switch (s.codigo) {
    case STATUS.FORA_DE_OPERACAO:
      if (s.motivo === 'aviso_interrupcao') return 'O BusUCSAL está fora de operação: o serviço foi interrompido pela equipe.';
      return `O BusUCSAL está fora de operação agora (fora da grade de horários).${descricaoGrade(estado)}`;
    case STATUS.SEM_DADOS:
      if (s.motivo === 'nenhuma_posicao' || !estado.veiculo.ultima_atualizacao_local) {
        return 'Ainda não recebemos a localização do ônibus. Por isso não informamos previsão agora.';
      }
      return `Estamos sem dados recentes de localização do ônibus. A última posição foi recebida às ${estado.veiculo.ultima_atualizacao_local} (há ${Math.floor(s.idade_s / 60)} min). Para não informar algo errado, não estimamos a chegada agora.`;
    case STATUS.PARADO:
      return `O BusUCSAL está parado há cerca de ${minutosPorExtenso(Math.floor(s.parado_ha_s / 60))}, ${local} (${atualizado(estado)}).`;
    default:
      return `O BusUCSAL está em circulação, ${local} (${atualizado(estado)}).`;
  }
}

function textoPrevisao(estado, ponto) {
  const prev = ponto.previsao || { tipo: TIPOS.INDISPONIVEL, motivo: 'sem_calculo' };
  const local = estado.localizacao ? estado.localizacao.texto : 'no trajeto';
  switch (prev.tipo) {
    case TIPOS.PREVISAO:
      if (estado.status.codigo === STATUS.PARADO) {
        return `O BusUCSAL está parado há cerca de ${minutosPorExtenso(Math.floor(estado.status.parado_ha_s / 60))}, ${local}. Se voltar a circular, deve chegar ao ponto ${ponto.nome} em cerca de ${minutosPorExtenso(prev.minutos)} (${atualizado(estado)}).`;
      }
      return `O BusUCSAL está em circulação e deve chegar ao ponto ${ponto.nome} em cerca de ${minutosPorExtenso(prev.minutos)} (${atualizado(estado)}).`;
    case TIPOS.NO_PONTO:
      return `O BusUCSAL está chegando ao ponto ${ponto.nome} agora (${atualizado(estado)}).`;
    case TIPOS.JA_PASSOU:
      return `O BusUCSAL já passou pelo ponto ${ponto.nome} neste sentido. Agora ele está ${local} (${atualizado(estado)}).`;
    default:
      switch (prev.motivo) {
        case 'fora_de_operacao':
        case 'dados_vencidos':
          return textoStatus(estado);
        case 'outro_sentido':
          return `O ponto ${ponto.nome} é atendido no outro sentido da rota. O ônibus está agora ${local} (${atualizado(estado)}). Ainda não há previsão para esse ponto.`;
        case 'onibus_fora_do_trajeto':
          return `A última posição do ônibus está fora do trajeto cadastrado (${atualizado(estado)}). Não é possível estimar a chegada agora.`;
        case 'ponto_fora_do_trajeto':
          return `O ponto ${ponto.nome} não está sobre o trajeto cadastrado. A equipe precisa revisar o cadastro desse ponto.`;
        default:
          return 'Não foi possível calcular a previsão agora.';
      }
  }
}

module.exports = {
  textoAvisos,
  pedirPonto,
  menu,
  textoStatus,
  textoPrevisao,
  minutosPorExtenso,
};
