'use strict';

/**
 * Configuração a partir de variáveis de ambiente (arquivo .env local; veja .env.example).
 * Segredos nunca têm valor padrão no código: o servidor não inicia sem eles.
 */

const PLACEHOLDER = /^(troque|change|exemplo|example)/i;

class ErroConfiguracao extends Error {}

function inteiro(env, nome, padrao, { min = -Infinity, max = Infinity } = {}) {
  const bruto = env[nome];
  if (bruto === undefined || bruto === '') return padrao;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ErroConfiguracao(`${nome} deve ser um número entre ${min} e ${max}.`);
  }
  return n;
}

function booleano(env, nome, padrao) {
  const bruto = env[nome];
  if (bruto === undefined || bruto === '') return padrao;
  return ['1', 'true', 'sim', 'yes'].includes(String(bruto).toLowerCase());
}

function carregarConfig(env = process.env, { exigirBanco = true } = {}) {
  const faltando = [];
  const segredo = (nome, minimo) => {
    const v = env[nome];
    if (!v) { faltando.push(nome); return undefined; }
    if (PLACEHOLDER.test(v)) throw new ErroConfiguracao(`${nome} ainda está com o valor de exemplo do .env.example. Gere um valor novo (npm run gerar-segredos).`);
    if (minimo && v.length < minimo) throw new ErroConfiguracao(`${nome} precisa ter pelo menos ${minimo} caracteres.`);
    return v;
  };

  const porta = inteiro(env, 'PORT', 3000, { min: 1, max: 65535 });
  const bancoUrl = env.DATABASE_URL;
  if (exigirBanco && !bancoUrl) faltando.push('DATABASE_URL');

  const dispositivos = String(env.TRACKER_DEVICE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (dispositivos.length === 0) faltando.push('TRACKER_DEVICE_IDS');

  const config = {
    ambiente: env.NODE_ENV || 'development',
    porta,
    host: env.HOST || '127.0.0.1',
    fuso: env.APP_TIMEZONE || 'America/Bahia',
    bancoUrl,
    rastreador: {
      token: segredo('DEVICE_TOKEN', 24),
      dispositivos,
      principal: dispositivos[0],
    },
    sessaoAdmin: {
      segredo: segredo('ADMIN_SESSION_SECRET', 32),
      validadeS: inteiro(env, 'ADMIN_SESSION_HOURS', 8, { min: 1, max: 72 }) * 3600,
      cookieSeguro: booleano(env, 'COOKIE_SECURE', env.NODE_ENV === 'production'),
      nomeCookie: 'busucsal_sessao',
      rodadasBcrypt: inteiro(env, 'BCRYPT_ROUNDS', 12, { min: 10, max: 15 }),
    },
    hashSessaoSegredo: segredo('SESSION_HASH_SECRET', 32),
    acessoInterno: {
      token: env.INTERNAL_API_TOKEN || null,
      permitirRedePrivada: booleano(env, 'INTERNAL_ALLOW_PRIVATE_NETWORK', false),
    },
    demo: {
      ativo: booleano(env, 'DEMO_MODE', false),
    },
    // Valores iniciais da Seção 4 do Planejamento Técnico; calibráveis após o teste de campo.
    regras: Object.freeze({
      limiteDadosVencidosS: inteiro(env, 'STALE_POSITION_SECONDS', 180, { min: 30, max: 3600 }),
      tempoParadoMin: inteiro(env, 'STOPPED_MINUTES', 5, { min: 1, max: 60 }),
      janelaVelocidadeMin: inteiro(env, 'SPEED_WINDOW_MINUTES', 5, { min: 1, max: 30 }),
      velocidadeMinimaKmh: inteiro(env, 'ETA_MIN_SPEED_KMH', 10, { min: 1, max: 60 }),
      limiarParadoKmh: inteiro(env, 'STOPPED_SPEED_KMH', 3, { min: 0, max: 15 }),
      raioChegadaM: inteiro(env, 'ARRIVAL_RADIUS_M', 50, { min: 5, max: 500 }),
      toleranciaRotaM: inteiro(env, 'ROUTE_MATCH_TOLERANCE_M', 150, { min: 10, max: 2000 }),
      toleranciaRetrocessoM: inteiro(env, 'ROUTE_BACKTRACK_TOLERANCE_M', 80, { min: 0, max: 1000 }),
      toleranciaPontoRotaM: inteiro(env, 'STOP_ROUTE_TOLERANCE_M', 100, { min: 5, max: 1000 }),
      limiteClassificacaoMs: inteiro(env, 'CLASSIFIER_TIMEOUT_MS', 2000, { min: 100, max: 10000 }),
      validadeSessaoH: inteiro(env, 'CHAT_SESSION_HOURS', 24, { min: 1, max: 24 }),
      limiteRespostaS: 5,
      velocidadeMaxKmh: inteiro(env, 'MAX_SPEED_KMH', 130, { min: 30, max: 200 }),
      futuroMaxS: 120,
      passadoMaxH: 72,
      intervaloMaxViagemMin: 10,
    }),
    metricas: {
      arquivo: env.METRICS_FILE || 'data/metricas.json',
    },
    simulador: {
      baseUrl: env.SIMULATOR_BASE_URL || `http://127.0.0.1:${porta}`,
      intervaloS: inteiro(env, 'SIMULATOR_INTERVAL_SECONDS', 30, { min: 5, max: 300 }),
      intervaloAceleradoS: 2,
    },
  };

  if (faltando.length > 0) {
    throw new ErroConfiguracao(`Variáveis de ambiente obrigatórias ausentes: ${faltando.join(', ')}. Copie .env.example para .env e preencha.`);
  }
  return config;
}

/** Parâmetros que podem ser exibidos publicamente (sem segredos). */
function parametrosPublicos(config) {
  const r = config.regras;
  return {
    limite_dados_vencidos_s: r.limiteDadosVencidosS,
    tempo_parado_min: r.tempoParadoMin,
    janela_velocidade_min: r.janelaVelocidadeMin,
    velocidade_minima_kmh: r.velocidadeMinimaKmh,
    limiar_parado_kmh: r.limiarParadoKmh,
    raio_chegada_m: r.raioChegadaM,
    limite_classificacao_ms: r.limiteClassificacaoMs,
    validade_sessao_h: r.validadeSessaoH,
  };
}

module.exports = { carregarConfig, parametrosPublicos, ErroConfiguracao };
