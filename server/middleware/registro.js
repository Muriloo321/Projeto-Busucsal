'use strict';

/** Registra método, caminho (sem segredos), status e duração de cada chamada de API. */
function registrarRequisicoes(registro) {
  return function registrar(req, res, next) {
    const url = req.originalUrl || req.url;
    if (!/^\/(api|admin|webhook)(\/|$)/.test(url) || /^\/admin(\.html)?(\?|$)/.test(url)) return next();
    const inicio = process.hrtime.bigint();
    res.on('finish', () => {
      registro.registrar({
        metodo: req.method,
        url,
        status: res.statusCode,
        duracaoMs: Number(process.hrtime.bigint() - inicio) / 1e6,
      });
    });
    return next();
  };
}

module.exports = { registrarRequisicoes };
