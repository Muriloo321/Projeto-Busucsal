import { el, substituir, vazio, iconeOnibus } from '../dom.js';

/**
 * Diagrama da linha (esquemático, como o das portas do ônibus): pontos igualmente espaçados,
 * ônibus posicionado entre o ponto anterior e o próximo de acordo com o progresso real na rota.
 * Os minutos exibidos vêm do backend (previsão ao longo da rota).
 */

const TEXTO_INDISPONIVEL = {
  fora_de_operacao: 'Sem serviço',
  dados_vencidos: 'Sem previsão',
  onibus_fora_do_trajeto: 'Sem previsão',
  outro_sentido: 'Outro sentido',
  ponto_fora_do_trajeto: 'Revisar ponto',
};

export function textoPrevisao(previsao) {
  if (!previsao) return { curto: '—', acessivel: 'sem previsão' };
  switch (previsao.tipo) {
    case 'previsao':
      return { minutos: previsao.minutos, curto: `${previsao.minutos} min`, acessivel: `cerca de ${previsao.minutos} ${previsao.minutos === 1 ? 'minuto' : 'minutos'}` };
    case 'no_ponto': return { curto: 'Chegando', acessivel: 'ônibus chegando agora' };
    case 'ja_passou': return { curto: 'Já passou', acessivel: 'o ônibus já passou neste sentido' };
    default: return { curto: TEXTO_INDISPONIVEL[previsao.motivo] || 'Sem previsão', acessivel: 'sem previsão no momento' };
  }
}

function posicaoOnibus(progresso, pontos, posicoes) {
  if (progresso === null || progresso === undefined) return null;
  const prog = pontos.map((p) => p.progresso_m);
  if (pontos.length === 1 || progresso <= prog[0]) return posicoes[0];
  if (progresso >= prog[prog.length - 1]) return posicoes[posicoes.length - 1];
  for (let i = 0; i < prog.length - 1; i += 1) {
    if (progresso >= prog[i] && progresso < prog[i + 1]) {
      const f = (progresso - prog[i]) / Math.max(1, prog[i + 1] - prog[i]);
      return posicoes[i] + f * (posicoes[i + 1] - posicoes[i]);
    }
  }
  return null;
}

export function desenharLinha(alvo, estado) {
  const sentido = estado.rota ? estado.rota.sentido : (estado.pontos[0] && estado.pontos[0].sentido);
  const pontos = estado.pontos
    .filter((p) => p.sentido === sentido)
    // Ordem física ao longo da rota (progresso calculado no PostGIS); sem ele, a ordem cadastrada.
    .sort((a, b) => (a.progresso_m !== null && b.progresso_m !== null ? a.progresso_m - b.progresso_m : a.ordem_na_rota - b.ordem_na_rota));

  if (pontos.length === 0) {
    substituir(alvo, vazio('Nenhum ponto de embarque cadastrado ainda. A equipe cadastra os pontos no painel.'));
    return;
  }

  const n = pontos.length;
  const posicoes = pontos.map((_, i) => (n === 1 ? 50 : (i / (n - 1)) * 100));
  const comProgresso = pontos.every((p) => p.progresso_m !== null);
  const progresso = estado.rota ? estado.rota.progresso_m : null;
  const posOnibus = comProgresso ? posicaoOnibus(progresso, pontos, posicoes) : null;
  const ativo = ['em_circulacao', 'parado'].includes(estado.status.codigo);

  const itens = pontos.map((p, i) => {
    const t = textoPrevisao(p.previsao);
    const tipo = p.previsao ? p.previsao.tipo : 'indisponivel';
    const previsao = el('span', { class: ['linha__previsao', `linha__previsao--${tipo}`], 'aria-hidden': 'true' },
      t.minutos !== undefined ? [el('b', {}, String(t.minutos)), ' min'] : t.curto);
    return el('li', {
      class: ['linha__ponto', tipo === 'ja_passou' && 'linha__ponto--passado', tipo === 'no_ponto' && 'linha__ponto--atual'],
      style: { '--pos': posicoes[i].toFixed(2) },
      'aria-label': `Ponto ${p.ordem_na_rota}, ${p.nome}: ${t.acessivel}`,
    },
    el('span', { class: 'linha__marco', 'aria-hidden': 'true' }),
    el('span', { class: 'linha__nome', 'aria-hidden': 'true' }, p.nome, p.referencia ? el('span', { class: 'linha__ref' }, p.referencia) : null),
    previsao);
  });

  const linha = el('div', { class: 'linha', style: { '--n': n, '--prog': (posOnibus ?? 0).toFixed(2) } },
    el('div', { class: 'linha__trilho' }),
    el('div', { class: 'linha__percorrido' }),
    el('ol', { class: 'linha__pontos' }, itens),
    posOnibus === null ? null : el('div', {
      class: ['linha__onibus', !ativo && 'linha__onibus--inativo'],
      style: { '--pos': posOnibus.toFixed(2) },
      role: 'img',
      'aria-label': `Ônibus ${estado.localizacao ? estado.localizacao.texto : ''}`,
    }, el('span', { class: 'linha__onibus-icone' }, iconeOnibus()), el('span', { class: 'linha__onibus-rotulo' }, 'Ônibus')));

  substituir(alvo, linha);
}
