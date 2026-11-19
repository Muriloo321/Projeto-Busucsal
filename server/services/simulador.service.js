'use strict';

const { ValidationError, UnprocessableError } = require('../utils/errors');

/**
 * Simulador GPS integrado (somente com DEMO_MODE=true), controlado pela página técnica.
 * Ele se comporta como um rastreador externo: envia cada posição por HTTP para POST /api/posicao,
 * com o token do dispositivo, exatamente como o simulador em Python e o Traccar Client.
 *
 *  - tempo_real: um envio a cada 30 s; cada passo avança 30 s de deslocamento (fonte "simulador").
 *  - acelerado: um envio a cada 2 s, mas cada passo ainda avança 30 s de deslocamento (≈15×).
 *    Serve apenas para apresentações e é gravado como "simulador_acelerado", fora das métricas.
 */
const MODOS = ['tempo_real', 'acelerado'];
const PASSO_S = 30;

function criarSimuladorService({ repos, config, logger, relogio, fetchImpl = globalThis.fetch }) {
  const s = {
    ativo: false, modo: null, intervalo_s: null, velocidade_kmh: 18, rota_id: null, rota_nome: null,
    progresso_m: 0, extensao_m: null, sinal: true, parado: false, envios: 0, falhas: 0, voltas: 0,
    iniciado_em: null, ultimo_envio: null,
  };
  let temporizador = null;
  let emAndamento = false;

  async function escolherRota() {
    const rotas = await repos.rota.listarAtivas();
    const rota = rotas.find((r) => r.sentido === 'ida') || rotas[0];
    if (!rota) throw new UnprocessableError('Não há rota ativa cadastrada para simular.');
    return rota;
  }

  async function passo() {
    if (!s.ativo || emAndamento) return;
    emAndamento = true;
    const em = relogio.agora();
    try {
      if (!s.parado) {
        s.progresso_m += (s.velocidade_kmh / 3.6) * PASSO_S;
        if (s.progresso_m >= s.extensao_m) { s.progresso_m = 0; s.voltas += 1; }
      }
      if (!s.sinal) {
        s.ultimo_envio = { em: em.toISOString(), status: 'sem_sinal' };
        return;
      }
      const coord = await repos.rota.coordenadaNaDistancia(s.rota_id, s.progresso_m);
      // Pequena variação da velocidade para não gerar dados artificialmente perfeitos.
      const velocidade = s.parado ? 0 : Math.round(s.velocidade_kmh * (0.85 + Math.random() * 0.3) * 10) / 10;
      const corpo = {
        dispositivo_id: config.rastreador.principal,
        latitude: Math.round(coord.latitude * 1e6) / 1e6,
        longitude: Math.round(coord.longitude * 1e6) / 1e6,
        velocidade_kmh: velocidade,
        registrado_em: em.toISOString(),
        precisao_m: 8,
        fonte: s.modo === 'acelerado' ? 'simulador_acelerado' : 'simulador',
      };
      const resposta = await fetchImpl(`${config.simulador.baseUrl}/api/posicao`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-token': config.rastreador.token },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(5000),
      });
      s.envios += 1;
      if (!resposta.ok) s.falhas += 1;
      s.ultimo_envio = {
        em: corpo.registrado_em, status: resposta.status, latitude: corpo.latitude, longitude: corpo.longitude, velocidade_kmh: velocidade,
      };
    } catch (erro) {
      s.falhas += 1;
      s.ultimo_envio = { em: em.toISOString(), status: 'erro', erro: erro.message };
      logger.aviso('Simulador: falha ao enviar posição', { mensagem: erro.message });
    } finally {
      emAndamento = false;
    }
  }

  function validarVelocidade(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 5 || n > 60) {
      throw new ValidationError('Velocidade inválida.', [{ campo: 'velocidade_kmh', mensagem: 'Use um valor entre 5 e 60 km/h.' }]);
    }
    return Math.round(n);
  }

  const api = {
    async iniciar({ modo = 'tempo_real', velocidade_kmh: velocidade } = {}) {
      if (!MODOS.includes(modo)) throw new ValidationError('Modo inválido.', [{ campo: 'modo', mensagem: `Use: ${MODOS.join(' ou ')}.` }]);
      if (velocidade !== undefined) s.velocidade_kmh = validarVelocidade(velocidade);
      const rota = await escolherRota();
      api.parar();
      if (s.rota_id !== rota.id) s.progresso_m = 0;
      Object.assign(s, {
        ativo: true, modo, rota_id: rota.id, rota_nome: rota.nome, extensao_m: rota.extensao_m,
        intervalo_s: modo === 'acelerado' ? config.simulador.intervaloAceleradoS : config.simulador.intervaloS,
        iniciado_em: relogio.agora().toISOString(), sinal: true, parado: false,
      });
      temporizador = setInterval(passo, s.intervalo_s * 1000);
      temporizador.unref?.();
      await passo();
      return api.situacao();
    },

    parar() {
      if (temporizador) clearInterval(temporizador);
      temporizador = null;
      s.ativo = false;
      return api.situacao();
    },

    definirSinal(ativo) {
      if (typeof ativo !== 'boolean') throw new ValidationError('Informe ativo: true ou false.');
      s.sinal = ativo;
      return api.situacao();
    },

    definirParado(ativo) {
      if (typeof ativo !== 'boolean') throw new ValidationError('Informe ativo: true ou false.');
      s.parado = ativo;
      return api.situacao();
    },

    definirVelocidade(v) {
      s.velocidade_kmh = validarVelocidade(v);
      return api.situacao();
    },

    reiniciarPercurso() {
      s.progresso_m = 0;
      s.voltas = 0;
      return api.situacao();
    },

    situacao: () => ({ ...s, progresso_m: Math.round(s.progresso_m), extensao_m: s.extensao_m === null ? null : Math.round(s.extensao_m) }),
  };
  return api;
}

module.exports = { criarSimuladorService, MODOS };
