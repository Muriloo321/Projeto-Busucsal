'use strict';

/** Página técnica e controles de demonstração. */
function criarTecnicoController({ servicos, config }) {
  const { tecnico, simulador, cenarios } = servicos;

  return {
    async sistema(req, res) { res.json(await tecnico.sistema()); },
    async tabelas(req, res) { res.json({ tabelas: await tecnico.tabelas() }); },
    async tabela(req, res) { res.json(await tecnico.tabela(req.params.nome, req.query.limite)); },
    async posicoes(req, res) { res.json({ posicoes: await tecnico.posicoes(req.query.limite) }); },
    requisicoes(req, res) { res.json(tecnico.requisicoes()); },
    limparRequisicoes(req, res) { res.json(tecnico.limparRequisicoes()); },
    endpoints(req, res) { res.json({ endpoints: tecnico.endpoints() }); },
    indicadores(req, res) { res.json(tecnico.indicadores()); },
    async avaliarPrevisoes(req, res) { res.json(await tecnico.avaliarPrevisoes()); },
    async conjuntoInterno(req, res) { res.json(await tecnico.conjuntoInterno()); },
    mensagens(req, res) { res.json({ mensagens: tecnico.mensagens() }); },
    avaliarMensagem(req, res) { res.json({ mensagem: tecnico.avaliarMensagem(req.params.id, req.body && req.body.correta) }); },
    adicionarParticipante(req, res) { res.status(201).json({ participante: tecnico.adicionarParticipante(req.body) }); },
    removerParticipante(req, res) { res.json(tecnico.removerParticipante(req.params.id)); },

    configDemo(req, res) {
      res.json({ ativo: config.demo.ativo, cenarios: config.demo.ativo ? cenarios.listar() : [] });
    },
    async aplicarCenario(req, res) { res.json(await cenarios.aplicar(req.params.id)); },

    simulador(req, res) { res.json(simulador.situacao()); },
    async iniciarSimulador(req, res) { res.json(await simulador.iniciar(req.body || {})); },
    pararSimulador(req, res) { res.json(simulador.parar()); },
    sinalSimulador(req, res) { res.json(simulador.definirSinal(req.body && req.body.ativo)); },
    paradoSimulador(req, res) { res.json(simulador.definirParado(req.body && req.body.ativo)); },
    velocidadeSimulador(req, res) { res.json(simulador.definirVelocidade(req.body && req.body.velocidade_kmh)); },
    reiniciarPercurso(req, res) { res.json(simulador.reiniciarPercurso()); },
  };
}

module.exports = { criarTecnicoController };
