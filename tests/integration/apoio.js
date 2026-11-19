'use strict';

/**
 * Apoio aos testes de integração (PostgreSQL + PostGIS reais e Express real).
 * Requisitos: npm install, banco de teste rodando (docker compose up -d) e DATABASE_URL_TEST no .env.
 * O banco de teste é APAGADO e recriado a cada execução.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
if (fs.existsSync(path.join(RAIZ, '.env'))) process.loadEnvFile(path.join(RAIZ, '.env'));

const { ENV_TESTE, silencioso } = require('../helpers/contexto');

function motivoParaPular() {
  for (const modulo of ['express', 'pg', 'bcryptjs']) {
    try { require.resolve(modulo); } catch { return `dependência "${modulo}" não instalada — rode npm install`; }
  }
  if (!process.env.DATABASE_URL_TEST) return 'DATABASE_URL_TEST não definida no .env';
  return false;
}

async function prepararBanco() {
  /* eslint-disable global-require */
  const { Client } = require('pg');
  const cliente = new Client({ connectionString: process.env.DATABASE_URL_TEST });
  try {
    await cliente.connect();
  } catch (erro) {
    throw new Error(`Banco de teste inacessível (${erro.message}). Suba o banco com "docker compose up -d".`);
  }
  for (const arquivo of ['drop.sql', 'schema.sql', 'seed-demo.sql']) {
    await cliente.query(fs.readFileSync(path.join(RAIZ, 'database', arquivo), 'utf8'));
  }
  // Grade ampla para os testes não dependerem do horário em que rodam.
  await cliente.query("UPDATE rota SET horario_inicio = '00:00', horario_fim = '23:59:59'");
  return cliente;
}

async function iniciarApp({ bancoUrl = process.env.DATABASE_URL_TEST } = {}) {
  const express = require('express');
  const bcrypt = require('bcryptjs');
  const { carregarConfig } = require('../../server/config');
  const { criarPool } = require('../../server/db/pool');
  const { criarRepositorios } = require('../../server/repositories');
  const { criarServicos } = require('../../server/container');
  const { criarApp } = require('../../server/app');
  /* eslint-enable global-require */

  const config = carregarConfig({ ...ENV_TESTE, DATABASE_URL: bancoUrl, DEMO_MODE: 'true' });
  const pool = criarPool(bancoUrl, silencioso);
  const repos = criarRepositorios(pool);
  const servicos = criarServicos({ repos, config, logger: silencioso, hasher: bcrypt, persistirMetricas: false });
  const app = criarApp({ express, servicos, config, logger: silencioso });
  const servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  async function http(metodo, caminho, { corpo, cabecalhos = {}, cookie } = {}) {
    const opcoes = { method: metodo, headers: { ...cabecalhos } };
    if (corpo !== undefined) {
      opcoes.headers['content-type'] = 'application/json';
      opcoes.body = JSON.stringify(corpo);
    }
    if (cookie) opcoes.headers.cookie = cookie;
    const r = await fetch(`${base}${caminho}`, opcoes);
    const tipo = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, corpo: tipo.includes('json') ? await r.json() : await r.text() };
  }

  async function fechar() {
    servicos.simulador.parar();
    await new Promise((resolve) => servidor.close(resolve));
    await pool.end();
  }

  return { base, http, config, pool, repos, servicos, bcrypt, fechar };
}

module.exports = { motivoParaPular, prepararBanco, iniciarApp };
