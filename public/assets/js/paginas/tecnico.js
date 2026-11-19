import { api } from '../api.js';
import { $, el, substituir, vazio, erro, carregando } from '../dom.js';
import { hora, horaSegundos, dataHora, haQuanto, distancia, numero, definirFuso, ROTULO_STATUS } from '../formatacao.js';
import { montarLogin, sessaoAtual, sair } from '../components/login.js';
import { desenharMapa } from '../components/mapa-rota.js';
import { textoPrevisao } from '../components/linha.js';
import { tabela, textoCelula } from '../components/tabela.js';
import { notificar } from '../components/notificacao.js';
import { REQUISITOS } from '../dados/requisitos.js';

/** Área técnica: inspeção do banco, logs, simulador, cenários, indicadores e requisitos. */

const raiz = $('#raiz');
const temporizadores = [];
let demo = { ativo: false, cenarios: [] };

const selo = (texto, cor = '') => el('span', { class: ['selo', cor && `selo--${cor}`] }, texto);
const botao = (texto, onclick, classe = 'botao--secundario') => el('button', { class: ['botao', 'botao--pequeno', classe], type: 'button', onclick }, texto);
const metrica = (titulo, valor, nota) => el('div', { class: 'metrica' },
  el('span', { class: 'metrica__titulo' }, titulo),
  el('span', { class: ['metrica__valor', (valor === null || valor === undefined) && 'metrica__valor--vazio'] }, valor ?? '—'),
  nota ? el('small', {}, nota) : null);
const json = (obj) => el('pre', { class: 'json' }, JSON.stringify(obj, null, 2));
const statusHttp = (s) => el('span', { class: ['status-http', `status-http--${String(s)[0]}`] }, String(s));

async function seguro(alvo, fn) {
  try {
    await fn();
  } catch (e) {
    if (e.status === 401) { notificar('Sua sessão terminou. Entre novamente.', 'erro'); mostrarLogin(); return; }
    substituir(alvo, erro(e.status === 503 ? 'Banco de dados indisponível. Verifique o PostgreSQL (docker compose up -d).' : e.message));
  }
}

function bloco(id, titulo, descricao, ...acoes) {
  const corpo = el('div', { class: 'bloco__corpo' }, carregando());
  const secao = el('section', { class: 'bloco', id, 'aria-labelledby': `${id}-titulo` },
    el('header', {}, el('div', {}, el('h2', { id: `${id}-titulo` }, titulo), descricao ? el('p', {}, descricao) : null),
      acoes.length ? el('div', { class: 'grupo-botoes' }, acoes) : null),
    corpo);
  return { secao, corpo };
}

// --------------------------------------------------------------------- visão geral
function secaoVisao() {
  const b = bloco('visao', 'Visão geral', 'Status da API, do banco e parâmetros das regras de negócio em uso.');
  const carregar = () => seguro(b.corpo, async () => {
    const s = await api.get('/api/tecnico/sistema');
    const p = s.parametros;
    substituir(b.corpo,
      el('div', { class: 'metricas' },
        metrica('API', 'Respondendo', `Node ${s.servidor.node}, ativo ${haQuanto(s.servidor.tempo_ativo_s)}`),
        metrica('Banco de dados', s.banco.situacao === 'ok' ? `PostGIS ${s.banco.postgis}` : 'Indisponível', s.banco.situacao === 'ok' ? `PostgreSQL ${s.banco.postgres}, banco ${s.banco.banco}` : s.banco.erro),
        metrica('Modo de demonstração', s.servidor.modo_demonstracao ? 'Ativo' : 'Desativado', 'DEMO_MODE no .env'),
        metrica('Rastreador exibido', s.rastreador.principal, `${s.rastreador.dispositivos.length} dispositivo(s) autorizado(s)`)),
      tabela({
        rotulo: 'Parâmetros das regras', compacta: true,
        linhas: [
          ['Posição vencida (sem dados)', `${p.limite_dados_vencidos_s} s`, 'Seção 4.2'],
          ['Tempo para “parado”', `${p.tempo_parado_min} min`, 'Seção 4.2'],
          ['Velocidade considerada parada', `até ${p.limiar_parado_kmh} km/h`, 'Valor inicial (calibrar)'],
          ['Janela da velocidade média', `${p.janela_velocidade_min} min`, 'Seção 4.1'],
          ['Velocidade mínima da previsão', `${p.velocidade_minima_kmh} km/h`, 'Seção 4.1 (valor inicial)'],
          ['Raio “chegando ao ponto”', `${p.raio_chegada_m} m`, 'Valor inicial (calibrar)'],
          ['Limite da classificação', `${p.limite_classificacao_ms} ms`, 'Seção 4.3'],
          ['Validade da sessão de conversa', `${p.validade_sessao_h} h`, 'Seção 3 (LGPD)'],
        ],
        colunas: [{ titulo: 'Regra', valor: (l) => l[0] }, { titulo: 'Valor', valor: (l) => l[1] }, { titulo: 'Origem', valor: (l) => l[2] }],
      }));
  });
  carregar();
  return b.secao;
}

