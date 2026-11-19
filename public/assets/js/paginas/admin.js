import { api } from '../api.js';
import { $, el, substituir, vazio, erro, carregando } from '../dom.js';
import { dataHora, isoParaLocal, localParaIso, distancia } from '../formatacao.js';
import { validarAviso, validarPonto, mostrarErros, errosDaApi } from '../validacao.js';
import { montarLogin, sessaoAtual, sair } from '../components/login.js';
import { notificar, confirmar } from '../components/notificacao.js';
import { tabela } from '../components/tabela.js';

/** Painel da equipe: avisos operacionais, pontos de embarque e consulta das rotas. */

const raiz = $('#raiz');
let usuario = null;

const SITUACAO = {
  vigente: { texto: 'Vigente', cor: 'verde' },
  agendado: { texto: 'Agendado', cor: 'azul' },
  encerrado: { texto: 'Encerrado', cor: '' },
  inativo: { texto: 'Inativo', cor: '' },
};

function selo(texto, cor = '', extra = '') {
  return el('span', { class: ['selo', cor && `selo--${cor}`, extra] }, texto);
}

/** Trata sessão expirada em qualquer chamada. */
async function chamar(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.status === 401) {
      notificar('Sua sessão terminou. Entre novamente.', 'erro');
      mostrarLogin();
    }
    throw e;
  }
}

function campo(rotulo, entrada, ajuda) {
  return el('div', { class: 'campo' }, el('label', { for: entrada.id }, rotulo), entrada, ajuda ? el('small', {}, ajuda) : null);
}

