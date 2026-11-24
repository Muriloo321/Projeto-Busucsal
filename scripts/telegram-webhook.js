'use strict';

/**
 * Registra (ou remove) o webhook do bot no Telegram.
 *   node scripts/telegram-webhook.js https://SEU-ENDERECO.ngrok-free.dev   → registra
 *   node scripts/telegram-webhook.js --remover                             → remove
 *   node scripts/telegram-webhook.js --status                              → mostra o estado
 * Lê TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET do .env.
 */
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
if (fs.existsSync(path.join(raiz, '.env'))) process.loadEnvFile(path.join(raiz, '.env'));

const token = process.env.TELEGRAM_BOT_TOKEN;
const segredo = process.env.TELEGRAM_WEBHOOK_SECRET;
const base = (process.env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/+$/, '');
const arg = process.argv[2];

if (!token || !segredo || /^troque/i.test(token)) {
  console.error('Defina TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET no .env.');
  process.exit(1);
}
if (!arg) {
  console.error('Uso: node scripts/telegram-webhook.js https://SEU-ENDERECO.ngrok-free.dev  (ou --status / --remover)');
  process.exit(1);
}

async function chamar(metodo, corpo) {
  const r = await fetch(`${base}/bot${token}/${metodo}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}),
  });
  return r.json();
}

(async () => {
  if (arg === '--remover') {
    console.log(await chamar('deleteWebhook'));
  } else if (arg === '--status') {
    const r = await chamar('getWebhookInfo');
    const i = r.result || {};
    console.log({ ok: r.ok, url: i.url, mensagens_pendentes: i.pending_update_count, ultimo_erro: i.last_error_message || null });
  } else {
    if (!/^https:\/\/[^\s/]+$/.test(arg.replace(/\/+$/, ''))) {
      console.error('Informe só o endereço https do ngrok, sem caminho. Ex.: https://abcd.ngrok-free.dev');
      process.exit(1);
    }
    const url = `${arg.replace(/\/+$/, '')}/webhook/telegram`;
    const r = await chamar('setWebhook', { url, secret_token: segredo, allowed_updates: ['message'], drop_pending_updates: true });
    console.log(r.ok ? `Webhook registrado em ${url}` : r);
  }
})().catch((e) => { console.error('Falha:', e.message); process.exit(1); });
