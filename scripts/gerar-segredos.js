'use strict';

/**
 * Gera segredos aleatórios para o .env.
 *   node scripts/gerar-segredos.js           → apenas imprime os valores
 *   node scripts/gerar-segredos.js --gravar  → cria .env a partir do .env.example (não sobrescreve)
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const aleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const senhaBanco = aleatorio(18);

const valores = {
  POSTGRES_PASSWORD: senhaBanco,
  DATABASE_URL: `postgres://busucsal:${senhaBanco}@localhost:5432/busucsal`,
  DATABASE_URL_TEST: `postgres://busucsal:${senhaBanco}@localhost:5432/busucsal_test`,
  DEVICE_TOKEN: aleatorio(24),
  ADMIN_SESSION_SECRET: aleatorio(48),
  SESSION_HASH_SECRET: aleatorio(48),
};

if (!process.argv.includes('--gravar')) {
  for (const [k, v] of Object.entries(valores)) console.log(`${k}=${v}`);
  process.exit(0);
}

const destino = path.join(raiz, '.env');
if (fs.existsSync(destino)) {
  console.error('.env já existe — nada foi alterado. Apague-o ou edite manualmente.');
  process.exit(1);
}
let conteudo = fs.readFileSync(path.join(raiz, '.env.example'), 'utf8');
for (const [k, v] of Object.entries(valores)) {
  conteudo = conteudo.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
}
fs.writeFileSync(destino, conteudo, { mode: 0o600 });
console.log('.env criado com segredos aleatórios. Guarde o DEVICE_TOKEN para configurar o rastreador/simulador.');
