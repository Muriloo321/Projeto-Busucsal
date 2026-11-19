'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarContexto, hasherTeste } = require('../helpers/contexto');
const { verificarToken } = require('../../server/utils/seguranca');

async function comAdmin() {
  const ctx = criarContexto();
  const senhaHash = await hasherTeste.hash('senha-correta-123', 10);
  const admin = await ctx.repos.admin.criarOuAtualizar({ nome: 'Coordenação', email: 'equipe@ucsal.br', senhaHash });
  return { ctx, admin };
}

test('login com senha correta devolve token assinado', async () => {
  const { ctx, admin } = await comAdmin();
  const r = await ctx.servicos.auth.login({ email: 'EQUIPE@ucsal.br', senha: 'senha-correta-123' }, '127.0.0.1');
  assert.equal(r.usuario.id, admin.id);
  assert.equal(verificarToken(r.token, ctx.config.sessaoAdmin.segredo, ctx.relogio.agora().getTime()).sub, admin.id);
  assert.deepEqual(await ctx.servicos.auth.autenticar(r.token), { id: admin.id, nome: 'Coordenação', email: 'equipe@ucsal.br' });
});

test('senha errada, e-mail inexistente e usuário inativo são recusados da mesma forma', async () => {
  const { ctx } = await comAdmin();
  for (const dados of [{ email: 'equipe@ucsal.br', senha: 'errada' }, { email: 'ninguem@ucsal.br', senha: 'x' }]) {
    await assert.rejects(ctx.servicos.auth.login(dados, '10.0.0.1'), (e) => e.status === 401 && e.message === 'E-mail ou senha inválidos.');
  }
  ctx.repos._dados.admins[0].ativo = false;
  await assert.rejects(ctx.servicos.auth.login({ email: 'equipe@ucsal.br', senha: 'senha-correta-123' }, '10.0.0.2'), (e) => e.status === 401);
});

test('bloqueia após 5 tentativas erradas e libera depois de 15 minutos', async () => {
  const { ctx } = await comAdmin();
  for (let i = 0; i < 5; i += 1) await assert.rejects(ctx.servicos.auth.login({ email: 'equipe@ucsal.br', senha: 'x' }, '10.0.0.9'));
  await assert.rejects(ctx.servicos.auth.login({ email: 'equipe@ucsal.br', senha: 'senha-correta-123' }, '10.0.0.9'), (e) => e.status === 429);
  ctx.relogio.avancar(16 * 60 * 1000);
  assert.ok((await ctx.servicos.auth.login({ email: 'equipe@ucsal.br', senha: 'senha-correta-123' }, '10.0.0.9')).token);
});

test('token expirado ou de usuário desativado não autentica', async () => {
  const { ctx } = await comAdmin();
  const { token } = await ctx.servicos.auth.login({ email: 'equipe@ucsal.br', senha: 'senha-correta-123' }, '127.0.0.1');
  ctx.relogio.avancar(ctx.config.sessaoAdmin.validadeS * 1000 + 1000);
  assert.equal(await ctx.servicos.auth.autenticar(token), null);
  ctx.relogio.avancar(-(ctx.config.sessaoAdmin.validadeS * 1000 + 1000));
  ctx.repos._dados.admins[0].ativo = false;
  assert.equal(await ctx.servicos.auth.autenticar(token), null);
});

test('senha curta não é aceita na criação de usuário', async () => {
  const { ctx } = await comAdmin();
  await assert.rejects(ctx.servicos.auth.gerarHash('curta'), (e) => e.status === 400);
});

test('bcrypt real (bcryptjs), quando instalado', async (t) => {
  let bcrypt;
  try { bcrypt = require('bcryptjs'); } catch { t.skip('bcryptjs não instalado (rode npm install)'); return; }
  const hash = await bcrypt.hash('senha-correta-123', 10);
  assert.match(hash, /^\$2[aby]\$10\$.{53}$/);
  assert.equal(await bcrypt.compare('senha-correta-123', hash), true);
  assert.equal(await bcrypt.compare('outra', hash), false);
});

test('cadastro, edição, ativação, desativação e exclusão de avisos', async () => {
  const { ctx, admin } = await comAdmin();
  const agora = ctx.relogio.agora();
  const iso = (ms) => new Date(agora.getTime() + ms).toISOString();
  const a = await ctx.servicos.avisos.criar({ texto: 'Atraso de 10 min.', inicio: iso(-60000), fim: iso(3600000) }, admin.id);
  assert.equal(a.situacao, 'vigente');
  assert.equal(a.criado_por_nome, 'Coordenação');
  assert.equal((await ctx.servicos.estado.montar()).avisos.length, 1);

  const desativado = await ctx.servicos.avisos.definirAtivo(a.id, false);
  assert.equal(desativado.situacao, 'inativo');
  assert.equal((await ctx.servicos.estado.montar()).avisos.length, 0);
  assert.equal((await ctx.servicos.avisos.definirAtivo(a.id, true)).situacao, 'vigente');

  const futuro = await ctx.servicos.avisos.criar({ texto: 'Mudança amanhã.', inicio: iso(86400000), fim: iso(90000000) }, admin.id);
  assert.equal(futuro.situacao, 'agendado');
  await assert.rejects(ctx.servicos.avisos.atualizar(futuro.id, { fim: iso(1000) }), (e) => e.status === 400);
  assert.equal((await ctx.servicos.avisos.atualizar(futuro.id, { texto: 'Mudança confirmada.' })).texto, 'Mudança confirmada.');
  await assert.rejects(ctx.servicos.avisos.criar({ texto: 'x', inicio: iso(0), fim: iso(1) }, admin.id), (e) => e.status === 400);
  await assert.rejects(ctx.servicos.avisos.definirAtivo(999, true), (e) => e.status === 404);
  await assert.rejects(ctx.servicos.avisos.definirAtivo(a.id, 'sim'), (e) => e.status === 400);
  assert.deepEqual(await ctx.servicos.avisos.excluir(a.id), { excluido: true });
  assert.equal((await ctx.servicos.avisos.listar()).length, 1);
});

test('pontos: cadastro sobre o trajeto, recusa fora dele e ordem repetida', async () => {
  const { ctx } = await comAdmin();
  const novo = await ctx.servicos.pontos.criar({ nome: 'Ponto intermediário', latitude: -12.9646, longitude: -38.4170, ordem_na_rota: 5, sentido: 'ida' });
  assert.ok(novo.distancia_trajeto_m <= 100);
  await assert.rejects(ctx.servicos.pontos.criar({ nome: 'Longe', latitude: -12.99, longitude: -38.45, ordem_na_rota: 6, sentido: 'ida' }), (e) => e.status === 422);
  await assert.rejects(ctx.servicos.pontos.criar({ nome: 'Repetido', latitude: -12.9646, longitude: -38.4170, ordem_na_rota: 2, sentido: 'ida' }), (e) => e.status === 409);
  await assert.rejects(ctx.servicos.pontos.criar({ nome: 'Volta', latitude: -12.9646, longitude: -38.4170, ordem_na_rota: 1, sentido: 'volta' }), (e) => e.status === 422);
  const editado = await ctx.servicos.pontos.atualizar(2, { referencia: 'Em frente à passarela' });
  assert.equal(editado.demonstrativo, false);
  assert.equal((await ctx.servicos.pontos.definirAtivo(2, false)).ativo, false);
});
