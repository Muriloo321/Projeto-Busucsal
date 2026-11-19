'use strict';

const crypto = require('node:crypto');
const { carregarConfig } = require('../../server/config');
const { criarReposMemoria } = require('./memoria');
const { criarServicos } = require('../../server/container');

/** Trajeto e pontos demonstrativos (os mesmos de database/seed-demo.sql). */
const ROTA_DEMO = {
  id: 1,
  nome: 'Rota demonstrativa',
  sentido: 'ida',
  horario_inicio: '06:30',
  horario_fim: '22:40',
  turno: 'M/N',
  demonstrativa: true,
  coordenadas: [[-38.4192, -12.9694], [-38.4148, -12.9598], [-38.4139, -12.9495], [-38.4125, -12.9478]],
};

const PONTOS_DEMO = [
  { nome: 'Estação Pituaçu', referencia: 'Saída do metrô (demonstrativo)', latitude: -12.9694, longitude: -38.4192, ordem_na_rota: 1, sentido: 'ida', demonstrativo: true },
  { nome: 'Av. Pinto de Aguiar', referencia: 'Passarela (demonstrativo)', latitude: -12.9598, longitude: -38.4148, ordem_na_rota: 2, sentido: 'ida', demonstrativo: true },
  { nome: 'Portaria Principal UCSAL', referencia: 'Guarita principal (demonstrativo)', latitude: -12.9495, longitude: -38.4139, ordem_na_rota: 3, sentido: 'ida', demonstrativo: true },
  { nome: 'Bloco B / Biblioteca', referencia: 'Estacionamento interno (demonstrativo)', latitude: -12.9478, longitude: -38.4125, ordem_na_rota: 4, sentido: 'ida', demonstrativo: true },
];

const ENV_TESTE = {
  TRACKER_DEVICE_IDS: 'busucsal-01,reserva-02',
  DEVICE_TOKEN: 'token-de-teste-do-dispositivo-0123456789',
  ADMIN_SESSION_SECRET: 'segredo-de-sessao-admin-para-testes-0123456789',
  SESSION_HASH_SECRET: 'segredo-de-hash-de-sessao-para-testes-0123456789',
  INTERNAL_API_TOKEN: 'token-interno-de-teste',
  DEMO_MODE: 'true',
  BCRYPT_ROUNDS: '10',
};

/** 10:00 em Salvador (UTC−3), dentro da grade demonstrativa. */
const INSTANTE_PADRAO = new Date('2026-11-18T13:00:00Z');

function criarRelogio(inicio = INSTANTE_PADRAO) {
  let atual = new Date(inicio).getTime();
  return {
    agora: () => new Date(atual),
    avancar(ms) { atual += ms; },
    definir(data) { atual = new Date(data).getTime(); },
  };
}

/** Hasher de teste com a mesma interface do bcryptjs (hash/compare), rápido e determinístico. */
const hasherTeste = {
  async hash(senha, rodadas) {
    const corpo = crypto.createHash('sha256').update(String(senha)).digest('base64').replace(/[^A-Za-z0-9]/g, '').padEnd(53, 'x').slice(0, 53);
    return `$2a$${String(rodadas).padStart(2, '0')}$${corpo}`;
  },
  async compare(senha, hash) {
    const rodadas = Number(String(hash).split('$')[2]);
    return (await hasherTeste.hash(senha, rodadas)) === hash;
  },
};

const silencioso = { info() {}, aviso() {}, erro() {} };

function criarContexto({ env = {}, instante = INSTANTE_PADRAO, rotas = [ROTA_DEMO], pontos = PONTOS_DEMO, fetchImpl } = {}) {
  const config = carregarConfig({ ...ENV_TESTE, ...env }, { exigirBanco: false });
  const relogio = criarRelogio(instante);
  const repos = criarReposMemoria({ relogio, rotas, pontos });
  const servicos = criarServicos({ repos, config, logger: silencioso, hasher: hasherTeste, relogio, persistirMetricas: false, fetchImpl });
  return { config, relogio, repos, servicos };
}

/** Grava posições pelo serviço real, a cada `passoS`, terminando em `fim`, com progresso de `deM` a `ateM`. */
async function gravarTrajeto(ctx, { deM, ateM, quantidade = 9, passoS = 30, fim = ctx.relogio.agora(), velocidadeKmh, fonte = 'rastreador', rotaId = 1, dispositivo }) {
  const duracaoS = (quantidade - 1) * passoS;
  const vel = velocidadeKmh ?? (duracaoS > 0 ? ((ateM - deM) / duracaoS) * 3.6 : 0);
  const resultados = [];
  for (let i = 0; i < quantidade; i += 1) {
    const f = quantidade === 1 ? 1 : i / (quantidade - 1);
    const c = await ctx.repos.rota.coordenadaNaDistancia(rotaId, deM + (ateM - deM) * f);
    resultados.push(await ctx.servicos.posicao.registrarValidada({
      formato: 'teste',
      dispositivo_id: dispositivo || ctx.config.rastreador.principal,
      latitude: c.latitude,
      longitude: c.longitude,
      velocidade_kmh: vel,
      registrado_em: new Date(fim.getTime() - (quantidade - 1 - i) * passoS * 1000),
      precisao_m: 5,
      fonte,
    }));
  }
  return resultados;
}

module.exports = {
  ROTA_DEMO, PONTOS_DEMO, ENV_TESTE, INSTANTE_PADRAO, criarRelogio, hasherTeste, silencioso, criarContexto, gravarTrajeto,
};
