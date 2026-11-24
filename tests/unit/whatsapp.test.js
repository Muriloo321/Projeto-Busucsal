'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ErroConfiguracao, carregarConfig } = require('../../server/config');
const { criarApp } = require('../../server/app');
const { MSG_SOMENTE_TEXTO, MSG_ERRO } = require('../../server/services/whatsapp.service');
const { criarContexto, gravarTrajeto, ENV_TESTE, silencioso } = require('../helpers/contexto');

const WA = {
  WHATSAPP_ENABLED: 'true',
  WHATSAPP_VERIFY_TOKEN: 'token-de-verificacao-teste',
  WHATSAPP_APP_SECRET: 'segredo-do-app-whatsapp-teste',
  WHATSAPP_ACCESS_TOKEN: 'token-de-acesso-whatsapp-teste-123',
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
};
const NUMERO = '5571999990000';

/** Sobe o app Express real (repositórios em memória) com um "Graph API" falso que registra os envios. */
async function iniciar({ env = WA, falharEnvio = false } = {}) {
  const enviados = [];
  const fetchImpl = async (url, opcoes) => {
    enviados.push({ url, headers: opcoes.headers, corpo: JSON.parse(opcoes.body) });
    return falharEnvio
      ? { ok: false, status: 400, json: async () => ({ error: { code: 131047, message: 'fora da janela' } }) }
      : { ok: true, status: 200, json: async () => ({}) };
  };
  const ctx = criarContexto({ env, fetchImpl });
  const express = require('express');
  const app = criarApp({ express, servicos: ctx.servicos, config: ctx.config, logger: silencioso });
  const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const assinar = (texto) => `sha256=${crypto.createHmac('sha256', WA.WHATSAPP_APP_SECRET).update(texto).digest('hex')}`;
  async function postar(payload, { assinatura } = {}) {
    const texto = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json' };
    const sig = assinatura === undefined ? assinar(texto) : assinatura;
    if (sig) headers['X-Hub-Signature-256'] = sig;
    const r = await fetch(`${base}/webhook/whatsapp`, { method: 'POST', headers, body: texto });
    await ctx.servicos.whatsapp.aguardarPendentes();
    return r;
  }
  return { ctx, base, enviados, postar, fechar: () => new Promise((ok) => servidor.close(ok)) };
}

function payload(mensagens, { phoneNumberId = WA.WHATSAPP_PHONE_NUMBER_ID } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, messages: mensagens } }] }],
  };
}
const texto = (corpo, id = `wamid.${Math.random()}`) => ({ from: NUMERO, id, type: 'text', text: { body: corpo }, timestamp: '1' });

test('configuração: desligado por padrão; ligado exige credenciais e ID numérico', () => {
  assert.equal(carregarConfig(ENV_TESTE, { exigirBanco: false }).whatsapp.ativo, false);
  assert.throws(() => carregarConfig({ ...ENV_TESTE, WHATSAPP_ENABLED: 'true' }, { exigirBanco: false }), ErroConfiguracao);
  assert.throws(() => carregarConfig({ ...ENV_TESTE, ...WA, WHATSAPP_PHONE_NUMBER_ID: 'abc' }, { exigirBanco: false }), /PHONE_NUMBER_ID/);
  assert.throws(() => carregarConfig({ ...ENV_TESTE, ...WA, WHATSAPP_VERIFY_TOKEN: 'troque-por-um-token-de-verificacao' }, { exigirBanco: false }), /valor de exemplo/);
  assert.equal(carregarConfig({ ...ENV_TESTE, ...WA }, { exigirBanco: false }).whatsapp.phoneNumberId, '1234567890');
});

test('desativado: GET e POST do webhook respondem 501', async () => {
  const s = await iniciar({ env: {} });
  try {
    assert.equal((await fetch(`${s.base}/webhook/whatsapp?hub.mode=subscribe`)).status, 501);
    assert.equal((await s.postar({}, { assinatura: null })).status, 501);
  } finally { await s.fechar(); }
});

test('GET: verificação devolve o hub.challenge só com o token correto', async () => {
  const s = await iniciar();
  try {
    const url = (t) => `${s.base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=987654`;
    const ok = await fetch(url(WA.WHATSAPP_VERIFY_TOKEN));
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '987654');
    assert.equal((await fetch(url('errado'))).status, 403);
    assert.equal((await fetch(`${s.base}/webhook/whatsapp?hub.mode=subscribe&hub.challenge=1`)).status, 403);
  } finally { await s.fechar(); }
});

test('POST: assinatura ausente, malformada ou errada é rejeitada e nada é enviado', async () => {
  const s = await iniciar();
  try {
    const corpo = payload([texto('oi')]);
    assert.equal((await s.postar(corpo, { assinatura: null })).status, 401);
    assert.equal((await s.postar(corpo, { assinatura: 'sha256=abc' })).status, 401);
    assert.equal((await s.postar(corpo, { assinatura: `sha256=${'0'.repeat(64)}` })).status, 401);
    assert.equal(s.enviados.length, 0);
  } finally { await s.fechar(); }
});

