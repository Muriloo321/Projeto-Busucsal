'use strict';

/**
 * Cria (ou redefine a senha de) um usuário da equipe BusUCSAL.
 *   npm run admin:criar
 * Não interativo: ADMIN_NOME, ADMIN_EMAIL e ADMIN_SENHA no ambiente.
 * A senha nunca é gravada em arquivo: apenas o hash bcrypt vai para usuario_admin.
 */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const raiz = path.join(__dirname, '..');
if (fs.existsSync(path.join(raiz, '.env'))) process.loadEnvFile(path.join(raiz, '.env'));

function perguntar(rl, texto, { oculto = false } = {}) {
  return new Promise((resolve) => {
    rl.silenciar = false;
    rl.question(texto, (resposta) => { rl.silenciar = false; process.stdout.write(oculto ? '\n' : ''); resolve(resposta.trim()); });
    rl.silenciar = oculto;
  });
}

async function dadosInterativos() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // eslint-disable-next-line no-underscore-dangle
  rl._writeToOutput = (s) => { if (!rl.silenciar) rl.output.write(s); };
  try {
    const nome = await perguntar(rl, 'Nome: ');
    const email = (await perguntar(rl, 'E-mail: ')).toLowerCase();
    const senha = await perguntar(rl, 'Senha (mín. 10 caracteres): ', { oculto: true });
    const confirmacao = await perguntar(rl, 'Confirme a senha: ', { oculto: true });
    if (senha !== confirmacao) throw new Error('As senhas não conferem.');
    return { nome, email, senha };
  } finally {
    rl.close();
  }
}

async function principal() {
  const dados = process.env.ADMIN_EMAIL && process.env.ADMIN_SENHA
    ? { nome: process.env.ADMIN_NOME || 'Equipe BusUCSAL', email: process.env.ADMIN_EMAIL.toLowerCase(), senha: process.env.ADMIN_SENHA }
    : await dadosInterativos();

  if (!dados.nome || dados.nome.length < 2) throw new Error('Informe o nome.');
  if (!/^[^\s@]+@[^\s@]+$/.test(dados.email)) throw new Error('E-mail inválido.');
  if (dados.senha.length < 10) throw new Error('A senha precisa ter pelo menos 10 caracteres.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida no .env.');

  /* eslint-disable global-require */
  const bcrypt = require('bcryptjs');
  const { Client } = require('pg');
  /* eslint-enable global-require */
  const rodadas = Number(process.env.BCRYPT_ROUNDS || 12);
  const senhaHash = await bcrypt.hash(dados.senha, rodadas);

  const cliente = new Client({ connectionString: process.env.DATABASE_URL });
  await cliente.connect();
  try {
    const { rows } = await cliente.query(
      `INSERT INTO usuario_admin (nome, email, senha_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, ativo = TRUE
       RETURNING id, email`,
      [dados.nome, dados.email, senhaHash],
    );
    console.log(`Usuário pronto: ${rows[0].email} (id ${rows[0].id}). Acesse /admin para entrar.`);
  } finally {
    await cliente.end();
  }
}

principal().catch((erro) => {
  console.error(`Não foi possível criar o usuário: ${erro.message}`);
  process.exit(1);
});
