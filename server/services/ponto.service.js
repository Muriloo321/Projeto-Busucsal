'use strict';

const { validarPonto, validarId } = require('../domain/validacao');
const { ValidationError, NotFoundError, ConflictError, UnprocessableError } = require('../utils/errors');

/**
 * Consulta e cadastro inicial dos pontos de embarque (Seção 6).
 * Um ponto só é aceito se estiver sobre um trajeto ativo do mesmo sentido (verificação no PostGIS),
 * pois a previsão depende da posição do ponto ao longo da rota.
 */
function criarPontoService({ repos, config }) {
  const tolerancia = config.regras.toleranciaPontoRotaM;

  async function conferirTrajeto({ latitude, longitude, sentido }) {
    const r = await repos.rota.distanciaAteRotas({ latitude, longitude, sentido });
    if (!r || r.rotas === 0) {
      throw new UnprocessableError(`Não há rota ativa cadastrada para o sentido "${sentido}".`);
    }
    if (r.distancia_m > tolerancia) {
      throw new UnprocessableError(
        `O ponto está a ${Math.round(r.distancia_m)} m do trajeto (limite: ${tolerancia} m). Confira as coordenadas.`,
        [{ campo: 'latitude', mensagem: 'Coordenada fora do trajeto cadastrado.' }],
      );
    }
    return Math.round(r.distancia_m);
  }

  async function traduzirConflito(promessa) {
    try {
      return await promessa;
    } catch (erro) {
      if (erro && erro.code === '23505') {
        throw new ConflictError('Já existe um ponto ativo com essa ordem neste sentido.', [{ campo: 'ordem_na_rota', mensagem: 'Ordem já utilizada.' }]);
      }
      throw erro;
    }
  }

  function id(valor) {
    const v = validarId(valor);
    if (!v.valido) throw new ValidationError('Identificador inválido.', v.erros);
    return v.valor;
  }

  return {
    listar: () => repos.ponto.listar({ incluirInativos: true }),

    async criar(body) {
      const v = validarPonto(body);
      if (!v.valido) throw new ValidationError('Ponto inválido.', v.erros);
      const distancia = await conferirTrajeto(v.valor);
      const ponto = await traduzirConflito(repos.ponto.criar(v.valor));
      return { ...ponto, distancia_trajeto_m: distancia };
    },

    async atualizar(idBruto, body) {
      const pontoId = id(idBruto);
      const atual = await repos.ponto.obter(pontoId);
      if (!atual) throw new NotFoundError('Ponto não encontrado.');
      const v = validarPonto(body, { parcial: true });
      if (!v.valido) throw new ValidationError('Ponto inválido.', v.erros);
      const final = { ...atual, ...v.valor };
      const distancia = await conferirTrajeto(final);
      const ponto = await traduzirConflito(repos.ponto.atualizar(pontoId, v.valor));
      return { ...ponto, distancia_trajeto_m: distancia };
    },

    async definirAtivo(idBruto, ativo) {
      if (typeof ativo !== 'boolean') throw new ValidationError('Informe ativo: true ou false.', [{ campo: 'ativo', mensagem: 'Use verdadeiro ou falso.' }]);
      const pontoId = id(idBruto);
      if (!(await repos.ponto.obter(pontoId))) throw new NotFoundError('Ponto não encontrado.');
      return traduzirConflito(repos.ponto.atualizar(pontoId, { ativo }));
    },
  };
}

module.exports = { criarPontoService };
