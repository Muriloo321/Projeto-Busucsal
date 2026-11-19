'use strict';

const { validarAviso, validarId } = require('../domain/validacao');
const { avisoVigente } = require('../domain/status');
const { ValidationError, NotFoundError } = require('../utils/errors');

/** Cadastro e gerenciamento de avisos operacionais (RF09). */
function criarAvisoService({ repos, relogio }) {
  function situacao(aviso, agora) {
    if (!aviso.ativo) return 'inativo';
    if (avisoVigente(aviso, agora)) return 'vigente';
    return new Date(aviso.inicio) > agora ? 'agendado' : 'encerrado';
  }
  const comSituacao = (a) => (a ? { ...a, situacao: situacao(a, relogio.agora()) } : a);

  function id(valor) {
    const v = validarId(valor);
    if (!v.valido) throw new ValidationError('Identificador inválido.', v.erros);
    return v.valor;
  }

  return {
    async listar() {
      return (await repos.aviso.listar()).map(comSituacao);
    },

    async criar(body, adminId) {
      const v = validarAviso(body);
      if (!v.valido) throw new ValidationError('Aviso inválido.', v.erros);
      return comSituacao(await repos.aviso.criar({ ...v.valor, demonstrativo: false, criado_por: adminId }));
    },

    async atualizar(idBruto, body) {
      const avisoId = id(idBruto);
      const atual = await repos.aviso.obter(avisoId);
      if (!atual) throw new NotFoundError('Aviso não encontrado.');
      const v = validarAviso(body, { parcial: true });
      if (!v.valido) throw new ValidationError('Aviso inválido.', v.erros);
      const inicio = v.valor.inicio || new Date(atual.inicio);
      const fim = v.valor.fim || new Date(atual.fim);
      if (fim <= inicio) throw new ValidationError('Aviso inválido.', [{ campo: 'fim', mensagem: 'O fim deve ser posterior ao início.' }]);
      return comSituacao(await repos.aviso.atualizar(avisoId, v.valor));
    },

    async definirAtivo(idBruto, ativo) {
      if (typeof ativo !== 'boolean') throw new ValidationError('Informe ativo: true ou false.', [{ campo: 'ativo', mensagem: 'Use verdadeiro ou falso.' }]);
      const atualizado = await repos.aviso.atualizar(id(idBruto), { ativo });
      if (!atualizado) throw new NotFoundError('Aviso não encontrado.');
      return comSituacao(atualizado);
    },

    async excluir(idBruto) {
      if (!(await repos.aviso.excluir(id(idBruto)))) throw new NotFoundError('Aviso não encontrado.');
      return { excluido: true };
    },
  };
}

module.exports = { criarAvisoService };
