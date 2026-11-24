'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ErroConfiguracao, carregarConfig } = require('../../server/config');
const { criarApp } = require('../../server/app');
const { MSG_SOMENTE_TEXTO, MSG_ERRO } = require('../../server/services/telegram.service');
const { criarContexto, gravarTrajeto, silencioso, ENV_TESTE } = require('../helpers/contexto');

const TG = {
  TELEGRAM_ENABLED: 'true',
  TELEGRAM_BOT_TOKEN: '123456789:AAHdummyTokenParaTestes_abcdefghij',
  TELEGRAM_WEBHOOK_SECRET: 'segredo-do-webhook-telegram-teste',
};
const CHAT = 424242;

async function iniciar({ env = TG, falharEnvio = false } = {}) {
  const enviados = [];
  const erros = [];
  const fetchImpl = async (url, opcoes) => {
    enviados.push({ url, corpo: JSON.parse(opcoes.body) });
    return falharEnvio
      ? { ok: false, status: 403, json: async () => ({ ok: false, description: 'Forbidden: bot was blocked by the user' }) }
      : { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const ctx = criarContexto({ env, fetchImpl });
  // Os serviços usam o logger silencioso do contexto de teste: captura as chamadas de erro dele.
  const erroOriginal = silencioso.erro;
  silencioso.erro = (m, d) => erros.push(`${m} ${JSON.stringify(d || {})}`);
  const logger = silencioso;
  const express = require('express');
  const app = criarApp({ express, servicos: ctx.servicos, config: ctx.config, logger });
  const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  async function postar(update, { segredo = TG.TELEGRAM_WEBHOOK_SECRET } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (segredo) headers['X-Telegram-Bot-Api-Secret-Token'] = segredo;
    const r = await fetch(`${base}/webhook/telegram`, { method: 'POST', headers, body: JSON.stringify(update) });
    await ctx.servicos.telegram.aguardarPendentes();
    return r;
  }
  return { ctx, enviados, erros, postar, fechar: () => { silencioso.erro = erroOriginal; return new Promise((ok) => servidor.close(ok)); } };
}

let seq = 1;
const mensagem = (texto, extra = {}) => ({
  update_id: seq++,
  message: { message_id: 1, from: { id: CHAT, is_bot: false }, chat: { id: CHAT, type: 'private' }, text: texto, ...extra },
});

test('configuração: desligado por padrão; ligado valida token e segredo', () => {
  assert.equal(carregarConfig(ENV_TESTE, { exigirBanco: false }).telegram.ativo, false);
  assert.throws(() => carregarConfig({ ...ENV_TESTE, TELEGRAM_ENABLED: 'true' }, { exigirBanco: false }), ErroConfiguracao);
  assert.throws(() => carregarConfig({ ...ENV_TESTE, ...TG, TELEGRAM_BOT_TOKEN: 'token-sem-formato-valido-123456' }, { exigirBanco: false }), /formato inválido/);
  assert.throws(() => carregarConfig({ ...ENV_TESTE, ...TG, TELEGRAM_WEBHOOK_SECRET: 'tem espaço e acento ção!!' }, { exigirBanco: false }), /TELEGRAM_WEBHOOK_SECRET/);
  assert.throws(() => carregarConfig({ ...ENV_TESTE, ...TG, TELEGRAM_BOT_TOKEN: 'troque-pelo-token-do-bot' }, { exigirBanco: false }), /valor de exemplo/);
  assert.equal(carregarConfig({ ...ENV_TESTE, ...TG }, { exigirBanco: false }).telegram.ativo, true);
});

test('desativado: o webhook responde 501', async () => {
  const s = await iniciar({ env: {} });
  try { assert.equal((await s.postar(mensagem('oi'), { segredo: null })).status, 501); } finally { await s.fechar(); }
});

test('segredo do webhook ausente ou errado é rejeitado e nada é enviado', async () => {
  const s = await iniciar();
  try {
    assert.equal((await s.postar(mensagem('oi'), { segredo: null })).status, 401);
    assert.equal((await s.postar(mensagem('oi'), { segredo: 'errado' })).status, 401);
    assert.equal(s.enviados.length, 0);
  } finally { await s.fechar(); }
});

test('mensagem de texto passa pelo assistente e a resposta vai ao mesmo chat', async () => {
  const s = await iniciar();
  try {
    assert.equal((await s.postar(mensagem('oi'))).status, 200);
    assert.equal(s.enviados.length, 1);
    const e = s.enviados[0];
    assert.equal(e.url, `https://api.telegram.org/bot${TG.TELEGRAM_BOT_TOKEN}/sendMessage`);
    assert.equal(e.corpo.chat_id, CHAT);
    assert.ok(e.corpo.text.length > 10);
  } finally { await s.fechar(); }
});

test('fluxo de consulta com sessão do canal telegram (só hash do identificador)', async () => {
  const s = await iniciar();
  try {
    await gravarTrajeto(s.ctx, { deM: 100, ateM: 600 });
    await s.postar(mensagem('quando o ônibus chega?'));
    const menu = s.enviados[0].corpo.text;
    assert.match(menu, /1/);
    await s.postar(mensagem('1'));
    assert.notEqual(s.enviados[1].corpo.text, menu);
    assert.match(s.enviados[1].corpo.text, /min|chega|passou|previs/i);
    const sessoes = [...s.ctx.repos._dados.sessoes.values()];
    assert.equal(sessoes.length, 1);
    assert.equal(sessoes[0].canal, 'telegram');
    assert.ok(!JSON.stringify(sessoes).includes(String(CHAT)));
  } finally { await s.fechar(); }
});

test('comandos /start e /menu (inclusive /menu@meubot) viram frases do assistente', async () => {
  const s = await iniciar();
  try {
    await s.postar(mensagem('/start'));
    await s.postar(mensagem('/menu@busucsal_bot'));
    assert.equal(s.enviados.length, 2);
    assert.ok(s.enviados.every((e) => e.corpo.text.length > 10));
  } finally { await s.fechar(); }
});

test('reenvio do mesmo update_id é respondido uma única vez', async () => {
  const s = await iniciar();
  try {
    const u = mensagem('oi');
    await s.postar(u);
    await s.postar(u);
    assert.equal(s.enviados.length, 1);
  } finally { await s.fechar(); }
});

test('figurinha/foto recebem aviso de só texto; grupos, bots e updates sem mensagem são ignorados', async () => {
  const s = await iniciar();
  try {
    await s.postar({ update_id: seq++, message: { message_id: 2, from: { id: CHAT, is_bot: false }, chat: { id: CHAT, type: 'private' }, sticker: { file_id: 'x' } } });
    assert.equal(s.enviados.length, 1);
    assert.equal(s.enviados[0].corpo.text, MSG_SOMENTE_TEXTO);

    await s.postar(mensagem('oi', { chat: { id: -100, type: 'group' } }));
    await s.postar(mensagem('oi', { from: { id: 9, is_bot: true } }));
    await s.postar({ update_id: seq++, edited_message: { text: 'x' } });
    await s.postar({ update_id: seq++ });
    assert.equal(s.enviados.length, 1);
  } finally { await s.fechar(); }
});

test('falha no envio ou no assistente não derruba o webhook e o token não vai para os logs', async () => {
  const s = await iniciar({ falharEnvio: true });
  try {
    assert.equal((await s.postar(mensagem('oi'))).status, 200);
    assert.equal(s.enviados.length, 1);
    assert.ok(s.erros.some((e) => e.includes('falha ao enviar')));

    s.ctx.servicos.conversa.processar = async () => { throw new Error('boom'); };
    await s.postar(mensagem('oi'));
    assert.equal(s.enviados.at(-1).corpo.text, MSG_ERRO);
    assert.ok(s.erros.every((e) => !e.includes(TG.TELEGRAM_BOT_TOKEN)));
  } finally { await s.fechar(); }
});

test('texto longo é cortado em 500 caracteres antes do assistente', async () => {
  const s = await iniciar();
  try {
    let recebido = null;
    const original = s.ctx.servicos.conversa.processar;
    s.ctx.servicos.conversa.processar = async (p) => { recebido = p; return original(p); };
    assert.equal((await s.postar(mensagem('a'.repeat(5000)))).status, 200);
    assert.equal(recebido.mensagem.length, 500);
    assert.equal(recebido.canal, 'telegram');
  } finally { await s.fechar(); }
});