// ---------------------------------------------------------------------------- avisos
function montarAvisos(alvo) {
  let avisos = [];
  let filtro = 'todos';
  let editando = null;

  const texto = el('textarea', { class: 'area-texto', id: 'aviso-texto', name: 'texto', maxlength: '500', required: true, placeholder: 'Ex.: Atraso de cerca de 15 minutos por trânsito intenso.' });
  const contador = el('p', { class: 'contador', 'aria-live': 'polite' }, '0/500');
  const inicio = el('input', { class: 'entrada', id: 'aviso-inicio', name: 'inicio', type: 'datetime-local', required: true });
  const fim = el('input', { class: 'entrada', id: 'aviso-fim', name: 'fim', type: 'datetime-local', required: true });
  const interrompe = el('input', { type: 'checkbox', name: 'interrompe_operacao', id: 'aviso-interrompe' });
  const ativo = el('input', { type: 'checkbox', name: 'ativo', id: 'aviso-ativo', checked: true });
  const titulo = el('h2', {}, 'Novo aviso');
  const enviar = el('button', { class: 'botao', type: 'submit' }, 'Publicar aviso');
  const cancelar = el('button', { class: 'botao botao--secundario', type: 'button', hidden: true }, 'Cancelar edição');
  const mensagem = el('div', { role: 'alert' });

  const padroes = () => {
    const agora = new Date();
    agora.setSeconds(0, 0);
    const fimDia = new Date(agora);
    fimDia.setHours(23, 59, 0, 0);
    if (fimDia - agora < 60 * 60 * 1000) fimDia.setTime(agora.getTime() + 2 * 60 * 60 * 1000);
    return { inicio: isoParaLocal(agora.toISOString()), fim: isoParaLocal(fimDia.toISOString()) };
  };

  const formulario = el('form', { class: 'painel grade-form', novalidate: true },
    el('div', { class: 'painel__titulo' }, titulo),
    el('div', { class: 'campo' }, el('label', { for: 'aviso-texto' }, 'Texto do aviso'), texto, contador),
    el('div', { class: 'modelos', 'aria-label': 'Modelos de aviso' },
      el('button', { class: 'atalho', type: 'button', onclick: () => preencherModelo('Atraso de cerca de 15 minutos por trânsito intenso.', false) }, 'Modelo: atraso'),
      el('button', { class: 'atalho', type: 'button', onclick: () => preencherModelo('Ônibus em manutenção. Serviço temporariamente interrompido.', true) }, 'Modelo: interrupção')),
    campo('Início', inicio),
    campo('Fim', fim),
    el('label', { class: 'marcador', for: 'aviso-interrompe' }, interrompe, 'Interrompe a operação (o status passa a “Fora de operação”)'),
    el('label', { class: 'marcador', for: 'aviso-ativo' }, ativo, 'Ativo'),
    mensagem,
    el('div', { class: 'grupo-botoes' }, enviar, cancelar));

  function preencherModelo(t, interrupcao) {
    texto.value = t;
    interrompe.checked = interrupcao;
    contador.textContent = `${t.length}/500`;
    texto.focus();
  }

  function limparFormulario() {
    editando = null;
    formulario.reset();
    const p = padroes();
    inicio.value = p.inicio;
    fim.value = p.fim;
    ativo.checked = true;
    contador.textContent = '0/500';
    titulo.textContent = 'Novo aviso';
    enviar.textContent = 'Publicar aviso';
    cancelar.hidden = true;
    mostrarErros(formulario, {});
    substituir(mensagem);
  }

  function editar(a) {
    editando = a;
    texto.value = a.texto;
    inicio.value = isoParaLocal(a.inicio);
    fim.value = isoParaLocal(a.fim);
    interrompe.checked = a.interrompe_operacao;
    ativo.checked = a.ativo;
    contador.textContent = `${a.texto.length}/500`;
    titulo.textContent = 'Editar aviso';
    enviar.textContent = 'Salvar alterações';
    cancelar.hidden = false;
    texto.focus();
  }

  texto.addEventListener('input', () => { contador.textContent = `${texto.value.length}/500`; });
  cancelar.addEventListener('click', limparFormulario);

  formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    substituir(mensagem);
    const dados = { texto: texto.value, inicio: inicio.value, fim: fim.value };
    if (!mostrarErros(formulario, validarAviso(dados))) return;
    const corpo = {
      texto: texto.value.trim(), inicio: localParaIso(inicio.value), fim: localParaIso(fim.value),
      interrompe_operacao: interrompe.checked, ativo: ativo.checked,
    };
    enviar.disabled = true;
    try {
      if (editando) {
        await chamar(() => api.put(`/admin/avisos/${editando.id}`, corpo));
        notificar('Aviso atualizado.', 'sucesso');
      } else {
        await chamar(() => api.post('/admin/avisos', corpo));
        notificar(corpo.interrompe_operacao && corpo.ativo ? 'Aviso publicado. O serviço aparece como fora de operação enquanto ele estiver vigente.' : 'Aviso publicado.', 'sucesso');
      }
      limparFormulario();
      await carregar();
    } catch (erroApi) {
      if (erroApi.status === 400) mostrarErros(formulario, errosDaApi(erroApi.detalhes));
      if (erroApi.status !== 401) substituir(mensagem, el('div', { class: 'alerta alerta--erro' }, erroApi.message));
    } finally {
      enviar.disabled = false;
    }
  });

  const filtros = el('div', { class: 'filtros', role: 'group', 'aria-label': 'Filtrar avisos' });
  const lista = el('div', { 'aria-live': 'polite' }, carregando('Carregando avisos…'));

  function desenharFiltros() {
    const opcoes = [['todos', 'Todos'], ['vigente', 'Vigentes'], ['agendado', 'Agendados'], ['encerrado', 'Encerrados'], ['inativo', 'Inativos']];
    substituir(filtros, opcoes.map(([id, rotulo]) => {
      const total = id === 'todos' ? avisos.length : avisos.filter((a) => a.situacao === id).length;
      return el('button', { class: 'filtro', type: 'button', 'aria-pressed': String(filtro === id), onclick: () => { filtro = id; desenharFiltros(); desenharLista(); } }, `${rotulo} (${total})`);
    }));
  }

  async function alternar(a) {
    try {
      await chamar(() => api.patch(`/admin/avisos/${a.id}/ativo`, { ativo: !a.ativo }));
      notificar(a.ativo ? 'Aviso desativado.' : 'Aviso ativado.', 'sucesso');
      await carregar();
    } catch (e) { if (e.status !== 401) notificar(e.message, 'erro'); }
  }

  async function excluir(a) {
    const ok = await confirmar({ titulo: 'Excluir aviso?', mensagem: `“${a.texto}” será removido definitivamente. Para apenas ocultar, use Desativar.`, confirmar: 'Excluir aviso', perigo: true });
    if (!ok) return;
    try {
      await chamar(() => api.delete(`/admin/avisos/${a.id}`));
      notificar('Aviso excluído.', 'sucesso');
      if (editando && editando.id === a.id) limparFormulario();
      await carregar();
    } catch (e) { if (e.status !== 401) notificar(e.message, 'erro'); }
  }

  function desenharLista() {
    const visiveis = filtro === 'todos' ? avisos : avisos.filter((a) => a.situacao === filtro);
    if (visiveis.length === 0) {
      substituir(lista, vazio(avisos.length ? 'Nenhum aviso com esse filtro.' : 'Nenhum aviso cadastrado. Publique o primeiro no formulário ao lado.'));
      return;
    }
    substituir(lista, el('ul', { class: 'lista-avisos' }, visiveis.map((a) => {
      const s = SITUACAO[a.situacao] || SITUACAO.inativo;
      return el('li', { class: ['cartao-aviso', a.interrompe_operacao && 'cartao-aviso--interrompe', !a.ativo && 'cartao-aviso--inativo'] },
        el('p', { class: 'cartao-aviso__texto' }, a.texto),
        el('div', { class: 'cartao-aviso__meta' },
          selo(s.texto, s.cor),
          a.interrompe_operacao ? selo('Interrompe a operação', 'vermelho') : null,
          a.demonstrativo ? selo('Demonstração', '', 'selo--demo') : null,
          el('span', { class: 'numero' }, `${dataHora(a.inicio)} até ${dataHora(a.fim)}`),
          a.criado_por_nome ? el('span', {}, `por ${a.criado_por_nome}`) : null),
        el('div', { class: 'cartao-aviso__acoes' },
          el('button', { class: 'botao botao--secundario botao--pequeno', type: 'button', onclick: () => editar(a) }, 'Editar'),
          el('button', { class: 'botao botao--secundario botao--pequeno', type: 'button', onclick: () => alternar(a) }, a.ativo ? 'Desativar' : 'Ativar'),
          el('button', { class: 'botao botao--perigo botao--pequeno', type: 'button', onclick: () => excluir(a) }, 'Excluir')));
    })));
  }

  async function carregar() {
    try {
      avisos = (await chamar(() => api.get('/admin/avisos'))).avisos;
      desenharFiltros();
      desenharLista();
    } catch (e) {
      if (e.status !== 401) substituir(lista, erro(`Não foi possível carregar os avisos: ${e.message}`));
    }
  }

  limparFormulario();
  substituir(alvo, el('div', { class: 'duas-colunas' },
    formulario,
    el('section', { 'aria-labelledby': 'lista-avisos-titulo' },
      el('div', { class: 'painel__titulo' }, el('h2', { id: 'lista-avisos-titulo' }, 'Avisos cadastrados')),
      filtros, lista)));
  carregar();
}

