'use strict';

/**
 * Scripts do banco.
 *   node scripts/db.js setup   → schema.sql + seed-demo.sql
 *   node scripts/db.js schema  → apenas a estrutura
 *   node scripts/db.js seed    → apenas os dados demonstrativos
 *   node scripts/db.js reset   → remove as tabelas e recria estrutura + dados demonstrativos
 * Use --test para operar no banco de testes (DATABASE_URL_TEST).
 */
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
if (fs.existsSync(path.join(raiz, '.env'))) process.loadEnvFile(path.join(raiz, '.env'));

const comando = process.argv[2];
const teste = process.argv.includes('--test');
const url = teste ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
const arquivos = {
  schema: ['schema.sql'],
  seed: ['seed-demo.sql'],
  setup: ['schema.sql', 'seed-demo.sql'],
  reset: ['drop.sql', 'schema.sql', 'seed-demo.sql'],
};

async function executar() {
  if (!arquivos[comando]) {
    console.error('Uso: node scripts/db.js <setup|schema|seed|reset> [--test]');
    process.exit(2);
  }
  if (!url) {
    console.error(`${teste ? 'DATABASE_URL_TEST' : 'DATABASE_URL'} não definida no .env.`);
    process.exit(2);
  }
  // eslint-disable-next-line global-require
  const { Client } = require('pg');
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    for (const nome of arquivos[comando]) {
      process.stdout.write(`→ ${nome} … `);
      await cliente.query(fs.readFileSync(path.join(raiz, 'database', nome), 'utf8'));
      console.log('ok');
    }
    const { rows } = await cliente.query('SELECT postgis_lib_version() AS v');
    console.log(`Concluído (PostGIS ${rows[0].v}).`);
  } finally {
    await cliente.end();
  }
}

executar().catch((erro) => {
  console.error(`\nFalha: ${erro.message}`);
  if (/ECONNREFUSED/.test(erro.message)) console.error('O banco está rodando? Tente: docker compose up -d');
  process.exit(1);
});
