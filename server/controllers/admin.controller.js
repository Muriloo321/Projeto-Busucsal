'use strict';

const { serializarCookie } = require('../utils/cookies');
const { ipDoCliente } = require('../utils/http');

/** Autenticação e gerenciamento de avisos e pontos (painel da equipe). */
function criarAdminController({ servicos, config }) {
  const { auth, avisos, pontos, repos } = servicos;
  const { nomeCookie, cookieSeguro } = config.sessaoAdmin;

  return {
    async login(req, res) {
      const r = await auth.login(req.body, ipDoCliente(req));
      res.setHeader('Set-Cookie', serializarCookie(nomeCookie, r.token, { maxAgeS: r.validadeS, secure: cookieSeguro }));
      res.json({ usuario: r.usuario, expira_em_s: r.validadeS });
    },

    logout(req, res) {
      res.setHeader('Set-Cookie', serializarCookie(nomeCookie, '', { maxAgeS: 0, secure: cookieSeguro }));
      res.json({ ok: true });
    },

    sessao(req, res) {
      res.json({ usuario: req.admin });
    },

    async listarAvisos(req, res) { res.json({ avisos: await avisos.listar() }); },
    async criarAviso(req, res) { res.status(201).json({ aviso: await avisos.criar(req.body, req.admin.id) }); },
    async atualizarAviso(req, res) { res.json({ aviso: await avisos.atualizar(req.params.id, req.body) }); },
    async ativarAviso(req, res) { res.json({ aviso: await avisos.definirAtivo(req.params.id, req.body && req.body.ativo) }); },
    async excluirAviso(req, res) { res.json(await avisos.excluir(req.params.id)); },

    async listarPontos(req, res) { res.json({ pontos: await pontos.listar() }); },
    async criarPonto(req, res) { res.status(201).json({ ponto: await pontos.criar(req.body) }); },
    async atualizarPonto(req, res) { res.json({ ponto: await pontos.atualizar(req.params.id, req.body) }); },
    async ativarPonto(req, res) { res.json({ ponto: await pontos.definirAtivo(req.params.id, req.body && req.body.ativo) }); },

    async listarRotas(req, res) {
      const rotas = await repos.rota.listarTodas();
      res.json({ rotas: rotas.map((r) => ({ ...r, extensao_m: Math.round(r.extensao_m) })) });
    },
  };
}

module.exports = { criarAdminController };
