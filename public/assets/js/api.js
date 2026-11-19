/**
 * Cliente HTTP da interface. Sempre JSON, mesma origem, com tempo limite e erros padronizados.
 */

export class ErroApi extends Error {
  constructor(mensagem, { status = 0, codigo = 'erro_rede', detalhes = [] } = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

async function requisitar(metodo, url, corpo, { tempoLimiteMs = 12000 } = {}) {
  const controle = new AbortController();
  const temporizador = setTimeout(() => controle.abort(), tempoLimiteMs);
  const opcoes = {
    method: metodo,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal: controle.signal,
  };
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }

  let resposta;
  try {
    resposta = await fetch(url, opcoes);
  } catch (erro) {
    const tempo = erro && erro.name === 'AbortError';
    throw new ErroApi(tempo ? 'O servidor demorou para responder.' : 'Não foi possível falar com o servidor. Ele está rodando?', { codigo: tempo ? 'tempo_esgotado' : 'erro_rede' });
  } finally {
    clearTimeout(temporizador);
  }

  let dados = null;
  const tipo = resposta.headers.get('content-type') || '';
  if (tipo.includes('application/json')) {
    try { dados = await resposta.json(); } catch { dados = null; }
  }
  if (!resposta.ok) {
    const erro = (dados && dados.erro) || {};
    throw new ErroApi(erro.mensagem || `Erro ${resposta.status}.`, { status: resposta.status, codigo: erro.codigo, detalhes: erro.detalhes || [] });
  }
  return dados;
}

export const api = {
  get: (url, opcoes) => requisitar('GET', url, undefined, opcoes),
  post: (url, corpo = {}, opcoes) => requisitar('POST', url, corpo, opcoes),
  put: (url, corpo = {}, opcoes) => requisitar('PUT', url, corpo, opcoes),
  patch: (url, corpo = {}, opcoes) => requisitar('PATCH', url, corpo, opcoes),
  delete: (url, opcoes) => requisitar('DELETE', url, undefined, opcoes),
};