// ---------------------------------------------------------------------------- pontos
function montarPontos(alvo) {
  let editando = null;
  const entrada = (id, nome, attrs = {}) => el('input', { class: 'entrada', id, name: nome, ...attrs });
  const nome = entrada('ponto-nome', 'nome', { maxlength: '120', required: true });
  const referencia = entrada('ponto-referencia', 'referencia', { maxlength: '200' });
  const latitude = entrada('ponto-latitude', 'latitude', { inputmode: 'decimal', placeholder: '-12.9598' });
  const longitude = entrada('ponto-longitude', 'longitude', { inputmode: 'decimal', placeholder: '-38.4148' });
  const ordem = entrada('ponto-ordem', 'ordem_na_rota', { type: 'number', min: '1', max: '99', step: '1' });
  const sentido = el('select', { class: 'selecao', id: 'ponto-sentido', name: 'sentido' },
    el('option', { value: 'ida' }, 'Ida'), el('option', { value: 'volta' }, 'Volta'));
  const turnos = el('select', { class: 'selecao', id: 'ponto-turnos', name: 'turnos' },
    el('option', { value: 'M/N' }, 'Matutino e noturno'), el('option', { value: 'M' }, 'Matutino'), el('option', { value: 'N' }, 'Noturno'));
  const titulo = el('h2', {}, 'Cadastrar ponto');
  const enviar = el('button', { class: 'botao', type: 'submit' }, 'Cadastrar ponto');
  const cancelar = el('button', { class: 'botao botao--secundario', type: 'button', hidden: true }, 'Cancelar edição');
  const mensagem = el('div', { role: 'alert' });

  const formulario = el('form', { class: 'painel grade-form', novalidate: true },
    el('div', { class: 'painel__titulo' }, titulo),
    campo('Nome', nome),
    campo('Referência', referencia, 'Opcional. Ex.: em frente à passarela.'),
    el('div', { class: 'grade-form grade-form--2' }, campo('Latitude', latitude), campo('Longitude', longitude)),
    el('div', { class: 'grade-form grade-form--2' }, campo('Ordem na rota', ordem), campo('Sentido', sentido)),
    campo('Turnos atendidos', turnos),
    el('p', { class: 'suave pequeno' }, 'O ponto precisa ficar sobre o trajeto cadastrado. O servidor confere a distância no PostGIS antes de salvar.'),
    mensagem,
    el('div', { class: 'grupo-botoes' }, enviar, cancelar));

  const lista = el('div', {}, carregando('Carregando pontos…'));

  function limpar() {
    editando = null;
    formulario.reset();
    titulo.textContent = 'Cadastrar ponto';
    enviar.textContent = 'Cadastrar ponto';
    cancelar.hidden = true;
    mostrarErros(formulario, {});
    substituir(mensagem);
  }

  function editar(p) {
    editando = p;
    nome.value = p.nome;
    referencia.value = p.referencia || '';
    latitude.value = String(p.latitude);
    longitude.value = String(p.longitude);
    ordem.value = String(p.ordem_na_rota);
    sentido.value = p.sentido;
    turnos.value = p.turnos;
    titulo.textContent = `Editar ponto ${p.ordem_na_rota}`;
    enviar.textContent = 'Salvar alterações';
    cancelar.hidden = false;
    nome.focus();
  }
  cancelar.addEventListener('click', limpar);

  formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    substituir(mensagem);
    const dados = { nome: nome.value, latitude: latitude.value.replace(',', '.'), longitude: longitude.value.replace(',', '.'), ordem_na_rota: ordem.value };
    if (!mostrarErros(formulario, validarPonto(dados))) return;
    const corpo = {
      nome: nome.value.trim(), referencia: referencia.value.trim() || null,
      latitude: Number(dados.latitude), longitude: Number(dados.longitude), ordem_na_rota: Number(ordem.value),
      sentido: sentido.value, turnos: turnos.value,
    };
    enviar.disabled = true;
    try {
      const r = editando
        ? await chamar(() => api.put(`/admin/pontos/${editando.id}`, corpo))
        : await chamar(() => api.post('/admin/pontos', corpo));
      notificar(`${editando ? 'Ponto atualizado' : 'Ponto cadastrado'} (a ${distancia(r.ponto.distancia_trajeto_m)} do trajeto).`, 'sucesso');
      limpar();
      await carregar();
    } catch (erroApi) {
      if (erroApi.status === 400 || erroApi.status === 409 || erroApi.status === 422) mostrarErros(formulario, errosDaApi(erroApi.detalhes));
      if (erroApi.status !== 401) substituir(mensagem, el('div', { class: 'alerta alerta--erro' }, erroApi.message));
    } finally {
      enviar.disabled = false;
    }
  });

  async function alternar(p) {
    try {
      await chamar(() => api.patch(`/admin/pontos/${p.id}/ativo`, { ativo: !p.ativo }));
      notificar(p.ativo ? 'Ponto desativado.' : 'Ponto ativado.', 'sucesso');
      await carregar();
    } catch (e) { if (e.status !== 401) notificar(e.message, 'erro'); }
  }

  async function carregar() {
    try {
      const { pontos } = await chamar(() => api.get('/admin/pontos'));
      const temDemo = pontos.some((p) => p.demonstrativo && p.ativo);
      substituir(lista,
        temDemo ? el('p', { class: 'alerta alerta--aviso' }, 'Há pontos demonstrativos ativos. Substitua-os pelos pontos oficiais da Seção 6 do planejamento e depois desative os demonstrativos.') : null,
        tabela({
          rotulo: 'Pontos de embarque',
          textoVazio: 'Nenhum ponto cadastrado. Use o formulário para cadastrar o primeiro.',
          linhas: pontos,
          colunas: [
            { titulo: 'Ordem', classe: 'numero', valor: (p) => String(p.ordem_na_rota) },
            { titulo: 'Ponto', valor: (p) => [el('strong', {}, p.nome), p.referencia ? el('div', { class: 'suave pequeno' }, p.referencia) : null] },
            { titulo: 'Coordenadas', valor: (p) => el('span', { class: 'numero' }, `${p.latitude}, ${p.longitude}`) },
            { titulo: 'Sentido', valor: (p) => (p.sentido === 'ida' ? 'Ida' : 'Volta') },
            { titulo: 'Turnos', valor: (p) => p.turnos },
            { titulo: 'Situação', valor: (p) => [p.ativo ? selo('Ativo', 'verde') : selo('Inativo'), p.demonstrativo ? [' ', selo('Demonstrativo', '', 'selo--demo')] : null] },
            { titulo: 'Ações', valor: (p) => el('div', { class: 'grupo-botoes' },
              el('button', { class: 'botao botao--secundario botao--pequeno', type: 'button', onclick: () => editar(p) }, 'Editar'),
              el('button', { class: 'botao botao--secundario botao--pequeno', type: 'button', onclick: () => alternar(p) }, p.ativo ? 'Desativar' : 'Ativar')) },
          ],
        }));
    } catch (e) {
      if (e.status !== 401) substituir(lista, erro(`Não foi possível carregar os pontos: ${e.message}`));
    }
  }

  substituir(alvo, el('div', { class: 'duas-colunas' },
    formulario,
    el('section', { 'aria-labelledby': 'lista-pontos-titulo' },
      el('div', { class: 'painel__titulo' }, el('h2', { id: 'lista-pontos-titulo' }, 'Pontos cadastrados')),
      lista)));
  carregar();
}

