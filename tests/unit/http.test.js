'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  exigirTokenDispositivo, exigirAcessoInterno, exigirAdmin, exigirJson, exigirModoDemo, carregarAdmin, cabecalhosSeguranca,
} = require('../../server/middleware/seguranca');
const { tratarErros } = require('../../server/middleware/erros');
const { ValidationError } = require('../../server/utils/errors');
const { criarContexto, hasherTeste, silencioso } = require('../helpers/contexto');

function req({ headers = {}, query = {}, ip = '203.0.113.5', method = 'GET', admin } = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, headers: h, query, ip, path: '/api/x', admin, get: (n) => h[n.toLowerCase()] };
}
function res() {
  return {
    statusCode: 200, headers: {}, body: undefined, headersSent: false,
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  };
}
/** Executa o middleware e devolve o erro passado a next() (ou null). */
function rodar(mw, r) {
  let erro = 'não chamou next';
  mw(r, res(), (e) => { erro = e || null; });
  return erro;
}

const { config } = criarContexto();

test('POST /api/posicao exige o token do dispositivo', () => {
  const mw = exigirTokenDispositivo(config);
  assert.equal(rodar(mw, req({ headers: { 'X-Device-Token': config.rastreador.token } })), null);
  assert.equal(rodar(mw, req({ headers: { Authorization: `Bearer ${config.rastreador.token}` } })), null);
  assert.equal(rodar(mw, req({ query: { token: config.rastreador.token } })), null); // Traccar Client
  const invalido = rodar(mw, req({ headers: { 'X-Device-Token': 'errado' } }));
  assert.equal(invalido.status, 401);
  assert.equal(invalido.codigo, 'token_invalido');
  assert.equal(rodar(mw, req()).codigo, 'token_ausente');
});

test('GET /api/estado é interno: loopback, rede privada (se permitido), token interno ou equipe logada', () => {
  const mw = exigirAcessoInterno(config);
  assert.equal(rodar(mw, req({ ip: '127.0.0.1' })), null);
  assert.equal(rodar(mw, req({ ip: '::ffff:127.0.0.1' })), null);
  assert.equal(rodar(mw, req({ ip: '::1' })), null);
  assert.equal(rodar(mw, req({ ip: '192.168.0.20' })).status, 403);
  assert.equal(rodar(exigirAcessoInterno({ ...config, acessoInterno: { ...config.acessoInterno, permitirRedePrivada: true } }), req({ ip: '192.168.0.20' })), null);
  assert.equal(rodar(mw, req({ headers: { 'X-Internal-Token': 'token-interno-de-teste' } })), null);
  assert.equal(rodar(mw, req({ headers: { 'X-Internal-Token': 'errado' } })).status, 403);
  assert.equal(rodar(mw, req({ admin: { id: 1 } })), null);
});

test('acesso pelo túnel (ngrok) chega de 127.0.0.1 mas não é interno', () => {
  const mw = exigirAcessoInterno(config);
  assert.equal(rodar(mw, req({ ip: '127.0.0.1', headers: { 'X-Forwarded-For': '203.0.113.9' } })).status, 403);
  assert.equal(rodar(mw, req({ ip: '127.0.0.1', headers: { Forwarded: 'for=203.0.113.9' } })).status, 403);
  // Pelo túnel, a equipe logada e o token interno continuam funcionando.
  assert.equal(rodar(mw, req({ ip: '127.0.0.1', headers: { 'X-Forwarded-For': '203.0.113.9' }, admin: { id: 1 } })), null);
  assert.equal(rodar(mw, req({ ip: '127.0.0.1', headers: { 'X-Forwarded-For': '203.0.113.9', 'X-Internal-Token': 'token-interno-de-teste' } })), null);
});

test('rotas administrativas exigem sessão válida no servidor (não basta esconder na interface)', async () => {
  assert.equal(rodar(exigirAdmin, req()).status, 401);
  assert.equal(rodar(exigirAdmin, req({ admin: { id: 1 } })), null);

  const ctx = criarContexto();
  await ctx.repos.admin.criarOuAtualizar({ nome: 'Equipe', email: 'equipe@ucsal.br', senhaHash: await hasherTeste.hash('senha-correta-123', 10) });
  const { token } = await ctx.servicos.auth.login({ email: 'equipe@ucsal.br', senha: 'senha-correta-123' }, '127.0.0.1');
  const mw = carregarAdmin(ctx.config, ctx.servicos.auth);
  const executar = (cookie) => new Promise((resolve) => { const r = req({ headers: { cookie } }); mw(r, res(), () => resolve(r.admin)); });
  assert.equal((await executar(`busucsal_sessao=${token}`)).email, 'equipe@ucsal.br');
  assert.equal(await executar(`busucsal_sessao=${token}x`), null);
  assert.equal(await executar(''), null);
});

test('métodos que alteram dados exigem JSON (proteção contra CSRF por formulário)', () => {
  assert.equal(rodar(exigirJson, req({ method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' } })), null);
  assert.equal(rodar(exigirJson, req({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal(rodar(exigirJson, req({ method: 'DELETE' })), null);
  assert.equal(rodar(exigirJson, req({ method: 'GET' })), null);
});

test('modo de demonstração desligado esconde os endpoints de demonstração', () => {
  assert.equal(rodar(exigirModoDemo({ demo: { ativo: false } }), req()).status, 404);
  assert.equal(rodar(exigirModoDemo({ demo: { ativo: true } }), req()), null);
});

test('cabeçalhos de segurança com CSP sem scripts inline', () => {
  const r = res();
  cabecalhosSeguranca(req(), r, () => {});
  assert.match(r.headers['content-security-policy'], /script-src 'self'/);
  assert.doesNotMatch(r.headers['content-security-policy'], /unsafe-inline/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('tratamento centralizado de erros', () => {
  const tratar = tratarErros(silencioso);
  const responder = (erro) => { const r = res(); tratar(erro, req(), r, () => {}); return r; };

  const v = responder(new ValidationError('Posição inválida.', [{ campo: 'latitude', mensagem: 'x' }]));
  assert.equal(v.statusCode, 400);
  assert.deepEqual(v.body, { erro: { codigo: 'dados_invalidos', mensagem: 'Posição inválida.', detalhes: [{ campo: 'latitude', mensagem: 'x' }] } });

  assert.equal(responder(Object.assign(new Error('bad json'), { type: 'entity.parse.failed' })).body.erro.codigo, 'json_invalido');
  const indisponivel = responder(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }));
  assert.equal(indisponivel.statusCode, 503);
  assert.equal(indisponivel.body.erro.codigo, 'banco_indisponivel');
  assert.equal(indisponivel.headers['retry-after'], '10');
  assert.equal(responder(Object.assign(new Error('dup'), { code: '23505' })).statusCode, 409);
  assert.equal(responder(Object.assign(new Error('check'), { code: '23514' })).statusCode, 400);
  const interno = responder(new Error('detalhe interno que não deve vazar'));
  assert.equal(interno.statusCode, 500);
  assert.equal(interno.body.erro.mensagem, 'Erro interno do servidor.');
});
