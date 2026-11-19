import { api } from '../api.js';
import { $, $$, el, substituir, vazio, erro } from '../dom.js';
import { definirFuso, dataHora } from '../formatacao.js';
import { desenharSituacao } from '../components/situacao.js';
import { desenharLinha } from '../components/linha.js';
import { desenharMapa } from '../components/mapa-rota.js';
import { criarConversa } from '../components/conversa.js';
import { notificar } from '../components/notificacao.js';

/** Página de apresentação: status, linha com previsões, trajeto, avisos e assistente. */

const INTERVALO_MS = 10000;
let rotas = null;
let estado = null;
let deslocamento = 0;
let atualizarIdade = () => {};
let falhasSeguidas = 0;
const relogioServidor = () => Date.now() + deslocamento;

function renderizarAvisos(avisos) {
  if (!avisos.length) {
    substituir($('#lista-avisos'), vazio('Nenhum aviso no momento. Quando a equipe publicar um atraso ou interrupção, ele aparece aqui e nas respostas do assistente.'));
    return;
  }
  substituir($('#lista-avisos'), el('ul', { class: 'avisos' }, avisos.map((a) => el('li', { class: ['aviso', a.interrompe_operacao && 'aviso--interrompe'] },
    el('p', {}, a.texto),
    el('small', {}, `${a.interrompe_operacao ? 'Serviço interrompido. ' : ''}Válido até ${dataHora(a.fim, estado.fuso)}${a.demonstrativo ? ' (aviso de demonstração)' : ''}.`)))));
}

function renderizar() {
  atualizarIdade = desenharSituacao($('#situacao'), estado, relogioServidor);
  desenharLinha($('#linha-diagrama'), estado);
  $('#linha-sentido').textContent = estado.rota
    ? `${estado.rota.nome}. Horário: ${estado.rota.horario}.`
    : 'O ônibus não está sobre um trajeto cadastrado agora.';
  if (rotas) desenharMapa($('#mapa'), { rotas, estado });
  substituir($('#trajeto-selo'), estado.dados_demonstrativos
    ? el('span', { class: 'selo selo--demo', title: 'Coordenadas copiadas do protótipo; não representam a localização oficial.' }, 'Coordenadas demonstrativas')
    : null);
  renderizarAvisos(estado.avisos);
}

async function atualizar() {
  try {
    if (!rotas) rotas = (await api.get('/api/rota')).rotas;
    const novo = await api.get('/api/estado');
    deslocamento = Date.parse(novo.gerado_em) - Date.now();
    estado = novo;
    definirFuso(novo.fuso);
    falhasSeguidas = 0;
    renderizar();
  } catch (e) {
    falhasSeguidas += 1;
    if (!estado) {
      const msg = e.status === 503
        ? 'O banco de dados não está respondendo. Verifique se o PostgreSQL está rodando (docker compose up -d).'
        : `Não foi possível carregar os dados: ${e.message}`;
      $('#situacao').dataset.status = '';
      substituir($('#situacao'), erro(msg));
      substituir($('#linha-diagrama'), erro('Previsões indisponíveis enquanto os dados não carregam.'));
      substituir($('#mapa'), vazio('Trajeto indisponível.'));
      substituir($('#lista-avisos'), vazio('Avisos indisponíveis.'));
    } else if (falhasSeguidas === 1) {
      notificar('Não foi possível atualizar agora. Mostrando os últimos dados recebidos.', 'erro');
    }
  }
}

async function iniciarDemonstracao(conversa) {
  let config;
  try { config = await api.get('/api/demo/config'); } catch { return; }
  if (!config.ativo) return;

  const area = $('#demonstracao');
  const observacao = $('#demo-observacao');
  const botoes = [];
  const aplicar = async (cenario, botao) => {
    botoes.forEach((b) => { b.disabled = true; b.setAttribute('aria-pressed', String(b === botao)); });
    botao.setAttribute('aria-busy', 'true');
    observacao.hidden = true;
    try {
      const r = await api.post(`/api/demo/cenarios/${encodeURIComponent(cenario.id)}`, {});
      await atualizar();
      await conversa.reiniciar({ silencioso: true });
      conversa.balao('sistema', `Situação: ${r.titulo}`);
      for (const m of r.conversa) {
        await conversa.enviar(m.texto, m.simular_demora_ms ? { simular_demora_ms: m.simular_demora_ms } : undefined);
      }
      await atualizar();
      if (r.observacao) { observacao.textContent = r.observacao; observacao.hidden = false; }
      if (cenario.id === 'restaurar') botoes.forEach((b) => b.setAttribute('aria-pressed', 'false'));
    } catch (e) {
      notificar(`Não foi possível aplicar a situação: ${e.message}`, 'erro');
    } finally {
      botoes.forEach((b) => { b.disabled = false; });
      botao.removeAttribute('aria-busy');
    }
  };

  const publicos = config.cenarios.filter((c) => c.publico);
  const restaurar = config.cenarios.find((c) => c.id === 'restaurar');
  for (const c of [...publicos, restaurar].filter(Boolean)) {
    const b = el('button', {
      class: ['botao', 'botao--pequeno', c.id === 'restaurar' ? 'botao--discreto' : 'botao--secundario'],
      type: 'button', title: c.descricao, 'aria-pressed': 'false',
    }, c.id === 'restaurar' ? 'Limpar demonstração' : c.titulo);
    b.addEventListener('click', () => aplicar(c, b));
    botoes.push(b);
  }
  substituir($('#demo-botoes'), botoes);
  area.hidden = false;
}

function iniciar() {
  const conversa = criarConversa({ mensagens: $('#mensagens'), formulario: $('#form-conversa'), entrada: $('#entrada-mensagem') });
  $('#nova-conversa').addEventListener('click', () => conversa.reiniciar());
  $$('#atalhos [data-mensagem]').forEach((b) => b.addEventListener('click', () => conversa.enviar(b.dataset.mensagem)));

  atualizar();
  iniciarDemonstracao(conversa);
  setInterval(() => { if (!document.hidden) atualizar(); }, INTERVALO_MS);
  setInterval(() => atualizarIdade(), 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
}

iniciar();