// --------------------------------------------------------------------- estado do veículo
function secaoEstado() {
  const atualizar = botao('Atualizar', () => carregar());
  const b = bloco('estado', 'Estado do veículo', 'Resposta de GET /api/estado. A coluna “linha reta” mostra por que ela não é usada: subestima a distância real.', atualizar);
  let rotas = null;
  let jsonAberto = false;
  const carregar = () => seguro(b.corpo, async () => {
    if (!rotas) rotas = (await api.get('/api/rota')).rotas;
    const e = await api.get('/api/estado');
    definirFuso(e.fuso);
    const mapa = el('div');
    desenharMapa(mapa, { rotas, estado: e, linhaReta: true });
    const v = e.veiculo;
    substituir(b.corpo,
      el('div', { class: 'metricas' },
        metrica('Status calculado', ROTULO_STATUS[e.status.codigo], `motivo: ${e.status.motivo}`),
        metrica('Última posição', v.ultima_atualizacao ? horaSegundos(v.ultima_atualizacao) : null, v.idade_s !== null ? haQuanto(v.idade_s) : 'nenhuma recebida'),
        metrica('Progresso na rota', e.rota ? `${distancia(e.rota.progresso_m)} de ${distancia(e.rota.extensao_m)}` : null, e.rota ? `rota ${e.rota.id}, sentido ${e.rota.sentido}` : (v.fora_do_trajeto ? 'posição fora do trajeto' : 'sem rota')),
        metrica('Velocidade média (5 min)', v.velocidade_media_kmh !== null ? `${numero(v.velocidade_media_kmh)} km/h` : null, `${v.amostras_velocidade} posição(ões) na janela`),
        metrica('Distância até o trajeto', v.distancia_rota_m !== null ? `${v.distancia_rota_m} m` : null, 'afastamento da linha da rota')),
      mapa,
      el('div', { class: 'mapa__legenda' }, el('span', {}, el('i', { class: 'percorrido' }), 'Percorrido'), el('span', {}, el('i', { class: 'reta' }), 'Linha reta até o próximo ponto (comparação)')),
      tabela({
        rotulo: 'Previsão por ponto',
        linhas: e.pontos,
        colunas: [
          { titulo: 'Ponto', valor: (p) => `${p.ordem_na_rota}. ${p.nome}` },
          { titulo: 'Progresso do ponto', classe: 'numero', valor: (p) => distancia(p.progresso_m) },
          { titulo: 'Pela rota', classe: 'numero', valor: (p) => (p.previsao.distancia_rota_m !== undefined ? distancia(p.previsao.distancia_rota_m) : '—') },
          { titulo: 'Linha reta', classe: 'numero', valor: (p) => distancia(p.distancia_reta_m) },
          { titulo: 'Previsão', valor: (p) => `${textoPrevisao(p.previsao).curto}${p.previsao.motivo ? ` (${p.previsao.motivo})` : ''}` },
          { titulo: 'Velocidade usada', valor: (p) => (p.previsao.velocidade_usada_kmh ? `${numero(p.previsao.velocidade_usada_kmh)} km/h${p.previsao.velocidade_minima_aplicada ? ' (mínimo)' : ''}` : '—') },
        ],
      }),
      el('details', { open: jsonAberto, ontoggle: (ev) => { jsonAberto = ev.currentTarget.open; } }, el('summary', {}, 'Ver JSON completo'), json(e)));
  });
  carregar();
  return { secao: b.secao, carregar };
}

