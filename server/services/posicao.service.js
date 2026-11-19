'use strict';

const { normalizarPayloadPosicao } = require('../domain/traccar');
const { validarPosicao } = require('../domain/validacao');
const { escolherRota } = require('../domain/rota-sentido');
const { rotasNaGrade, proximoParadoDesde } = require('../domain/status');
const { ValidationError, ForbiddenError } = require('../utils/errors');

/**
 * Recebimento de posições (POST /api/posicao).
 * Histórico (posicao_veiculo) e estado consolidado (estado_veiculo) são gravados na mesma transação.
 */
function criarPosicaoService({ repos, config, relogio, estadoService, logger }) {
  const { regras, fuso } = config;

  function validar({ body, query }) {
    const normalizada = normalizarPayloadPosicao({ body, query });
    const v = validarPosicao(normalizada, {
      agora: relogio.agora(),
      velocidadeMaxKmh: regras.velocidadeMaxKmh,
      futuroMaxS: regras.futuroMaxS,
      passadoMaxH: regras.passadoMaxH,
    });
    if (!v.valido) throw new ValidationError('Posição inválida.', v.erros);
    if (!config.rastreador.dispositivos.includes(v.valor.dispositivo_id)) {
      throw new ForbiddenError('Dispositivo não autorizado.', 'dispositivo_nao_autorizado');
    }
    return v.valor;
  }

  /** Grava uma posição já validada. `fonte` pode ser forçada pelos cenários de demonstração. */
  async function registrarValidada(pos) {
    const resultado = await repos.transacao(async (cliente) => {
      const estado = await repos.estado.travar(cliente, pos.dispositivo_id);
      const [candidatos, rotas] = await Promise.all([
        repos.rota.candidatosParaPosicao({ longitude: pos.longitude, latitude: pos.latitude, toleranciaM: regras.toleranciaRotaM }, cliente),
        repos.rota.listarAtivas(cliente),
      ]);
      const ultima = estado.ultima_atualizacao ? new Date(estado.ultima_atualizacao) : null;
      const maisRecente = !ultima || pos.registrado_em.getTime() >= ultima.getTime();
      const idsNaGrade = new Set(rotasNaGrade(rotas, pos.registrado_em, fuso).map((r) => r.id));
      const anterior = maisRecente && estado.rota_id ? { rota_id: estado.rota_id, progresso_m: estado.progresso_m } : null;
      const { candidato, nova_viagem: novaViagem } = escolherRota({ candidatos, anterior, idsNaGrade, parametros: regras });

      const registro = {
        ...pos,
        rota_id: candidato ? candidato.rota_id : null,
        progresso_m: candidato ? candidato.progresso_m : null,
        distancia_rota_m: candidato ? candidato.distancia_m : null,
      };
      const posicaoId = await repos.posicao.inserir(registro, cliente);
      if (posicaoId === null) {
        return { duplicada: true, atualizou_estado: false };
      }

      if (maisRecente) {
        await repos.estado.atualizarPosicao(cliente, pos.dispositivo_id, {
          ultima_posicao_id: posicaoId,
          longitude: pos.longitude,
          latitude: pos.latitude,
          ultima_atualizacao: pos.registrado_em,
          velocidade_kmh: pos.velocidade_kmh,
          rota_id: registro.rota_id,
          progresso_m: registro.progresso_m,
          distancia_rota_m: registro.distancia_rota_m,
          parado_desde: proximoParadoDesde(estado.parado_desde, pos.velocidade_kmh, pos.registrado_em, regras.limiarParadoKmh),
        });
      }
      return {
        duplicada: false,
        posicao_id: posicaoId,
        atualizou_estado: maisRecente,
        rota_id: registro.rota_id,
        sentido: candidato ? candidato.sentido : null,
        progresso_m: registro.progresso_m === null ? null : Math.round(registro.progresso_m),
        fora_do_trajeto: !candidato,
        nova_viagem: Boolean(candidato && novaViagem),
      };
    });

    if (resultado.atualizou_estado && pos.dispositivo_id === config.rastreador.principal) {
      // Recalcula e persiste o status após o commit (não bloqueia a resposta em caso de falha).
      estadoService.montar(pos.dispositivo_id).catch((erro) => logger.aviso('Falha ao recalcular status', { mensagem: erro.message }));
    }
    return resultado;
  }

  async function registrar({ body, query }) {
    return registrarValidada(validar({ body, query }));
  }

  return { validar, registrar, registrarValidada };
}

module.exports = { criarPosicaoService };
