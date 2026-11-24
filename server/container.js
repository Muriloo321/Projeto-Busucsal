'use strict';

const { criarEstadoService } = require('./services/estado.service');
const { criarPosicaoService } = require('./services/posicao.service');
const { criarConversaService } = require('./services/conversa.service');
const { criarWhatsappService } = require('./services/whatsapp.service');
const { criarTelegramService } = require('./services/telegram.service');
const { criarAvisoService } = require('./services/aviso.service');
const { criarPontoService } = require('./services/ponto.service');
const { criarAuthService } = require('./services/auth.service');
const { criarMetricasService } = require('./services/metricas.service');
const { criarRegistroRequisicoes } = require('./services/registro-requisicoes.service');
const { criarSimuladorService } = require('./services/simulador.service');
const { criarCenariosService } = require('./services/cenarios.service');
const { criarTecnicoService } = require('./services/tecnico.service');

/**
 * Monta os serviços a partir dos repositórios (injeção de dependências).
 * Os testes usam a mesma função com repositórios de teste em memória.
 */
function criarServicos({ repos, config, logger, hasher, relogio = { agora: () => new Date() }, persistirMetricas = true, fetchImpl }) {
  const metricas = criarMetricasService({ arquivo: config.metricas.arquivo, logger, persistir: persistirMetricas });
  const registroRequisicoes = criarRegistroRequisicoes();
  const estado = criarEstadoService({ repos, config, relogio, logger });
  const posicao = criarPosicaoService({ repos, config, relogio, estadoService: estado, logger });
  const simulador = criarSimuladorService({ repos, config, logger, relogio, fetchImpl });
  const conversa = criarConversaService({ repos, config, relogio, estadoService: estado, metricas });
  return {
    repos,
    metricas,
    registroRequisicoes,
    estado,
    posicao,
    simulador,
    conversa,
    whatsapp: criarWhatsappService({ config, conversaService: conversa, logger, relogio, fetchImpl }),
    telegram: criarTelegramService({ config, conversaService: conversa, logger, relogio, fetchImpl }),
    avisos: criarAvisoService({ repos, relogio }),
    pontos: criarPontoService({ repos, config }),
    auth: criarAuthService({ repos, config, relogio, hasher }),
    cenarios: criarCenariosService({ repos, config, relogio, posicaoService: posicao, simulador }),
    tecnico: criarTecnicoService({ repos, config, relogio, metricas, registroRequisicoes, iniciadoEm: relogio.agora() }),
  };
}

module.exports = { criarServicos };