// --------------------------------------------------------------------- simulador GPS
function secaoSimulador(aoMudar) {
  const b = bloco('simulador', 'Simulador GPS', 'Envia posições para POST /api/posicao com o token do dispositivo, como um rastreador externo.');
  const modo = el('select', { class: 'selecao', id: 'sim-modo' },
    el('option', { value: 'tempo_real' }, 'Tempo real (1 posição a cada 30 s)'),
    el('option', { value: 'acelerado' }, 'Demonstração acelerada (≈15×)'));
  const velocidade = el('input', { class: 'entrada', id: 'sim-velocidade', type: 'number', min: '5', max: '60', value: '18' });
  const estadoSim = el('div');
  const historico = el('div');
  let montado = false;
  const iniciarBotao = botao('Iniciar simulação', () => acao(() => api.post('/api/demo/simulador/iniciar', { modo: modo.value, velocidade_kmh: Number(velocidade.value) }), 'Simulação iniciada.'), 'botao--petroleo');

  const acao = async (fn, msg) => {
    try { await fn(); if (msg) notificar(msg, 'sucesso'); await carregar(); aoMudar(); } catch (e) { notificar(e.message, 'erro'); }
  };

  const carregar = () => seguro(b.corpo, async () => {
    if (!b.corpo.contains(estadoSim)) montado = false;
    if (!demo.ativo) {
      substituir(b.corpo, el('p', { class: 'alerta alerta--info' }, 'O simulador integrado só funciona com DEMO_MODE=true. O simulador em Python (simulator/simulador_traccar.py) funciona em qualquer modo.'));
      return;
    }
    const s = await api.get('/api/demo/simulador');
    const { posicoes } = await api.get('/api/tecnico/posicoes?limite=15');
    substituir(estadoSim,
      el('div', { class: 'metricas' },
        metrica('Simulação', s.ativo ? (s.modo === 'acelerado' ? 'Enviando (acelerada)' : 'Enviando (tempo real)') : 'Desligada', s.ativo ? `a cada ${s.intervalo_s} s${!s.sinal ? ', sinal cortado' : ''}${s.parado ? ', veículo parado' : ''}` : null),
        metrica('Percurso', s.extensao_m ? `${distancia(s.progresso_m)} de ${distancia(s.extensao_m)}` : null, s.voltas ? `${s.voltas} volta(s) completa(s)` : null),
        metrica('Envios', String(s.envios), s.falhas ? `${s.falhas} falha(s)` : 'sem falhas'),
        metrica('Último envio', s.ultimo_envio ? (s.ultimo_envio.status === 'sem_sinal' ? 'Sem sinal (não enviado)' : `HTTP ${s.ultimo_envio.status}`) : null, s.ultimo_envio ? horaSegundos(s.ultimo_envio.em) : null)),
      s.modo === 'acelerado' && s.ativo ? el('p', { class: 'alerta alerta--aviso' }, 'Demonstração acelerada: cada envio avança 30 s de trajeto em 2 s. As previsões não correspondem ao tempo real e essas posições ficam fora das métricas.') : null,
      el('div', { class: 'grupo-botoes' },
        botao(s.sinal ? 'Simular perda de sinal' : 'Restabelecer sinal', () => acao(() => api.post('/api/demo/simulador/sinal', { ativo: !s.sinal }), s.sinal ? 'Envio suspenso. Em 3 min o status vira “Sem dados”.' : 'Sinal restabelecido.')),
        botao(s.parado ? 'Voltar a andar' : 'Simular veículo parado', () => acao(() => api.post('/api/demo/simulador/parado', { ativo: !s.parado }), s.parado ? 'Ônibus voltou a andar.' : 'Velocidade zero. Em 5 min o status vira “Parado”.')),
        botao('Recomeçar percurso', () => acao(() => api.post('/api/demo/simulador/reiniciar-percurso', {}))),
        botao('Aplicar velocidade', () => acao(() => api.post('/api/demo/simulador/velocidade', { velocidade_kmh: Number(velocidade.value) }), 'Velocidade atualizada.'))));
    substituir(historico, tabela({
      rotulo: 'Histórico de posições', compacta: true, textoVazio: 'Nenhuma posição registrada ainda.',
      linhas: posicoes,
      colunas: [
        { titulo: 'Registrada', valor: (p) => horaSegundos(p.registrado_em) },
        { titulo: 'Fonte', valor: (p) => p.fonte },
        { titulo: 'Lat, long', valor: (p) => el('span', { class: 'celula-mono' }, `${p.latitude}, ${p.longitude}`) },
        { titulo: 'km/h', classe: 'numero', valor: (p) => numero(p.velocidade_kmh) },
        { titulo: 'Rota', classe: 'numero', valor: (p) => (p.rota_id === null ? 'fora' : String(p.rota_id)) },
        { titulo: 'Progresso', classe: 'numero', valor: (p) => distancia(p.progresso_m) },
      ],
    }));
    iniciarBotao.textContent = s.ativo ? 'Reiniciar simulação' : 'Iniciar simulação';
    if (!montado) {
      montado = true;
      if (s.modo) modo.value = s.modo;
      substituir(b.corpo,
        el('div', { class: 'controles' },
          el('div', { class: 'campo' }, el('label', { for: 'sim-modo' }, 'Modo'), modo),
          el('div', { class: 'campo' }, el('label', { for: 'sim-velocidade' }, 'Velocidade (km/h)'), velocidade),
          el('div', { class: 'grupo-botoes' },
            iniciarBotao,
            botao('Interromper', () => acao(() => api.post('/api/demo/simulador/parar', {}), 'Simulação interrompida.')))),
        estadoSim,
        el('h3', {}, 'Últimas posições recebidas'),
        historico,
        el('p', { class: 'suave pequeno' }, 'Alternativa externa: python simulator/simulador_traccar.py --intervalo 30 (ou python3 em macOS/Linux).'));
    }
  });
  carregar();
  return { secao: b.secao, carregar };
}

