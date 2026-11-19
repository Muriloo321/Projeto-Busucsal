'use strict';

const { validarLogin } = require('../domain/validacao');
const { assinarToken, verificarToken } = require('../utils/seguranca');
const { criarLimitador } = require('../utils/limitador');
const { ValidationError, UnauthorizedError, TooManyRequestsError } = require('../utils/errors');

/**
 * Autenticação da equipe (usuario_admin). Senhas comparadas com bcrypt; a sessão é um
 * token assinado (HMAC-SHA-256) enviado em cookie HttpOnly + SameSite=Strict.
 *
 * @param {{hash: Function, compare: Function}} hasher implementação bcrypt (bcryptjs em produção)
 */
function criarAuthService({ repos, config, relogio, hasher }) {
  const { segredo, validadeS, rodadasBcrypt } = config.sessaoAdmin;
  const limitador = criarLimitador({ relogio });
  let hashFalso = null; // usado para igualar o tempo de resposta quando o e-mail não existe

  async function compararSenhaFalsa(senha) {
    if (!hashFalso) hashFalso = await hasher.hash('senha-inexistente-para-tempo-constante', rodadasBcrypt);
    await hasher.compare(senha, hashFalso);
  }

  return {
    async login(body, ip) {
      const v = validarLogin(body);
      if (!v.valido) throw new ValidationError('Dados de login inválidos.', v.erros);
      const { email, senha } = v.valor;
      const chave = `${ip}|${email}`;
      if (limitador.bloqueado(chave)) throw new TooManyRequestsError();

      const usuario = await repos.admin.obterPorEmail(email);
      let ok = false;
      if (usuario && usuario.ativo) ok = await hasher.compare(senha, usuario.senha_hash);
      else await compararSenhaFalsa(senha);

      if (!ok) {
        limitador.falha(chave);
        throw new UnauthorizedError('E-mail ou senha inválidos.', 'credenciais_invalidas');
      }
      limitador.sucesso(chave);
      const agora = relogio.agora();
      await repos.admin.registrarLogin(usuario.id, agora);
      const token = assinarToken({ sub: usuario.id }, segredo, validadeS, agora.getTime());
      return {
        token,
        validadeS,
        usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
      };
    },

    /** Retorna o usuário ativo do token, ou null. */
    async autenticar(token) {
      const payload = verificarToken(token, segredo, relogio.agora().getTime());
      if (!payload || !Number.isInteger(payload.sub)) return null;
      const usuario = await repos.admin.obterPorId(payload.sub);
      if (!usuario || !usuario.ativo) return null;
      return { id: usuario.id, nome: usuario.nome, email: usuario.email };
    },

    async gerarHash(senha) {
      if (typeof senha !== 'string' || senha.length < 10) {
        throw new ValidationError('Senha fraca.', [{ campo: 'senha', mensagem: 'Use pelo menos 10 caracteres.' }]);
      }
      return hasher.hash(senha, rodadasBcrypt);
    },
  };
}

module.exports = { criarAuthService };
