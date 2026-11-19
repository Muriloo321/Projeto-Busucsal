'use strict';

/**
 * Ponto de entrada: carrega o .env, conecta ao PostgreSQL + PostGIS e inicia o servidor HTTP.
 * Uso: npm start
 */
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
if (fs.existsSync(path.join(raiz, '.env'))) process.loadEnvFile(path.join(raiz, '.env'));

const { carregarConfig, ErroConfiguracao } = require('./config');
const { criarLogger } = require('./utils/logger');

const logger = criarLogger();

let config;
try {
  config = carregarConfig(process.env);
} catch (erro) {
  if (erro instanceof ErroConfiguracao) {
    logger.erro(`Configuração inválida: ${erro.message}`);
    process.exit(1);
  }
  throw erro;
}

/* eslint-disable global-require */
const express = require('express');
const bcrypt = require('bcryptjs');
const { criarPool } = require('./db/pool');
const { criarRepositorios } = require('./repositories');
const { criarServicos } = require('./container');
const { criarApp } = require('./app');
const { iniciarManutencao } = require('./jobs/manutencao');
/* eslint-enable global-require */

async function iniciar() {
  const pool = criarPool(config.bancoUrl, logger);
  const repos = criarRepositorios(pool);

  try {
    const info = await repos.inspetor.infoBanco();
    logger.info(`Banco conectado: PostgreSQL ${info.postgres} · PostGIS ${info.postgis} · ${info.banco}`);
  } catch (erro) {
    logger.aviso('Banco indisponível na inicialização; as rotas responderão 503 até a conexão voltar.', { mensagem: erro.message });
  }

  const metricasArquivo = path.isAbsolute(config.metricas.arquivo) ? config.metricas.arquivo : path.join(raiz, config.metricas.arquivo);
  const servicos = criarServicos({
    repos, config: { ...config, metricas: { arquivo: metricasArquivo } }, logger, hasher: bcrypt,
  });
  const app = criarApp({ express, servicos, config, logger });
  const pararManutencao = iniciarManutencao({ servicos, logger });

  const servidor = app.listen(config.porta, config.host, () => {
    logger.info(`BusUCSAL em http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.porta}`);
    logger.info(`Modo de demonstração: ${config.demo.ativo ? 'ATIVO' : 'desativado'}`);
  });

  const encerrar = (sinal) => {
    logger.info(`Encerrando (${sinal})…`);
    pararManutencao();
    servicos.simulador.parar();
    servidor.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));
}

iniciar().catch((erro) => {
  logger.erro('Falha ao iniciar o servidor', { mensagem: erro.message });
  process.exit(1);
});