// --------------------------------------------------------------------- cenários
function secaoCenarios(aoMudar) {
  const b = bloco('cenarios', 'Cenários de teste', 'Cada cenário limpa os dados simulados e grava posições pelo mesmo serviço de POST /api/posicao. O status é calculado pelas regras, não definido à mão.');
  const resultado = el('div');

  async function aplicar(c, botaoEl) {
    botaoEl.disabled = true;
    try {
      const r = await api.post(`/api/demo/cenarios/${encodeURIComponent(c.id)}`, {});
      const sessao = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `tecnico-${Date.now()}`;
      const linhas = [];
      for (const m of r.conversa) {
        const resp = await api.post('/api/conversa/simulador', { sessao_local: sessao, mensagem: m.texto, ...(m.simular_demora_ms ? { simular_demora_ms: m.simular_demora_ms } : {}) });
        linhas.push({ m: m.texto, r: resp });
      }
      substituir(resultado, el('div', { class: 'painel grade-form' },
        el('h3', {}, `Resultado: ${r.titulo}`),
        r.observacao ? el('p', { class: 'alerta alerta--aviso' }, r.observacao) : null,
        linhas.length ? tabela({
          rotulo: 'Conversa de teste',
          linhas,
          colunas: [
            { titulo: 'Estudante', valor: (l) => l.m },
            { titulo: 'Assistente', valor: (l) => el('span', { class: 'suave' }, l.r.resposta) },
            { titulo: 'Intenção', valor: (l) => `${l.r.intencao} (${l.r.origem_classificacao})` },
            { titulo: 'Etapa', valor: (l) => l.r.etapa },
            { titulo: 'Tempo', classe: 'numero', valor: (l) => `${l.r.latencia_ms} ms` },
          ],
        }) : el('p', { class: 'suave' }, 'Dados de demonstração removidos.')));
      aoMudar();
    } catch (e) {
      notificar(e.message, 'erro');
    } finally {
      botaoEl.disabled = false;
    }
  }

  if (!demo.ativo) {
    substituir(b.corpo, el('p', { class: 'alerta alerta--info' }, 'Ative DEMO_MODE=true no .env para usar os cenários de teste.'));
  } else {
    substituir(b.corpo, el('div', { class: 'cenarios' }, demo.cenarios.map((c) => {
      const bt = el('button', { class: ['botao', 'botao--pequeno', c.id === 'restaurar' ? 'botao--secundario' : 'botao--petroleo'], type: 'button' }, c.id === 'restaurar' ? 'Limpar' : 'Aplicar');
      bt.addEventListener('click', () => aplicar(c, bt));
      return el('div', { class: 'cenario' }, el('div', {}, el('h3', {}, c.titulo), el('p', {}, c.descricao)), bt);
    })), resultado);
  }
  return b.secao;
}

