'use strict';

/**
 * Simula a Meta no seu computador, sem conta nem internet:
 *  - sobe uma "Graph API" falsa (porta 4010) que imprime as respostas do assistente;
 *  - envia mensagens ASSINADAS para http://localhost:PORT/webhook/whatsapp.
 *
 * Pré-requisito: no .env, WHATSAPP_ENABLED=true, WHATSAPP_GRAPH_URL=http://127.0.0.1:4010
 * (as outras WHATSAPP_* podem ter qualquer valor de teste) e o servidor rodando (npm start).
 *
 * Uso:  npm run whatsapp:simular            (conversa interativa)
 *       npm run whatsapp:simular -- "oi"    (uma mensagem)
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');

const raiz = path.join(__dirname, '..');
if (fs.existsSync(path.join(raiz, '.env'))) process.loadEnvFile(path.join(raiz, '.env'));

const env = process.env;
const porta = env.PORT || '3000';
const segredo = env.WHATSAPP_APP_SECRET;
const phoneId = env.WHATSAPP_PHONE_NUMBER_ID;
const NUMERO = '5571999990000';
const PORTA_GRAPH = Number((env.WHATSAPP_GRAPH_URL || '').split(':').pop()) || 4010;

if (env.WHATSAPP_ENABLED !== 'true' || !segredo || !phoneId) {
  console.error('Defina no .env: WHATSAPP_ENABLED=true, WHATSAPP_APP_SECRET, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN\ne WHATSAPP_GRAPH_URL=http://127.0.0.1:4010 — depois reinicie o servidor.');
  process.exit(1);
}
if (!/127\.0\.0\.1|localhost/.test(env.WHATSAPP_GRAPH_URL || '')) {
  console.error('WHATSAPP_GRAPH_URL deve apontar para http://127.0.0.1:4010 durante a simulação (senão as respostas iriam para a Meta de verdade).');
  process.exit(1);
}

let aguardando = null;
const graph = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (d) => { corpo += d; });
  req.on('end', () => {
    try {
      const m = JSON.parse(corpo);
      console.log(`\n🤖 Bot → ${m.to}:\n${m.text.body}\n`);
    } catch { console.log('(envio inválido)', corpo); }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    if (aguardando) aguardando();
  });
});

async function enviar(texto) {
  const corpo = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'SIMULADO', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: phoneId },
      messages: [{ from: NUMERO, id: `wamid.sim.${crypto.randomUUID()}`, type: 'text', text: { body: texto }, timestamp: String(Math.floor(Date.now() / 1000)) }],
    } }] }],
  });
  const assinatura = `sha256=${crypto.createHmac('sha256', segredo).update(corpo).digest('hex')}`;
  const espera = new Promise((ok) => { aguardando = ok; setTimeout(ok, 4000); });
  const r = await fetch(`http://127.0.0.1:${porta}/webhook/whatsapp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinatura }, body: corpo,
  });
  if (r.status !== 200) { console.error(`Webhook respondeu HTTP ${r.status}: ${await r.text()}`); return; }
  await espera;
}

graph.listen(PORTA_GRAPH, '127.0.0.1', async () => {
  const args = process.argv.slice(2);
  try {
    if (args.length > 0) {
      console.log(`👤 Você: ${args.join(' ')}`);
      await enviar(args.join(' '));
      graph.close(); return;
    }
    console.log('Conversa simulada pelo WhatsApp. Digite uma mensagem (Ctrl+C para sair).');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '👤 Você: ' });
    rl.prompt();
    rl.on('line', async (l) => { if (l.trim()) await enviar(l.trim()); rl.prompt(); });
    rl.on('close', () => { graph.close(); });
  } catch (e) {
    console.error(`Não consegui falar com o servidor em localhost:${porta}. Ele está rodando (npm start)?`, e.cause ? e.cause.code : e.message);
    graph.close();
  }
});
