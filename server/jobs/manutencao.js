'use strict';

/**
 * Tarefas periódicas:
 *  - recalcula o status a cada 30 s (o "Sem dados" acontece justamente quando nada chega);
 *  - exclui sessões de conversa expiradas a cada 10 min (LGPD — 24 h).
 */
function iniciarManutencao({ servicos, logger, relogio = { agora: () => new Date() } }) {
  const executar = (nome, fn) => fn().catch((erro) => logger.aviso(`Tarefa "${nome}" falhou`, { mensagem: erro.message }));

  const status = setInterval(() => executar('status', () => servicos.estado.montar()), 30 * 1000);
  const sessoes = setInterval(() => executar('sessoes', async () => {
    const n = await servicos.repos.sessao.excluirExpiradas(relogio.agora());
    if (n > 0) logger.info(`Sessões de conversa expiradas excluídas: ${n}`);
  }), 10 * 60 * 1000);
  status.unref();
  sessoes.unref();
  executar('sessoes', () => servicos.repos.sessao.excluirExpiradas(relogio.agora()));

  return () => { clearInterval(status); clearInterval(sessoes); };
}

module.exports = { iniciarManutencao };
