'use strict';

const { NotFoundError, UnprocessableError } = require('../utils/errors');
const { rotasNaGrade } = require('../domain/status');

/**
 * Cenários de demonstração (somente com DEMO_MODE=true).
 * Cada cenário apaga apenas dados não reais (simulador/cenários e avisos demonstrativos) e grava
 * uma sequência de posições pelo MESMO serviço usado por POST /api/posicao. O status e as previsões
 * resultantes são calculados pelas regras normais — nada é definido manualmente.
 */
const CENARIOS = Object.freeze({
  a_caminho: {
    titulo: 'Ônibus a caminho',
    descricao: 'Ônibus em movimento antes do 2º ponto. O estudante pergunta e escolhe o ponto 2.',
    publico: true,
  },
  ja_passou: {
    titulo: 'Ônibus já passou pelo ponto',
    descricao: 'Ônibus depois do 2º ponto. O assistente informa que ele já passou naquele sentido.',
    publico: true,
  },
  sem_sinal: {
    titulo: 'Sem sinal do rastreador',
    descricao: 'Última posição recebida há 5 min. O sistema não calcula previsão com dado vencido.',
    publico: true,
  },
  aviso_equipe: {
    titulo: 'Aviso da equipe',
    descricao: 'A equipe publica um aviso de atraso, que aparece junto da previsão.',
    publico: true,
  },
  resposta_lenta: {
    titulo: 'Assistente demorou a entender',
    descricao: 'A classificação passa de 2 s e o assistente mostra o menu numerado.',
    publico: true,
  },
  parado: {
    titulo: 'Veículo parado',
    descricao: 'Rastreador continua enviando, mas a velocidade fica perto de zero por mais de 5 min.',
    publico: false,
  },
  interrupcao: {
    titulo: 'Interrupção da operação',
    descricao: 'Aviso de interrupção ativo: o status passa a "Fora de operação".',
    publico: false,
  },
  restaurar: {
    titulo: 'Limpar demonstração',
    descricao: 'Remove posições simuladas e avisos demonstrativos e para o simulador.',
    publico: false,
  },
});

