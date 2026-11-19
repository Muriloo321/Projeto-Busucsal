'use strict';

const { avaliarHistorico } = require('../domain/avaliacao-previsao');
const { classificar } = require('../domain/intencoes');
const { montarOpcoesPonto } = require('../domain/dialogo');
const FRASES = require('../domain/frases-validacao');
const CATALOGO = require('../routes/catalogo');
const { parametrosPublicos } = require('../config');
const { ehIndisponibilidadeBanco } = require('../db/erros');
const { ValidationError, NotFoundError } = require('../utils/errors');

/** Serviços da página técnica: sistema, inspetor das tabelas, logs, métricas da Seção 8. */
function criarTecnicoService({ repos, config, relogio, metricas, registroRequisicoes, iniciadoEm }) {
  let ultimaAvaliacao = null;

  const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 1000) / 10 : null);

  return {
    async sistema() {
      let banco;
      try {
        banco = { situacao: 'ok', ...(await repos.inspetor.infoBanco()) };
      } catch (erro) {
        banco = { situacao: ehIndisponibilidadeBanco(erro) ? 'indisponivel' : 'erro', erro: erro.message };
      }
      return {
        servidor: {
          node: process.version,
          ambiente: config.ambiente,
          iniciado_em: iniciadoEm.toISOString(),
          tempo_ativo_s: Math.round((relogio.agora() - iniciadoEm) / 1000),
          modo_demonstracao: config.demo.ativo,
          fuso: config.fuso,
        },
        banco,
        rastreador: { dispositivos: config.rastreador.dispositivos, principal: config.rastreador.principal },
        parametros: parametrosPublicos(config),
      };
    },

    tabelas: () => repos.inspetor.resumo(),

    async tabela(nome, limiteBruto) {
      const limite = Math.min(100, Math.max(1, Number(limiteBruto) || 25));
      const r = await repos.inspetor.linhas(nome, limite);
      if (!r) throw new NotFoundError('Tabela desconhecida.');
      return r;
    },

    posicoes: (limite = 30) => repos.posicao.historico(config.rastreador.principal, Math.min(200, Number(limite) || 30)),

    requisicoes: () => ({ itens: registroRequisicoes.listar(150), estatisticas: registroRequisicoes.estatisticas() }),
    limparRequisicoes: () => { registroRequisicoes.limpar(); return { limpo: true }; },
    endpoints: () => CATALOGO,

    async avaliarPrevisoes() {
      const posicoes = await repos.posicao.paraAvaliacao(config.rastreador.principal, ['rastreador', 'simulador']);
      const rotaIds = [...new Set(posicoes.map((p) => p.rota_id).filter((id) => id !== null))];
      const pontosPorRota = new Map();
      for (const id of rotaIds) {
        const pontos = await repos.rota.pontosComProgresso(id);
        pontosPorRota.set(id, pontos.filter((p) => p.distancia_trajeto_m <= config.regras.toleranciaPontoRotaM));
      }
      ultimaAvaliacao = { ...avaliarHistorico({ posicoes, pontosPorRota, parametros: config.regras }), calculado_em: relogio.agora().toISOString() };
      return ultimaAvaliacao;
    },

    async conjuntoInterno() {
      const pontos = montarOpcoesPonto(await repos.ponto.listar());
      const resultados = FRASES.map((f) => {
        const r = classificar(f.texto, { etapa: 'inicio', pontos });
        return { texto: f.texto, esperada: f.intencao, obtida: r.intencao, correta: r.intencao === f.intencao };
      });
      const corretas = resultados.filter((r) => r.correta).length;
      return { total: resultados.length, corretas, percentual: pct(corretas, resultados.length), erros: resultados.filter((r) => !r.correta) };
    },

    mensagens: () => metricas.mensagensRecentes(),

    avaliarMensagem(id, correta) {
      if (typeof correta !== 'boolean') throw new ValidationError('Informe correta: true ou false.');
      const r = metricas.avaliarMensagem(String(id), correta);
      if (!r) throw new NotFoundError('Mensagem não encontrada (as mensagens ficam só em memória).');
      return r;
    },

    adicionarParticipante(body) {
      const b = body || {};
      const erros = [];
      if (!['M', 'N'].includes(b.turno)) erros.push({ campo: 'turno', mensagem: 'Turno deve ser M ou N.' });
      if (typeof b.data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.data)) erros.push({ campo: 'data', mensagem: 'Data no formato AAAA-MM-DD.' });
      if (erros.length) throw new ValidationError('Participante inválido.', erros);
      return metricas.adicionarParticipante({ turno: b.turno, data: b.data });
    },

    removerParticipante(id) {
      if (!metricas.removerParticipante(String(id))) throw new NotFoundError('Registro não encontrado.');
      return { removido: true };
    },

    indicadores() {
      const m = metricas.instantaneo();
      const r = m.respostas;
      const pResp = pct(r.dentro_do_limite, r.total);
      const c = m.classificacao_manual;
      const pClass = pct(c.corretas, c.avaliadas);
      const porTurno = { M: m.participantes.filter((p) => p.turno === 'M').length, N: m.participantes.filter((p) => p.turno === 'N').length };
      const totalPart = porTurno.M + porTurno.N;
      const av = ultimaAvaliacao;

      const situacao = (aferido, atende) => (!aferido ? 'nao_aferido' : atende ? 'atende' : 'nao_atende');

      return {
        registrado_desde: m.iniciado_em,
        itens: [
          {
            id: 'respostas_5s', titulo: 'Respostas em até 5 segundos', meta: '≥ 90% das respostas',
            valor: pResp === null ? null : `${pResp}%`, amostra: `${r.total} resposta(s)`,
            situacao: situacao(r.total > 0, pResp >= 90),
            origem: 'Medido no simulador de conversa local (ainda não é o WhatsApp).',
            detalhe: r.total ? `Média ${Math.round(r.soma_ms / r.total)} ms · máximo ${Math.round(r.max_ms)} ms` : null,
          },
          {
            id: 'erro_previsao', titulo: 'Erro médio da previsão', meta: '≤ 3 min em pelo menos 10 viagens',
            valor: av && av.erro_medio_min !== null ? `${av.erro_medio_min} min` : null,
            amostra: av ? `${av.viagens_avaliadas} viagem(ns) · ${av.previsoes_avaliadas} previsão(ões)` : 'Avaliação ainda não executada',
            situacao: situacao(Boolean(av && av.viagens_avaliadas >= 10), Boolean(av && av.erro_medio_min <= 3)),
            origem: av && av.somente_dados_simulados
              ? 'Somente viagens SIMULADAS — não representa o erro real.'
              : 'Reprocessamento do histórico de posições (rastreador e simulador em tempo real).',
            detalhe: av ? `Calculado em ${av.calculado_em}` : null,
          },
          {
            id: 'mensagens_compreendidas', titulo: 'Mensagens livres entendidas', meta: '≥ 80% das mensagens',
            valor: pClass === null ? null : `${pClass}%`, amostra: `${c.avaliadas} mensagem(ns) avaliada(s)`,
            situacao: situacao(c.avaliadas > 0, pClass >= 80),
            origem: 'Avaliação manual (certo/errado) das mensagens recebidas, feita na página técnica.',
            detalhe: null,
          },
          {
            id: 'previsao_dado_vencido', titulo: 'Previsões com dado vencido', meta: 'Nenhuma',
            valor: m.previsoes.emitidas ? String(m.previsoes.com_dado_vencido) : null,
            amostra: `${m.previsoes.emitidas} previsão(ões) emitida(s)`,
            situacao: situacao(m.previsoes.emitidas > 0, m.previsoes.com_dado_vencido === 0),
            origem: 'Contagem das previsões enviadas pelo assistente.',
            detalhe: `${m.previsoes.bloqueadas_por_dado_vencido} pedido(s) bloqueado(s) por dado vencido`,
          },
          {
            id: 'teste_estudantes', titulo: 'Teste com estudantes dos dois turnos', meta: '≥ 10 estudantes, matutino e noturno',
            valor: totalPart ? String(totalPart) : null, amostra: `Matutino: ${porTurno.M} · Noturno: ${porTurno.N}`,
            situacao: totalPart === 0 ? 'nao_aferido' : (totalPart >= 10 && porTurno.M > 0 && porTurno.N > 0 ? 'atende' : 'em_andamento'),
            origem: 'Registro manual dos participantes do teste de campo (sem dados pessoais).',
            detalhe: null,
          },
        ],
        participantes: m.participantes,
        avaliacao_previsao: av,
      };
    },
  };
}

module.exports = { criarTecnicoService };