// --------------------------------------------------------------------- banco
function secaoBanco() {
  const b = bloco('banco', 'Banco de dados', 'As sete tabelas do planejamento, somente leitura. Geometrias em WKT; hashes mascarados.');
  const seletor = el('div', { class: 'selector-tabelas', role: 'group', 'aria-label': 'Tabelas' });
  const conteudo = el('div');
  let atual = 'estado_veiculo';

  const abrir = (nome) => seguro(conteudo, async () => {
    atual = nome;
    [...seletor.children].forEach((bt) => bt.setAttribute('aria-pressed', String(bt.dataset.tabela === nome)));
    substituir(conteudo, carregando());
    const t = await api.get(`/api/tecnico/tabelas/${encodeURIComponent(nome)}?limite=25`);
    substituir(conteudo,
      el('p', { class: 'suave pequeno' }, t.descricao),
      tabela({
        rotulo: `Tabela ${t.nome}`, compacta: true, textoVazio: 'Tabela vazia.',
        linhas: t.linhas,
        colunas: t.colunas.map((c) => ({ titulo: c, valor: (l) => el('span', { class: 'celula-mono' }, textoCelula(l[c])) })),
      }));
  });

  const carregar = () => seguro(b.corpo, async () => {
    const { tabelas } = await api.get('/api/tecnico/tabelas');
    substituir(seletor, tabelas.map((t) => el('button', { type: 'button', 'data-tabela': t.nome, 'aria-pressed': 'false', onclick: () => abrir(t.nome) }, t.nome, el('small', {}, `(${t.registros})`))));
    substituir(b.corpo, seletor, conteudo);
    abrir(atual);
  });
  carregar();
  return { secao: b.secao, carregar };
}

// --------------------------------------------------------------------- requisições
function secaoRequisicoes() {
  const auto = el('input', { type: 'checkbox', id: 'req-auto' });
  const b = bloco('requisicoes', 'Requisições', 'Logs reais das chamadas à API desde que o servidor iniciou (memória; tokens são mascarados).',
    el('label', { class: 'marcador pequeno', for: 'req-auto' }, auto, 'Atualizar sozinho'),
    botao('Atualizar', () => carregar()),
    botao('Limpar', async () => { await api.delete('/api/tecnico/requisicoes'); carregar(); }));
  const carregar = () => seguro(b.corpo, async () => {
    const r = await api.get('/api/tecnico/requisicoes');
    substituir(b.corpo,
      el('h3', {}, 'Desempenho por rota'),
      tabela({
        rotulo: 'Desempenho por rota', compacta: true, textoVazio: 'Nenhuma requisição registrada.',
        linhas: r.estatisticas,
        colunas: [
          { titulo: 'Rota', valor: (s) => el('span', { class: 'celula-mono' }, s.rota) },
          { titulo: 'Chamadas', classe: 'numero', valor: (s) => String(s.total) },
          { titulo: 'Média', classe: 'numero', valor: (s) => `${numero(s.media_ms)} ms` },
          { titulo: 'p95', classe: 'numero', valor: (s) => `${numero(s.p95_ms)} ms` },
          { titulo: 'Máximo', classe: 'numero', valor: (s) => `${numero(s.max_ms)} ms` },
          { titulo: 'Erros 5xx', classe: 'numero', valor: (s) => String(s.erros_5xx) },
        ],
      }),
      el('h3', {}, 'Últimas chamadas'),
      el('div', { class: 'registro' }, tabela({
        rotulo: 'Últimas chamadas', compacta: true, textoVazio: 'Nenhuma requisição registrada.',
        linhas: r.itens,
        colunas: [
          { titulo: 'Hora', valor: (i) => horaSegundos(i.em) },
          { titulo: 'Método', valor: (i) => i.metodo },
          { titulo: 'Caminho', valor: (i) => el('span', { class: 'celula-mono' }, i.caminho) },
          { titulo: 'Status', valor: (i) => statusHttp(i.status) },
          { titulo: 'Duração', classe: 'numero', valor: (i) => `${numero(i.duracao_ms)} ms` },
        ],
      })));
  });
  carregar();
  temporizadores.push(setInterval(() => { if (auto.checked && !document.hidden) carregar(); }, 5000));
  return b.secao;
}

