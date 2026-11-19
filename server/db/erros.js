'use strict';

/** Classificação de erros do PostgreSQL / driver `pg` para respostas HTTP coerentes. */

const CODIGOS_CONEXAO = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'EAI_AGAIN']);
const SQLSTATE_INDISPONIVEL = new Set(['57P01', '57P02', '57P03', '53300', '08000', '08001', '08003', '08004', '08006']);

function ehIndisponibilidadeBanco(erro) {
  if (!erro) return false;
  if (CODIGOS_CONEXAO.has(erro.code) || SQLSTATE_INDISPONIVEL.has(erro.code)) return true;
  const msg = String(erro.message || '');
  return /timeout exceeded when trying to connect|Connection terminated|connect ECONNREFUSED|database system is (starting up|shutting down)/i.test(msg);
}

/** Converte violações de restrição em {status, codigo, mensagem}; retorna null se não for o caso. */
function traduzirErroRestricao(erro) {
  if (!erro || typeof erro.code !== 'string') return null;
  switch (erro.code) {
    case '23505': return { status: 409, codigo: 'conflito', mensagem: 'Já existe um registro com esses dados.' };
    case '23503': return { status: 409, codigo: 'referencia_invalida', mensagem: 'O registro referencia um item inexistente ou em uso.' };
    case '23514': return { status: 400, codigo: 'restricao_violada', mensagem: 'Os dados violam uma regra do banco.' };
    case '22P02':
    case '22007':
    case '22008': return { status: 400, codigo: 'dados_invalidos', mensagem: 'Formato de dado inválido.' };
    case '42P01':
    case '42883': return { status: 500, codigo: 'banco_desatualizado', mensagem: 'Estrutura do banco ausente. Execute npm run db:setup.' };
    default: return null;
  }
}

module.exports = { ehIndisponibilidadeBanco, traduzirErroRestricao };