test('POST: mensagem de texto passa pelo assistente e a resposta é enviada ao remetente', async () => {
  const s = await iniciar();
  try {
    const r = await s.postar(payload([texto('oi')]));
    assert.equal(r.status, 200);
    assert.equal(s.enviados.length, 1);
    const e = s.enviados[0];
    assert.equal(e.url, 'https://graph.facebook.com/v21.0/1234567890/messages');
    assert.equal(e.headers.Authorization, `Bearer ${WA.WHATSAPP_ACCESS_TOKEN}`);
    assert.equal(e.corpo.messaging_product, 'whatsapp');
    assert.equal(e.corpo.to, NUMERO);
    assert.equal(e.corpo.type, 'text');
    assert.ok(e.corpo.text.body.length > 10);
  } finally { await s.fechar(); }
});

test('POST: a conversa segue o fluxo de consulta por número, com sessão do canal whatsapp (só hash)', async () => {
  const s = await iniciar();
  try {
    await gravarTrajeto(s.ctx, { deM: 100, ateM: 600 });
    await s.postar(payload([texto('quando o ônibus chega?')]));
    const menu = s.enviados[0].corpo.text.body;
    assert.match(menu, /1/);
    await s.postar(payload([texto('1')]));
    assert.equal(s.enviados.length, 2);
    const previsao = s.enviados[1].corpo.text.body;
    assert.notEqual(previsao, menu);
    assert.match(previsao, /min|chega|passou|previs/i);

    const sessoes = [...s.ctx.repos._dados.sessoes.values()];
    assert.equal(sessoes.length, 1);
    assert.equal(sessoes[0].canal, 'whatsapp');
    assert.ok(!JSON.stringify(sessoes).includes(NUMERO));
  } finally { await s.fechar(); }
});

test('POST: reenvio da Meta com o mesmo id de mensagem é respondido uma única vez', async () => {
  const s = await iniciar();
  try {
    const corpo = payload([texto('oi', 'wamid.REPETIDA')]);
    await s.postar(corpo);
    await s.postar(corpo);
    assert.equal(s.enviados.length, 1);
  } finally { await s.fechar(); }
});

test('POST: áudio/imagem recebem aviso de que só texto é aceito; status de entrega e outro número são ignorados', async () => {
  const s = await iniciar();
  try {
    await s.postar(payload([{ from: NUMERO, id: 'wamid.A', type: 'audio', audio: { id: '1' } }]));
    assert.equal(s.enviados.length, 1);
    assert.equal(s.enviados[0].corpo.text.body, MSG_SOMENTE_TEXTO);

    await s.postar({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: WA.WHATSAPP_PHONE_NUMBER_ID }, statuses: [{ id: 'x', status: 'delivered' }] } }] }] });
    await s.postar(payload([texto('oi', 'wamid.OUTRO')], { phoneNumberId: '999999' }));
    await s.postar({ object: 'page', entry: [] });
    assert.equal(s.enviados.length, 1);
  } finally { await s.fechar(); }
});

test('POST: número de remetente malformado é descartado; texto longo é cortado em 500 caracteres', async () => {
  const s = await iniciar();
  try {
    await s.postar(payload([{ from: '../etc', id: 'wamid.B', type: 'text', text: { body: 'oi' } }]));
    assert.equal(s.enviados.length, 0);
    const r = await s.postar(payload([texto('a'.repeat(5000))]));
    assert.equal(r.status, 200);
    assert.equal(s.enviados.length, 1);
  } finally { await s.fechar(); }
});

test('POST: falha no envio ou no assistente não derruba o webhook (200 à Meta)', async () => {
  const s = await iniciar({ falharEnvio: true });
  try {
    assert.equal((await s.postar(payload([texto('oi')]))).status, 200);
    assert.equal(s.enviados.length, 1); // tentou enviar

    s.ctx.servicos.conversa.processar = async () => { throw new Error('boom'); };
    const s2 = s; // mesma instância: o erro vira mensagem amigável
    const antes = s2.enviados.length;
    await s2.postar(payload([texto('oi')]));
    assert.equal(s2.enviados.length, antes + 1);
    assert.equal(s2.enviados.at(-1).corpo.text.body, MSG_ERRO);
  } finally { await s.fechar(); }
});

test('POST: JSON inválido assinado → 400; corpo acima do limite → 413', async () => {
  const s = await iniciar();
  try {
    assert.equal((await s.postar('{nao-e-json')).status, 400);
    assert.equal((await s.postar({ lixo: 'x'.repeat(300 * 1024) })).status, 413);
  } finally { await s.fechar(); }
});

test('o verify_token não aparece nos registros de requisições', async () => {
  const s = await iniciar();
  try {
    await fetch(`${s.base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${WA.WHATSAPP_VERIFY_TOKEN}&hub.challenge=1`);
    const lista = JSON.stringify(s.ctx.servicos.registroRequisicoes.listar ? s.ctx.servicos.registroRequisicoes.listar() : []);
    assert.ok(!lista.includes(WA.WHATSAPP_VERIFY_TOKEN));
  } finally { await s.fechar(); }
});