// --------------------------------------------------------------------- endpoints
function secaoEndpoints() {
  const b = bloco('endpoints', 'Endpoints', 'Rotas da API, proteção aplicada e relação com o planejamento.');
  seguro(b.corpo, async () => {
    const { endpoints } = await api.get('/api/tecnico/endpoints');
    substituir(b.corpo, tabela({
      rotulo: 'Endpoints', linhas: endpoints,
      colunas: [
        { titulo: 'Método', valor: (e) => el('span', { class: 'celula-mono' }, e.metodo) },
        { titulo: 'Caminho', valor: (e) => el('span', { class: 'celula-mono' }, e.caminho) },
        { titulo: 'Proteção', valor: (e) => e.protecao },
        { titulo: 'Função', valor: (e) => e.descricao },
        { titulo: 'Situação', valor: (e) => selo(e.situacao, e.situacao === 'implementado' ? 'verde' : e.situacao === 'fora do escopo' ? '' : 'azul') },
        { titulo: 'No planejamento', valor: (e) => (e.planejamento ? 'Sim' : 'Não') },
      ],
    }));
  });
  return b.secao;
}

// --------------------------------------------------------------------- indicadores
function secaoIndicadores() {
  const b = bloco('indicadores', 'Indicadores (Seção 8)', 'Somente valores medidos. Sem dados suficientes, o indicador aparece como “ainda não aferido”.');
  const SITUACAO = { atende: ['Atende', 'verde'], nao_atende: ['Não atende', 'vermelho'], nao_aferido: ['Ainda não aferido', ''], em_andamento: ['Em andamento', 'azul'] };
  const extra = el('div', { class: 'grade-form' });

  const carregar = () => seguro(b.corpo, async () => {
    const ind = await api.get('/api/tecnico/indicadores');
    const { mensagens } = await api.get('/api/tecnico/indicadores/mensagens');
    const turno = el('select', { class: 'selecao', id: 'part-turno' }, el('option', { value: 'M' }, 'Matutino'), el('option', { value: 'N' }, 'Noturno'));
    const data = el('input', { class: 'entrada', id: 'part-data', type: 'date', value: new Date().toISOString().slice(0, 10) });

    substituir(b.corpo,
      el('div', { class: 'indicadores' }, ind.itens.map((i) => {
        const [rotulo, cor] = SITUACAO[i.situacao] || SITUACAO.nao_aferido;
        return el('article', { class: 'indicador' },
          el('h3', {}, i.titulo),
          el('div', { class: 'indicador__meta' }, `Meta: ${i.meta}`),
          el('div', { class: ['indicador__valor', i.valor === null && 'indicador__valor--vazio'] }, i.valor ?? 'Sem medição'),
          el('div', {}, selo(rotulo, cor)),
          el('small', { class: 'suave' }, i.amostra),
          i.detalhe ? el('small', { class: 'suave' }, i.detalhe) : null,
          el('p', { class: 'indicador__origem' }, i.origem));
      })),
      el('p', { class: 'suave pequeno' }, `Contagem desde ${dataHora(ind.registrado_desde)} (arquivo local data/metricas.json).`),
      el('div', { class: 'grupo-botoes' },
        botao('Reprocessar histórico e medir erro da previsão', async () => {
          try {
            const r = await api.post('/api/tecnico/indicadores/avaliar-previsoes', {});
            notificar(`${r.viagens_avaliadas} viagem(ns) avaliada(s).`, 'sucesso');
            await carregar();
            substituir(extra, el('h3', {}, 'Viagens avaliadas'), tabela({
              rotulo: 'Viagens avaliadas', compacta: true, textoVazio: 'Nenhuma viagem completa no histórico. Rode o simulador em tempo real ou use dados do rastreador.',
              linhas: r.viagens,
              colunas: [
                { titulo: 'Início', valor: (v) => dataHora(v.inicio) },
                { titulo: 'Fim', valor: (v) => hora(v.fim) },
                { titulo: 'Fonte', valor: (v) => v.fontes.join(', ') },
                { titulo: 'Pontos alcançados', classe: 'numero', valor: (v) => String(v.pontos_alcancados) },
                { titulo: 'Previsões', classe: 'numero', valor: (v) => String(v.previsoes) },
                { titulo: 'Erro médio', classe: 'numero', valor: (v) => `${numero(v.erro_medio_min, 2)} min` },
              ],
            }));
          } catch (e) { notificar(e.message, 'erro'); }
        }),
        botao('Conferir frases de exemplo do classificador', async () => {
          try {
            const r = await api.post('/api/tecnico/indicadores/conjunto-interno', {});
            substituir(extra,
              el('p', { class: 'alerta alerta--info' }, `Conjunto interno: ${r.corretas} de ${r.total} frases (${numero(r.percentual)}%). Serve para detectar regressões; não substitui a avaliação com mensagens reais de estudantes.`),
              r.erros.length ? tabela({ rotulo: 'Frases classificadas errado', compacta: true, linhas: r.erros, colunas: [{ titulo: 'Frase', valor: (x) => x.texto }, { titulo: 'Esperada', valor: (x) => x.esperada }, { titulo: 'Obtida', valor: (x) => x.obtida }] }) : null);
          } catch (e) { notificar(e.message, 'erro'); }
        })),
      extra,
      el('h3', {}, 'Avaliar mensagens livres recebidas'),
      el('p', { class: 'suave pequeno' }, 'Marque se o assistente entendeu cada mensagem. O texto fica só na memória do servidor; apenas a contagem é gravada.'),
      tabela({
        rotulo: 'Mensagens para avaliação', compacta: true, textoVazio: 'Nenhuma mensagem livre recebida desde que o servidor iniciou.',
        linhas: mensagens,
        colunas: [
          { titulo: 'Recebida', valor: (m) => horaSegundos(m.em) },
          { titulo: 'Mensagem', valor: (m) => m.texto },
          { titulo: 'Intenção', valor: (m) => `${m.intencao}${m.origem === 'tempo_excedido' ? ' (tempo excedido)' : ''}` },
          { titulo: 'Avaliação', valor: (m) => el('div', { class: 'grupo-botoes' },
            botao(m.avaliacao === true ? '✓ Entendeu' : 'Entendeu', async () => { await api.post(`/api/tecnico/indicadores/mensagens/${m.id}/avaliacao`, { correta: true }); carregar(); }, m.avaliacao === true ? 'botao--petroleo' : 'botao--secundario'),
            botao(m.avaliacao === false ? '✗ Não entendeu' : 'Não entendeu', async () => { await api.post(`/api/tecnico/indicadores/mensagens/${m.id}/avaliacao`, { correta: false }); carregar(); }, m.avaliacao === false ? 'botao--perigo' : 'botao--secundario')) },
        ],
      }),
      el('h3', {}, 'Participantes do teste com estudantes'),
      el('div', { class: 'controles' },
        el('div', { class: 'campo' }, el('label', { for: 'part-turno' }, 'Turno'), turno),
        el('div', { class: 'campo' }, el('label', { for: 'part-data' }, 'Data do teste'), data),
        botao('Registrar participante', async () => {
          try { await api.post('/api/tecnico/indicadores/participantes', { turno: turno.value, data: data.value }); notificar('Participante registrado.', 'sucesso'); carregar(); } catch (e) { notificar(e.message, 'erro'); }
        }, 'botao--petroleo')),
      tabela({
        rotulo: 'Participantes', compacta: true, textoVazio: 'Nenhum participante registrado. Registre cada estudante que testar o serviço (sem nome ou contato).',
        linhas: ind.participantes,
        colunas: [
          { titulo: 'Turno', valor: (p) => (p.turno === 'M' ? 'Matutino' : 'Noturno') },
          { titulo: 'Data', valor: (p) => p.data.split('-').reverse().join('/') },
          { titulo: '', valor: (p) => botao('Remover', async () => { await api.delete(`/api/tecnico/indicadores/participantes/${p.id}`); carregar(); }, 'botao--discreto') },
        ],
      }));
  });
  carregar();
  return b.secao;
}