// ---------------------------------------------------------------------------- rotas (consulta)
async function montarRotas(alvo) {
  substituir(alvo, carregando('Carregando rotas…'));
  try {
    const { rotas } = await chamar(() => api.get('/admin/rotas'));
    substituir(alvo,
      tabela({
        rotulo: 'Rotas e horários',
        textoVazio: 'Nenhuma rota cadastrada.',
        linhas: rotas,
        colunas: [
          { titulo: 'Rota', valor: (r) => r.nome },
          { titulo: 'Sentido', valor: (r) => (r.sentido === 'ida' ? 'Ida' : 'Volta') },
          { titulo: 'Turno', valor: (r) => r.turno },
          { titulo: 'Horário', valor: (r) => el('span', { class: 'numero' }, `${r.horario_inicio} às ${r.horario_fim}`) },
          { titulo: 'Extensão', classe: 'numero', valor: (r) => distancia(r.extensao_m) },
          { titulo: 'Situação', valor: (r) => [r.ativa ? selo('Ativa', 'verde') : selo('Inativa'), r.demonstrativa ? [' ', selo('Demonstrativa', '', 'selo--demo')] : null] },
        ],
      }),
      el('p', { class: 'alerta alerta--info nota-escopo' }, 'Rotas e horários seguem o planejamento do serviço e não são alterados por este painel. Para trocar o trajeto demonstrativo pelo oficial, siga as instruções do README (seção “Dados demonstrativos”).'));
  } catch (e) {
    if (e.status !== 401) substituir(alvo, erro(`Não foi possível carregar as rotas: ${e.message}`));
  }
}

