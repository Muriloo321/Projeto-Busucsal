'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assinarToken, verificarToken, hashUsuario, iguaisEmTempoConstante, urlSemSegredos } = require('../../server/utils/seguranca');
const { lerCookies, serializarCookie } = require('../../server/utils/cookies');
const { carregarConfig, ErroConfiguracao } = require('../../server/config');
const { ENV_TESTE } = require('../helpers/contexto');

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';

test('token de sessão: válido, expirado e adulterado', () => {
  const agora = Date.parse('2026-11-18T13:00:00Z');
  const token = assinarToken({ sub: 5 }, SEGREDO, 3600, agora);
  assert.equal(verificarToken(token, SEGREDO, agora + 1000).sub, 5);
  assert.equal(verificarToken(token, SEGREDO, agora + 3600 * 1000), null);
  assert.equal(verificarToken(token, 'outro-segredo-qualquer-com-32-caracteres', agora), null);
  const [corpo, assinatura] = token.split('.');
  const falso = Buffer.from(JSON.stringify({ sub: 1, exp: 9999999999 })).toString('base64url');
  assert.equal(verificarToken(`${falso}.${assinatura}`, SEGREDO, agora), null);
  assert.equal(verificarToken(`${corpo}.`, SEGREDO, agora), null);
  assert.equal(verificarToken('lixo', SEGREDO, agora), null);
});

test('identificador da conversa é pseudonimizado e separado por canal', () => {
  const a = hashUsuario('simulador', 'sessao-local-1', SEGREDO);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, hashUsuario('simulador', 'sessao-local-1', SEGREDO));
  assert.notEqual(a, hashUsuario('whatsapp', 'sessao-local-1', SEGREDO));
  assert.notEqual(a, hashUsuario('simulador', 'sessao-local-2', SEGREDO));
});

test('comparação de segredos e mascaramento em logs', () => {
  assert.equal(iguaisEmTempoConstante('abc', 'abc'), true);
  assert.equal(iguaisEmTempoConstante('abc', 'abd'), false);
  assert.equal(iguaisEmTempoConstante('abc', undefined), false);
  assert.equal(urlSemSegredos('/api/posicao?id=1&token=XYZ&lat=1'), '/api/posicao?id=1&token=***&lat=1');
});

test('cookies', () => {
  assert.deepEqual(lerCookies('a=1; busucsal_sessao=x%20y; a=2'), { a: '1', busucsal_sessao: 'x y' });
  const c = serializarCookie('busucsal_sessao', 'v', { maxAgeS: 60, secure: true });
  assert.equal(c, 'busucsal_sessao=v; Path=/; SameSite=Strict; Max-Age=60; HttpOnly; Secure');
});

test('configuração exige segredos e rejeita valores de exemplo', () => {
  assert.throws(() => carregarConfig({}, { exigirBanco: false }), ErroConfiguracao);
  assert.throws(() => carregarConfig({ ...ENV_TESTE, DEVICE_TOKEN: 'troque-por-um-token-aleatorio' }, { exigirBanco: false }), /valor de exemplo/);
  assert.throws(() => carregarConfig({ ...ENV_TESTE, ADMIN_SESSION_SECRET: 'curto' }, { exigirBanco: false }), /32 caracteres/);
  assert.throws(() => carregarConfig(ENV_TESTE), /DATABASE_URL/);
  const c = carregarConfig(ENV_TESTE, { exigirBanco: false });
  assert.equal(c.regras.limiteDadosVencidosS, 180);
  assert.equal(c.regras.tempoParadoMin, 5);
  assert.equal(c.regras.limiteClassificacaoMs, 2000);
  assert.equal(c.regras.validadeSessaoH, 24);
  assert.equal(c.rastreador.principal, 'busucsal-01');
});
