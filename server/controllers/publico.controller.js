'use strict';

const { validarMensagem } = require('../domain/validacao');
const { ValidationError, AppError } = require('../utils/errors');
const { ehIndisponibilidadeBanco } = require('../db/erros');

/** Controladores das rotas usadas pelo rastreador, pela apresentação e pelo assistente. */
function criarPublicoController({ servicos, config }) {
  const { posicao, estado, conversa, repos } = servicos;

  return {
    async saude(req, res) {
      let banco = 'ok';
      try { await repos.ping(); } catch (erro) { banco = ehIndisponibilidadeBanco(erro) ? 'indisponivel' : 'erro'; }
      res.status(banco === 'ok' ? 200 : 503).json({ servidor: 'ok', banco, horario: new Date().toISOString() });
    },

    // POST /api/posicao — Traccar Client espera HTTP 200 para considerar o envio concluído.
    async receberPosicao(req, res) {
      const r = await posicao.registrar({ body: req.body, query: req.query });
      res.status(200).json({ ok: true, ...r });
    },

    async obterEstado(req, res) {
      res.json(await estado.montar());
    },

    async obterRota(req, res) {
      const rotas = await repos.rota.listarComTrajeto();
      res.json({
        rotas: rotas.map((r) => ({
          id: r.id, nome: r.nome, sentido: r.sentido, turno: r.turno, horario: `${r.horario_inicio}–${r.horario_fim}`,
          extensao_m: Math.round(r.extensao_m), demonstrativa: r.demonstrativa,
          coordenadas: r.trajeto_geojson.coordinates, // [longitude, latitude]
        })),
      });
    },

    async conversar(req, res) {
      const v = validarMensagem(req.body, { permitirDemora: config.demo.ativo });
      if (!v.valido) throw new ValidationError('Mensagem inválida.', v.erros);
      res.json(await conversa.processar({
        canal: 'simulador', identificador: v.valor.sessao_local, mensagem: v.valor.mensagem, demoraSimuladaMs: v.valor.simular_demora_ms,
      }));
    },

    async reiniciarConversa(req, res) {
      const id = req.body && req.body.sessao_local;
      if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
        throw new ValidationError('Sessão inválida.', [{ campo: 'sessao_local', mensagem: 'Identificador inválido.' }]);
      }
      res.json(await conversa.reiniciar({ canal: 'simulador', identificador: id }));
    },

    // POST /webhook/whatsapp — reservado para a integração futura com a Meta.
    whatsappForaDoEscopo() {
      throw new AppError('Integração com o WhatsApp Cloud API fora do escopo desta etapa. Use o simulador de conversa.', { status: 501, codigo: 'nao_implementado' });
    },
  };
}

module.exports = { criarPublicoController };