// ---------------------------------------------------------------------------- estrutura
function montarPainel() {
  const conteudo = el('div', { id: 'painel-conteudo', role: 'tabpanel' });
  const abas = [
    { id: 'avisos', rotulo: 'Avisos', montar: montarAvisos },
    { id: 'pontos', rotulo: 'Pontos de embarque', montar: montarPontos },
    { id: 'rotas', rotulo: 'Rotas e horários', montar: montarRotas },
  ];
  const botoes = abas.map((a) => el('button', { type: 'button', role: 'tab', id: `aba-${a.id}`, 'aria-controls': 'painel-conteudo', 'aria-selected': 'false' }, a.rotulo));
  const selecionar = (i) => {
    botoes.forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
    conteudo.setAttribute('aria-labelledby', botoes[i].id);
    abas[i].montar(conteudo);
  };
  botoes.forEach((b, i) => b.addEventListener('click', () => selecionar(i)));

  const botaoSair = el('button', { class: 'botao botao--secundario botao--pequeno', type: 'button' }, 'Sair');
  botaoSair.addEventListener('click', async () => {
    try { await sair(); } finally { usuario = null; mostrarLogin(); }
  });

  substituir(raiz, el('section', { class: 'painel-equipe' },
    el('div', { class: 'painel-equipe__cabeca' },
      el('div', {}, el('h1', {}, 'Painel da equipe'), el('p', {}, 'Publique avisos operacionais e mantenha os pontos de embarque.')),
      el('div', { class: 'usuario' }, el('span', {}, usuario.nome), botaoSair)),
    el('div', { class: 'abas', role: 'tablist', 'aria-label': 'Áreas do painel' }, botoes),
    conteudo));
  selecionar(0);
}

function mostrarLogin() {
  montarLogin(raiz, {
    titulo: 'Painel da equipe',
    descricao: 'Entre para publicar avisos e cadastrar pontos de embarque.',
    aoEntrar: (u) => { usuario = u; montarPainel(); },
  });
}

async function iniciar() {
  try {
    usuario = await sessaoAtual();
  } catch (e) {
    substituir(raiz, erro(`Não foi possível verificar a sessão: ${e.message}`));
    return;
  }
  if (usuario) montarPainel(); else mostrarLogin();
}

iniciar();