function criarCenariosService({ repos, config, relogio, posicaoService, simulador }) {
  const dispositivo = () => config.rastreador.principal;

  async function limpar() {
    simulador.parar();
    await repos.transacao(async (cliente) => {
      await repos.posicao.excluirNaoReais(dispositivo(), cliente);
      await repos.aviso.excluirDemonstrativos(cliente);
      const ultimaReal = await repos.posicao.ultimaReal(dispositivo(), cliente);
      await repos.estado.redefinir(cliente, dispositivo(), ultimaReal);
    });
  }

  async function contexto() {
    const rotas = await repos.rota.listarAtivas();
    const rota = rotas.find((r) => r.sentido === 'ida') || rotas[0];
    if (!rota) throw new UnprocessableError('Não há rota ativa cadastrada.');
    const naRota = await repos.rota.pontosComProgresso(rota.id);
    const pontos = naRota
      .filter((p) => p.distancia_trajeto_m <= config.regras.toleranciaPontoRotaM)
      .sort((a, b) => a.progresso_m - b.progresso_m);
    if (pontos.length === 0) throw new UnprocessableError('Cadastre pontos de embarque sobre o trajeto para usar os cenários.');
    return { rotas, rota, pontos };
  }

  /** Grava `quantidade` posições a cada 30 s, terminando em `fimEm`, indo de `inicioM` a `fimM`. */
  async function gravarSequencia({ rota, inicioM, fimM, fimEm, quantidade, velocidadeFixa }) {
    const duracaoS = (quantidade - 1) * 30;
    const velocidadeMedia = duracaoS > 0 ? ((fimM - inicioM) / duracaoS) * 3.6 : 0;
    for (let i = 0; i < quantidade; i += 1) {
      const fracao = quantidade === 1 ? 1 : i / (quantidade - 1);
      const metros = inicioM + (fimM - inicioM) * fracao;
      const coord = await repos.rota.coordenadaNaDistancia(rota.id, metros);
      const variacao = velocidadeFixa !== undefined ? velocidadeFixa : Math.max(0, velocidadeMedia + (i % 2 === 0 ? 0.6 : -0.6));
      await posicaoService.registrarValidada({
        formato: 'cenario',
        dispositivo_id: dispositivo(),
        latitude: Math.round(coord.latitude * 1e6) / 1e6,
        longitude: Math.round(coord.longitude * 1e6) / 1e6,
        velocidade_kmh: Math.round(variacao * 10) / 10,
        registrado_em: new Date(fimEm.getTime() - (quantidade - 1 - i) * 30000),
        precisao_m: 6,
        fonte: 'cenario_demo',
      });
    }
  }

  async function aviso(texto, interrompe) {
    const agora = relogio.agora();
    return repos.aviso.criar({
      texto, inicio: new Date(agora.getTime() - 60000), fim: new Date(agora.getTime() + 2 * 3600 * 1000),
      ativo: true, interrompe_operacao: interrompe, demonstrativo: true, criado_por: null,
    });
  }

  return {
    listar: () => Object.entries(CENARIOS).map(([id, c]) => ({ id, ...c })),

    async aplicar(id) {
      const cenario = CENARIOS[id];
      if (!cenario) throw new NotFoundError('Cenário não encontrado.');
      await limpar();
      if (id === 'restaurar') return { cenario: id, titulo: cenario.titulo, conversa: [] };

      const { rotas, rota, pontos } = await contexto();
      const agora = relogio.agora();
      const alvo = pontos[Math.min(1, pontos.length - 1)];
      const numeroAlvo = (await repos.ponto.listar())
        .sort((a, b) => a.sentido.localeCompare(b.sentido) || a.ordem_na_rota - b.ordem_na_rota)
        .findIndex((p) => p.id === alvo.id) + 1;
      const raio = config.regras.raioChegadaM;
      const antesDoAlvo = Math.max(raio * 2, alvo.progresso_m - 700);
      const emMovimento = { rota, inicioM: Math.max(0, antesDoAlvo - 700), fimM: antesDoAlvo, fimEm: agora, quantidade: 9 };
      let conversa = [];
      let avisoCriado = null;

      switch (id) {
        case 'a_caminho':
          await gravarSequencia(emMovimento);
          conversa = [{ texto: 'oi, cadê o bus?' }, { texto: String(numeroAlvo) }];
          break;
        case 'ja_passou': {
          const seguinte = pontos.find((p) => p.progresso_m > alvo.progresso_m + raio * 3);
          const depois = seguinte ? (alvo.progresso_m + seguinte.progresso_m) / 2 : alvo.progresso_m + raio * 4;
          await gravarSequencia({ ...emMovimento, inicioM: Math.max(0, depois - 700), fimM: depois });
          conversa = [{ texto: `Quanto tempo falta pro ponto ${numeroAlvo}?` }];
          break;
        }
        case 'sem_sinal':
          await gravarSequencia({ ...emMovimento, fimEm: new Date(agora.getTime() - 5 * 60000) });
          conversa = [{ texto: 'oi, cadê o bus?' }];
          break;
        case 'aviso_equipe':
          await gravarSequencia(emMovimento);
          avisoCriado = await aviso('[Demonstração] Atraso de cerca de 15 minutos por trânsito intenso no trajeto.', false);
          conversa = [{ texto: 'oi, cadê o bus?' }, { texto: String(numeroAlvo) }];
          break;
        case 'resposta_lenta':
          await gravarSequencia(emMovimento);
          conversa = [{ texto: 'Será que vai demorar muito hoje?', simular_demora_ms: config.regras.limiteClassificacaoMs + 500 }];
          break;
        case 'parado':
          await gravarSequencia({ ...emMovimento, inicioM: antesDoAlvo, fimM: antesDoAlvo, quantidade: 14, velocidadeFixa: 0 });
          conversa = [{ texto: 'o ônibus está rodando?' }];
          break;
        case 'interrupcao':
          await gravarSequencia(emMovimento);
          avisoCriado = await aviso('[Demonstração] Serviço temporariamente interrompido para manutenção do veículo.', true);
          conversa = [{ texto: 'o ônibus está rodando?' }];
          break;
        default:
          break;
      }

      const foraDaGrade = rotasNaGrade(rotas, agora, config.fuso).length === 0;
      return {
        cenario: id,
        titulo: cenario.titulo,
        aviso_id: avisoCriado ? avisoCriado.id : null,
        conversa,
        observacao: foraDaGrade
          ? 'O horário atual está fora da grade cadastrada; pela regra, o status será "Fora de operação".'
          : null,
      };
    },
  };
}

module.exports = { criarCenariosService, CENARIOS };