// --------------------------------------------------------------------- requisitos e equipe
function secaoRequisitos() {
  const b = bloco('requisitos', 'Requisitos e implementação', 'Onde cada requisito citado nos documentos está implementado e como verificar.');
  substituir(b.corpo, tabela({
    rotulo: 'Requisitos', linhas: REQUISITOS,
    colunas: [
      { titulo: 'Código', valor: (r) => el('strong', {}, r.codigo) },
      { titulo: 'O que é', valor: (r) => r.descricao },
      { titulo: 'Fonte', valor: (r) => r.fonte },
      { titulo: 'Implementação', valor: (r) => el('span', { class: 'pequeno' }, r.implementacao) },
      { titulo: 'Verificação', valor: (r) => el('span', { class: 'pequeno' }, r.verificacao) },
    ],
  }));
  return b.secao;
}

function secaoEquipe() {
  const b = bloco('equipe', 'Painel da equipe', 'Cadastro de avisos e pontos fica numa página própria, com login.');
  seguro(b.corpo, async () => {
    const e = await api.get('/api/estado');
    substituir(b.corpo,
      el('div', { class: 'metricas' },
        metrica('Avisos vigentes', String(e.avisos.length), e.avisos.some((a) => a.interrompe_operacao) ? 'há aviso de interrupção' : null),
        metrica('Pontos ativos', String(e.pontos.length), e.dados_demonstrativos ? 'inclui dados demonstrativos' : null)),
      el('div', {}, el('a', { class: 'botao', href: '/admin' }, 'Abrir o painel da equipe')));
  });
  return b.secao;
}

