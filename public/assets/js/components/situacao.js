import { el, substituir } from '../dom.js';
import { hora, haQuanto, ROTULO_STATUS } from '../formatacao.js';

/** Frase curta que explica o status em linguagem do estudante. */
export function explicarStatus(estado) {
  const s = estado.status;
  const local = estado.localizacao ? estado.localizacao.texto : '';
  switch (s.codigo) {
    case 'em_circulacao':
      return `Posição recente: ${local}.`;
    case 'parado':
      return `Parado há cerca de ${Math.floor((s.parado_ha_s || 0) / 60)} min, ${local}.`;
    case 'sem_dados':
      return s.motivo === 'nenhuma_posicao'
        ? 'Nenhuma posição recebida do rastreador. Não há previsão até chegar uma posição nova.'
        : `A última posição chegou às ${estado.veiculo.ultima_atualizacao_local}. Sem sinal recente, as previsões ficam suspensas.`;
    case 'fora_de_operacao':
      if (s.motivo === 'aviso_interrupcao') return 'Serviço interrompido pela equipe. Veja os avisos.';
      return `Fora do horário de operação${estado.grade && estado.grade.length ? ` (${estado.grade.map((g) => g.horario).join(', ')})` : ''}.`;
    default:
      return '';
  }
}

/**
 * Cartão de status. `relogio()` devolve a hora do servidor estimada (para "há X s" ao vivo).
 * Retorna uma função que atualiza apenas o "há quanto tempo".
 */
export function desenharSituacao(alvo, estado, relogio) {
  const idadeEl = el('span', { class: 'suave' });
  const atualizar = () => {
    if (!estado.veiculo.ultima_atualizacao) { idadeEl.textContent = ''; return; }
    const s = (relogio() - Date.parse(estado.veiculo.ultima_atualizacao)) / 1000;
    idadeEl.textContent = ` (${haQuanto(s)})`;
  };
  atualizar();

  const proximo = estado.localizacao && estado.localizacao.proximo_ponto ? estado.localizacao.proximo_ponto.nome : '—';
  alvo.dataset.status = estado.status.codigo;
  substituir(alvo,
    el('div', { class: 'situacao__status' },
      el('span', { class: 'situacao__luz', 'aria-hidden': 'true' }),
      el('div', {},
        el('p', { class: 'suave pequeno' }, 'Status do serviço'),
        el('p', { class: 'situacao__rotulo' }, ROTULO_STATUS[estado.status.codigo] || estado.status.rotulo))),
    el('p', { class: 'situacao__motivo' }, explicarStatus(estado)),
    el('dl', { class: 'situacao__dados' },
      el('div', {}, el('dt', {}, 'Última atualização'),
        el('dd', { class: 'numero' }, estado.veiculo.ultima_atualizacao ? hora(estado.veiculo.ultima_atualizacao, estado.fuso) : 'Nenhuma', idadeEl)),
      el('div', {}, el('dt', {}, 'Próximo ponto'), el('dd', {}, ['em_circulacao', 'parado'].includes(estado.status.codigo) ? proximo : '—'))));
  return atualizar;
}
