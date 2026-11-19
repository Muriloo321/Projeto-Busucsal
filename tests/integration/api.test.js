'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { motivoParaPular, prepararBanco, iniciarApp } = require('./apoio');

const pular = motivoParaPular();

describe('API HTTP com Express, PostgreSQL e PostGIS reais', { skip: pular }, () => {
  let cliente;
  let ctx;
  let cookie;
  const token = () => ctx.config.rastreador.token;
  const agora = () => new Date().toISOString();
  const minutosAtras = (m, s = 0) => new Date(Date.now() - m * 60000 - s * 1000).toISOString();

  async function posicaoNaRota(metros, { registrado = agora(), velocidade = 15 } = {}) {
    const c = await ctx.repos.rota.coordenadaNaDistancia(1, metros);
    return ctx.http('POST', '/api/posicao', {
      cabecalhos: { 'x-device-token': token() },
      corpo: { dispositivo_id: 'busucsal-01', latitude: c.latitude, longitude: c.longitude, velocidade_kmh: velocidade, registrado_em: registrado },
    });
  }

  async function limparPosicoes() {
    await cliente.query('DELETE FROM estado_veiculo; DELETE FROM posicao_veiculo; DELETE FROM aviso;');
  }

  before(async () => {
    cliente = await prepararBanco();
    ctx = await iniciarApp();
    const senhaHash = await ctx.bcrypt.hash('senha-de-teste-123', 10);
    await ctx.repos.admin.criarOuAtualizar({ nome: 'Equipe de teste', email: 'equipe@ucsal.br', senhaHash });
  });

  after(async () => {
    if (ctx) await ctx.fechar();
    if (cliente) await cliente.end();
  });

  test('POST /api/posicao: sem token, token inválido e token válido', async () => {
    await limparPosicoes();
    assert.equal((await ctx.http('POST', '/api/posicao', { corpo: { dispositivo_id: 'busucsal-01', latitude: -12.96, longitude: -38.41 } })).status, 401);
    assert.equal((await ctx.http('POST', '/api/posicao', { cabecalhos: { 'x-device-token': 'errado' }, corpo: { dispositivo_id: 'busucsal-01', latitude: -12.96, longitude: -38.41 } })).status, 401);
    const r = await posicaoNaRota(400);
    assert.equal(r.status, 200);
    assert.equal(r.corpo.rota_id, 1);
    assert.ok(Math.abs(r.corpo.progresso_m - 400) < 5);
    const { rows } = await cliente.query('SELECT ultima_posicao_id, rota_id FROM estado_veiculo WHERE dispositivo_id = $1', ['busucsal-01']);
    assert.equal(rows[0].ultima_posicao_id, r.corpo.posicao_id);
  });

  test('POST /api/posicao: validação de coordenadas, velocidade e dispositivo', async () => {
    const enviar = (corpo) => ctx.http('POST', '/api/posicao', { cabecalhos: { 'x-device-token': token() }, corpo: { dispositivo_id: 'busucsal-01', latitude: -12.96, longitude: -38.41, ...corpo } });
    const lat = await enviar({ latitude: 123 });
    assert.equal(lat.status, 400);
    assert.equal(lat.corpo.erro.detalhes[0].campo, 'latitude');
    assert.equal((await enviar({ velocidade_kmh: 500 })).status, 400);
    assert.equal((await enviar({ dispositivo_id: 'intruso' })).status, 403);
    const invalido = await fetch(`${ctx.base}/api/posicao`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': token() }, body: '{quebrado' });
    assert.equal(invalido.status, 400);
  });

  test('POST /api/posicao: formato OsmAnd do Traccar Client (token na URL, velocidade em nós)', async () => {
    const c = await ctx.repos.rota.coordenadaNaDistancia(1, 450);
    const q = new URLSearchParams({ id: 'busucsal-01', lat: String(c.latitude), lon: String(c.longitude), speed: '10', timestamp: String(Math.floor(Date.now() / 1000)), token: token() });
    const r = await fetch(`${ctx.base}/api/posicao?${q}`, { method: 'POST' });
    assert.equal(r.status, 200);
    const { rows } = await cliente.query('SELECT velocidade_kmh FROM posicao_veiculo ORDER BY id DESC LIMIT 1');
    assert.equal(rows[0].velocidade_kmh, 18.52);
  });

  test('GET /api/estado: previsão ao longo da rota e ponto já ultrapassado', async () => {
    await limparPosicoes();
    for (let i = 8; i >= 0; i -= 1) await posicaoNaRota(400 - i * 40, { registrado: minutosAtras(0, i * 30), velocidade: 12 });
    const r = await ctx.http('GET', '/api/estado');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.status.codigo, 'em_circulacao');
    const [p1, p2] = r.corpo.pontos;
    assert.equal(p1.previsao.tipo, 'ja_passou');
    assert.equal(p2.previsao.tipo, 'previsao');
    assert.ok(p2.previsao.minutos >= 1);
    assert.ok(r.corpo.veiculo.ultima_atualizacao_local);
  });

  test('GET /api/estado: posição vencida bloqueia a previsão', async () => {
    await limparPosicoes();
    await posicaoNaRota(400, { registrado: minutosAtras(4) });
    const r = await ctx.http('GET', '/api/estado');
    assert.equal(r.corpo.status.codigo, 'sem_dados');
    assert.ok(r.corpo.pontos.every((p) => p.previsao.tipo === 'indisponivel'));
  });

  test('GET /api/estado: veículo parado por mais de 5 minutos', async () => {
    await limparPosicoes();
    for (let i = 13; i >= 0; i -= 1) await posicaoNaRota(300, { registrado: minutosAtras(0, i * 30), velocidade: 0 });
    assert.equal((await ctx.http('GET', '/api/estado')).corpo.status.codigo, 'parado');
  });

  test('autenticação administrativa', async () => {
    assert.equal((await ctx.http('GET', '/admin/avisos')).status, 401);
    assert.equal((await ctx.http('POST', '/admin/login', { corpo: { email: 'equipe@ucsal.br', senha: 'errada' } })).status, 401);
    const ok = await ctx.http('POST', '/admin/login', { corpo: { email: 'equipe@ucsal.br', senha: 'senha-de-teste-123' } });
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    cookie = setCookie.split(';')[0];
    assert.equal((await ctx.http('GET', '/admin/sessao', { cookie })).corpo.usuario.email, 'equipe@ucsal.br');
    assert.equal((await ctx.http('GET', '/admin/avisos', { cookie: `${cookie}x` })).status, 401);
  });

  test('avisos: cadastro, interrupção no status, desativação e exclusão', async () => {
    await limparPosicoes();
    await posicaoNaRota(400);
    const inicio = minutosAtras(1);
    const fim = new Date(Date.now() + 3600000).toISOString();
    const criado = await ctx.http('POST', '/admin/avisos', { cookie, corpo: { texto: 'Manutenção do veículo.', inicio, fim, interrompe_operacao: true } });
    assert.equal(criado.status, 201);
    assert.equal(criado.corpo.aviso.situacao, 'vigente');
    let e = await ctx.http('GET', '/api/estado');
    assert.equal(e.corpo.status.codigo, 'fora_de_operacao');
    assert.equal(e.corpo.status.motivo, 'aviso_interrupcao');

    const id = criado.corpo.aviso.id;
    assert.equal((await ctx.http('PATCH', `/admin/avisos/${id}/ativo`, { cookie, corpo: { ativo: false } })).corpo.aviso.situacao, 'inativo');
    e = await ctx.http('GET', '/api/estado');
    assert.equal(e.corpo.status.codigo, 'em_circulacao');
    assert.equal((await ctx.http('PUT', `/admin/avisos/${id}`, { cookie, corpo: { texto: 'Texto revisado.' } })).corpo.aviso.texto, 'Texto revisado.');
    assert.equal((await ctx.http('POST', '/admin/avisos', { cookie, corpo: { texto: 'x', inicio, fim } })).status, 400);
    assert.equal((await ctx.http('DELETE', `/admin/avisos/${id}`, { cookie })).status, 200);
    assert.equal((await ctx.http('DELETE', `/admin/avisos/${id}`, { cookie })).status, 404);
  });

  test('fora de operação fora da grade de horários', async () => {
    await cliente.query("UPDATE rota SET horario_inicio = '00:00', horario_fim = '00:00:01'");
    try {
      const e = await ctx.http('GET', '/api/estado');
      assert.equal(e.corpo.status.codigo, 'fora_de_operacao');
      assert.equal(e.corpo.status.motivo, 'fora_da_grade');
    } finally {
      await cliente.query("UPDATE rota SET horario_inicio = '00:00', horario_fim = '23:59:59'");
    }
  });

  test('pontos: recusa ponto fora do trajeto e aceita sobre ele', async () => {
    const fora = await ctx.http('POST', '/admin/pontos', { cookie, corpo: { nome: 'Longe', latitude: -12.99, longitude: -38.45, ordem_na_rota: 7, sentido: 'ida' } });
    assert.equal(fora.status, 422);
    const c = await ctx.repos.rota.coordenadaNaDistancia(1, 700);
    const ok = await ctx.http('POST', '/admin/pontos', { cookie, corpo: { nome: 'Intermediário', latitude: c.latitude, longitude: c.longitude, ordem_na_rota: 7, sentido: 'ida' } });
    assert.equal(ok.status, 201);
    assert.ok(ok.corpo.ponto.distancia_trajeto_m <= 1);
    await ctx.http('PATCH', `/admin/pontos/${ok.corpo.ponto.id}/ativo`, { cookie, corpo: { ativo: false } });
  });

  test('conversa: sessão própria, resposta numérica contextual e expiração em 24 h', async () => {
    await limparPosicoes();
    await posicaoNaRota(400);
    const falar = (mensagem) => ctx.http('POST', '/api/conversa/simulador', { corpo: { sessao_local: 'integracao-0001', mensagem } });
    assert.match((await falar('oi, cadê o bus?')).corpo.resposta, /Em qual ponto você está\?/);
    const r = await falar('2');
    assert.match(r.corpo.resposta, /em cerca de \d+ minutos? \(atualizado às \d{2}:\d{2}\)/);
    const { rows } = await cliente.query('SELECT etapa_do_dialogo, ponto_id FROM sessao_conversa');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].etapa_do_dialogo, 'ponto_definido');

    await cliente.query("UPDATE sessao_conversa SET criado_em = now() - interval '25 hours', expira_em = now() - interval '1 hour'");
    const nova = await falar('quanto tempo falta?');
    assert.equal(nova.corpo.sessao.nova, true);
    assert.equal(nova.corpo.ponto_id, null);
  });

  test('webhook do WhatsApp fora do escopo, saúde e página 404', async () => {
    assert.equal((await ctx.http('POST', '/webhook/whatsapp', { corpo: {} })).status, 501);
    assert.equal((await ctx.http('GET', '/api/saude')).corpo.banco, 'ok');
    assert.equal((await ctx.http('GET', '/api/nao-existe')).status, 404);
    for (const pagina of ['/', '/admin', '/tecnico']) assert.equal((await ctx.http('GET', pagina)).status, 200, pagina);
  });

  test('banco indisponível responde 503', async () => {
    const offline = await iniciarApp({ bancoUrl: 'postgres://ninguem:senha@127.0.0.1:1/nada' });
    try {
      const r = await offline.http('GET', '/api/estado');
      assert.equal(r.status, 503);
      assert.equal(r.corpo.erro.codigo, 'banco_indisponivel');
    } finally {
      await offline.fechar();
    }
  });
});
