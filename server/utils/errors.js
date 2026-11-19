'use strict';

/**
 * Erros de aplicação com status HTTP e código estável.
 * O middleware central de erros converte estas classes em respostas JSON.
 */
class AppError extends Error {
  constructor(mensagem, { status = 500, codigo = 'erro_interno', detalhes } = {}) {
    super(mensagem);
    this.name = this.constructor.name;
    this.status = status;
    this.codigo = codigo;
    if (detalhes !== undefined) this.detalhes = detalhes;
  }
}

class ValidationError extends AppError {
  constructor(mensagem = 'Dados inválidos.', detalhes = []) {
    super(mensagem, { status: 400, codigo: 'dados_invalidos', detalhes });
  }
}

class UnauthorizedError extends AppError {
  constructor(mensagem = 'Autenticação necessária.', codigo = 'nao_autenticado') {
    super(mensagem, { status: 401, codigo });
  }
}

class ForbiddenError extends AppError {
  constructor(mensagem = 'Acesso não permitido.', codigo = 'acesso_negado') {
    super(mensagem, { status: 403, codigo });
  }
}

class NotFoundError extends AppError {
  constructor(mensagem = 'Recurso não encontrado.') {
    super(mensagem, { status: 404, codigo: 'nao_encontrado' });
  }
}

class ConflictError extends AppError {
  constructor(mensagem = 'Conflito com dados existentes.', detalhes) {
    super(mensagem, { status: 409, codigo: 'conflito', detalhes });
  }
}

class UnprocessableError extends AppError {
  constructor(mensagem, detalhes) {
    super(mensagem, { status: 422, codigo: 'regra_violada', detalhes });
  }
}

class TooManyRequestsError extends AppError {
  constructor(mensagem = 'Muitas tentativas. Aguarde alguns minutos.') {
    super(mensagem, { status: 429, codigo: 'muitas_tentativas' });
  }
}

class ServiceUnavailableError extends AppError {
  constructor(mensagem = 'Serviço temporariamente indisponível.', codigo = 'indisponivel') {
    super(mensagem, { status: 503, codigo });
  }
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableError,
  TooManyRequestsError,
  ServiceUnavailableError,
};