// --------------------------------------------------------------------- montagem
function montarPagina() {
  temporizadores.splice(0).forEach(clearInterval);
  $('#botao-sair').hidden = false;

  let estadoSec = null;
  let simuladorSec = null;
  let bancoSec = null;
  const aoMudar = () => { estadoSec?.carregar(); simuladorSec?.carregar(); bancoSec?.carregar(); };

  estadoSec = secaoEstado();
  simuladorSec = secaoSimulador(aoMudar);
  bancoSec = secaoBanco();
  const secoes = [
    ['visao', 'Visão geral', secaoVisao()],
    ['estado', 'Estado do veículo', estadoSec.secao],
    ['simulador', 'Simulador GPS', simuladorSec.secao],
    ['cenarios', 'Cenários de teste', secaoCenarios(aoMudar)],
    ['banco', 'Banco de dados', bancoSec.secao],
    ['requisicoes', 'Requisições', secaoRequisicoes()],
    ['endpoints', 'Endpoints', secaoEndpoints()],
    ['indicadores', 'Indicadores', secaoIndicadores()],
    ['requisitos', 'Requisitos', secaoRequisitos()],
    ['equipe', 'Painel da equipe', secaoEquipe()],
  ];
  const indice = el('nav', { class: 'indice', 'aria-label': 'Seções da área técnica' },
    secoes.map(([id, rotulo]) => el('a', { href: `#${id}` }, rotulo)));
  substituir(raiz, el('div', { class: 'tecnico' }, indice, el('div', {}, secoes.map((s) => s[2]))));

  const links = [...indice.querySelectorAll('a')];
  const observador = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (e.isIntersecting) links.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${e.target.id}`)));
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  secoes.forEach((s) => observador.observe(s[2]));

  temporizadores.push(setInterval(() => {
    if (document.hidden) return;
    estadoSec.carregar();
    simuladorSec.carregar();
  }, 6000));
}

function mostrarLogin() {
  temporizadores.splice(0).forEach(clearInterval);
  $('#botao-sair').hidden = true;
  montarLogin(raiz, {
    titulo: 'Área técnica',
    descricao: 'Entre com uma conta da equipe para ver dados internos, logs e controles de teste.',
    aoEntrar: iniciarAutenticado,
  });
}

async function iniciarAutenticado() {
  try { demo = await api.get('/api/demo/config'); } catch { demo = { ativo: false, cenarios: [] }; }
  montarPagina();
}

async function iniciar() {
  $('#botao-sair').addEventListener('click', async () => { try { await sair(); } finally { mostrarLogin(); } });
  let usuario;
  try { usuario = await sessaoAtual(); } catch (e) { substituir(raiz, erro(`Não foi possível verificar a sessão: ${e.message}`)); return; }
  if (usuario) iniciarAutenticado(); else mostrarLogin();
}

iniciar();
