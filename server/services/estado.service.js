'use strict';

const { calcularStatus, avisoVigente } = require('../domain/status');
const { mediaVelocidade, calcularPrevisao } = require('../domain/previsao');
const { descreverLocalizacao } = require('../domain/localizacao');
const { formatarHora } = require('../domain/tempo');
const { parametrosPublicos } = require('../config');

/**
 * Monta o estado consolidado do serviço (GET /api/estado e assistente).
 * É a única origem dos números exibidos: status, previsões, horários e localização.
 */
function criarEstadoService({ repos, config, relogio, logger }) {
  const { regras, fuso } = config;

  function avisoPublico(a) {
    return { id: a.id, texto: a.texto, inicio: a.inicio, fim: a.fim, interrompe_operacao: a.interrompe_operacao, demonstrativo: a.demonstrativo };
  }

  async function montar(dispositivoId = config.rastreador.principal) {
    const agora = relogio.agora();
    const [bruto, rotas, avisosVigentes, pontosAtivos] = await Promise.all([
      repos.estado.obter(dispositivoId),
      repos.rota.listarAtivas(),
      repos.aviso.listarVigentes(agora),
      repos.ponto.listar({ incluirInativos: false }),
    ]);
    // Defesa extra: a vigência é conferida também aqui.
    const avisos = avisosVigentes.filter((a) => avisoVigente(a, agora));

    const ultimaAtualizacao = bruto && bruto.ultima_atualizacao ? new Date(bruto.ultima_atualizacao) : null;
    const status = calcularStatus({
      agora, rotas, avisos, ultimaAtualizacao, paradoDesde: bruto ? bruto.parado_desde : null, parametros: regras, fuso,
    });
    const idadeS = ultimaAtualizacao ? Math.max(0, Math.round((agora - ultimaAtualizacao) / 1000)) : null;

    const recentes = ultimaAtualizacao
      ? await repos.posicao.recentes(dispositivoId, new Date(agora.getTime() - regras.janelaVelocidadeMin * 60000))
      : [];
    const velocidade = mediaVelocidade(recentes, agora, regras.janelaVelocidadeMin);

    const rotaAtual = bruto && bruto.rota_id ? rotas.find((r) => r.id === bruto.rota_id) || null : null;
    const progressoOnibus = rotaAtual && Number.isFinite(Number(bruto.progresso_m)) ? Number(bruto.progresso_m) : null;
    const temCoordenada = bruto && Number.isFinite(Number(bruto.latitude));

    const naRota = rotaAtual
      ? await repos.rota.pontosComProgresso(rotaAtual.id, temCoordenada ? { latitude: bruto.latitude, longitude: bruto.longitude } : null)
      : [];
    const porId = new Map(naRota.map((p) => [p.id, p]));

    const pontos = pontosAtivos.map((p) => {
      const geo = porId.get(p.id);
      const sobreTrajeto = geo && geo.distancia_trajeto_m <= regras.toleranciaPontoRotaM;
      const progressoPonto = sobreTrajeto ? geo.progresso_m : null;
      const previsao = calcularPrevisao({
        statusCodigo: status.codigo,
        idadeDadosS: idadeS,
        progressoOnibusM: progressoOnibus,
        progressoPontoM: progressoPonto,
        mesmoSentido: Boolean(rotaAtual && p.sentido === rotaAtual.sentido),
        velocidadeMediaKmh: velocidade.media_kmh,
        parametros: regras,
      });
      return {
        id: p.id,
        nome: p.nome,
        referencia: p.referencia,
        ordem_na_rota: p.ordem_na_rota,
        sentido: p.sentido,
        turnos: p.turnos,
        latitude: p.latitude,
        longitude: p.longitude,
        demonstrativo: p.demonstrativo,
        progresso_m: progressoPonto === null ? null : Math.round(progressoPonto),
        distancia_trajeto_m: geo ? Math.round(geo.distancia_trajeto_m) : null,
        distancia_reta_m: geo && geo.distancia_reta_m !== null ? Math.round(geo.distancia_reta_m) : null,
        previsao,
      };
    });

    const pontosDaRota = pontos.filter((p) => p.progresso_m !== null);
    const localizacao = descreverLocalizacao(progressoOnibus, pontosDaRota, regras.raioChegadaM);

    const grade = [];
    const vistos = new Set();
    for (const r of rotas) {
      const horario = `${r.horario_inicio}–${r.horario_fim}`;
      if (!vistos.has(horario)) { vistos.add(horario); grade.push({ turno: r.turno, horario }); }
    }

    const resultado = {
      gerado_em: agora.toISOString(),
      fuso,
      status,
      veiculo: {
        dispositivo_id: dispositivoId,
        ultima_atualizacao: ultimaAtualizacao ? ultimaAtualizacao.toISOString() : null,
        ultima_atualizacao_local: ultimaAtualizacao ? formatarHora(ultimaAtualizacao, fuso) : null,
        idade_s: idadeS,
        latitude: temCoordenada ? bruto.latitude : null,
        longitude: temCoordenada ? bruto.longitude : null,
        velocidade_kmh: bruto ? bruto.velocidade_kmh : null,
        velocidade_media_kmh: velocidade.media_kmh,
        amostras_velocidade: velocidade.amostras,
        fora_do_trajeto: Boolean(bruto && ultimaAtualizacao && !rotaAtual),
        distancia_rota_m: bruto && bruto.distancia_rota_m !== null ? Math.round(bruto.distancia_rota_m) : null,
      },
      rota: rotaAtual ? {
        id: rotaAtual.id,
        nome: rotaAtual.nome,
        sentido: rotaAtual.sentido,
        turno: rotaAtual.turno,
        horario: `${rotaAtual.horario_inicio}–${rotaAtual.horario_fim}`,
        extensao_m: Math.round(rotaAtual.extensao_m),
        progresso_m: progressoOnibus === null ? null : Math.round(progressoOnibus),
        demonstrativa: rotaAtual.demonstrativa,
      } : null,
      localizacao,
      pontos,
      avisos: avisos.map(avisoPublico),
      grade,
      parametros: parametrosPublicos(config),
      dados_demonstrativos: rotas.some((r) => r.demonstrativa) || pontosAtivos.some((p) => p.demonstrativo),
    };

    if (bruto) {
      const proximoId = localizacao.proximo_ponto ? localizacao.proximo_ponto.id : null;
      const desatualizado = !bruto.status_calculado_em || agora - new Date(bruto.status_calculado_em) > 60000;
      if (bruto.status !== status.codigo || bruto.proximo_ponto_id !== proximoId || desatualizado) {
        try {
          await repos.estado.salvarStatus(dispositivoId, { status: status.codigo, calculadoEm: agora, proximoPontoId: proximoId });
        } catch (erro) {
          logger.aviso('Não foi possível gravar o status calculado', { mensagem: erro.message });
        }
      }
    }
    return resultado;
  }

  return { montar };
}

module.exports = { criarEstadoService };
