'use strict';

/**
 * Validação de entradas. Cada função devolve { valido, erros: [{campo, mensagem}], valor }.
 * Os mesmos limites são aplicados no frontend (assets/js/validacao.js) para feedback imediato.
 */

const SENTIDOS = ['ida', 'volta'];
const TURNOS = ['M', 'N', 'M/N'];
const FONTES_HTTP = ['rastreador', 'simulador', 'simulador_acelerado'];
const ISO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

function numeroEstrito(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && /^\s*[-+]?\d+(\.\d+)?([eE][-+]?\d+)?\s*$/.test(v)) return Number(v);
  return NaN;
}

function coletor() {
  const erros = [];
  return {
    erros,
    erro(campo, mensagem) { erros.push({ campo, mensagem }); },
    resultado(valor) { return { valido: erros.length === 0, erros, valor: erros.length === 0 ? valor : undefined }; },
  };
}

function textoObrigatorio(c, campo, valor, { min = 1, max }) {
  if (typeof valor !== 'string' || valor.trim().length < min) {
    c.erro(campo, min > 1 ? `Informe pelo menos ${min} caracteres.` : 'Campo obrigatório.');
    return undefined;
  }
  const limpo = valor.trim().replace(/\s+/g, ' ');
  if (limpo.length > max) c.erro(campo, `Use no máximo ${max} caracteres.`);
  return limpo;
}

function validarCoordenadas(c, latitudeBruta, longitudeBruta) {
  const latitude = numeroEstrito(latitudeBruta);
  const longitude = numeroEstrito(longitudeBruta);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) c.erro('latitude', 'Latitude deve ser um número entre -90 e 90.');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) c.erro('longitude', 'Longitude deve ser um número entre -180 e 180.');
  if (latitude === 0 && longitude === 0) c.erro('latitude', 'Coordenada (0, 0) indica GPS sem sinal.');
  return { latitude, longitude };
}

function booleanoOpcional(c, campo, valor, padrao) {
  if (valor === undefined) return padrao;
  if (typeof valor !== 'boolean') { c.erro(campo, 'Use verdadeiro ou falso.'); return padrao; }
  return valor;
}

/**
 * @param {object} n payload normalizado por traccar.normalizarPayloadPosicao
 * @param {{agora: Date, velocidadeMaxKmh: number, futuroMaxS: number, passadoMaxH: number}} limites
 */
function validarPosicao(n, { agora, velocidadeMaxKmh, futuroMaxS, passadoMaxH }) {
  const c = coletor();
  if (!n || n.formato === 'desconhecido') {
    c.erro('corpo', 'Formato de posição não reconhecido. Envie latitude e longitude.');
    return c.resultado();
  }

  const dispositivo = typeof n.dispositivo_id === 'number' ? String(n.dispositivo_id) : n.dispositivo_id;
  if (typeof dispositivo !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(dispositivo)) {
    c.erro('dispositivo_id', 'Identificador do dispositivo ausente ou inválido.');
  }

  const { latitude, longitude } = validarCoordenadas(c, n.latitude, n.longitude);

  let velocidade = null;
  if (n.velocidade_kmh !== undefined && n.velocidade_kmh !== null && n.velocidade_kmh !== '') {
    velocidade = numeroEstrito(n.velocidade_kmh);
    if (!Number.isFinite(velocidade) || velocidade < 0 || velocidade > velocidadeMaxKmh) {
      c.erro('velocidade_kmh', `Velocidade deve estar entre 0 e ${velocidadeMaxKmh} km/h.`);
    }
  }

  let registradoEm = n.registrado_em instanceof Date ? n.registrado_em : null;
  if (registradoEm === null) registradoEm = new Date(agora);
  if (Number.isNaN(registradoEm.getTime())) {
    c.erro('registrado_em', 'Data/hora da posição ilegível.');
  } else if (registradoEm.getTime() - agora.getTime() > futuroMaxS * 1000) {
    c.erro('registrado_em', 'Data/hora da posição está no futuro.');
  } else if (agora.getTime() - registradoEm.getTime() > passadoMaxH * 3600 * 1000) {
    c.erro('registrado_em', `Posição com mais de ${passadoMaxH} h não é aceita.`);
  }

  let precisao = null;
  if (n.precisao_m !== null && n.precisao_m !== undefined && n.precisao_m !== '') {
    precisao = numeroEstrito(n.precisao_m);
    if (!Number.isFinite(precisao) || precisao < 0 || precisao > 100000) c.erro('precisao_m', 'Precisão inválida.');
  }

  const fonte = n.fonte === undefined || n.fonte === null || n.fonte === '' ? 'rastreador' : n.fonte;
  if (!FONTES_HTTP.includes(fonte)) c.erro('fonte', `Fonte deve ser uma de: ${FONTES_HTTP.join(', ')}.`);

  return c.resultado({
    formato: n.formato,
    dispositivo_id: dispositivo,
    latitude,
    longitude,
    velocidade_kmh: velocidade === null ? null : Math.round(velocidade * 100) / 100,
    registrado_em: registradoEm,
    precisao_m: precisao,
    fonte,
  });
}

function validarAviso(body, { parcial = false } = {}) {
  const c = coletor();
  const b = body && typeof body === 'object' ? body : {};
  const valor = {};

  if (!parcial || b.texto !== undefined) valor.texto = textoObrigatorio(c, 'texto', b.texto, { min: 3, max: 500 });

  for (const campo of ['inicio', 'fim']) {
    if (parcial && b[campo] === undefined) continue;
    if (typeof b[campo] !== 'string' || !ISO_COM_FUSO.test(b[campo]) || Number.isNaN(Date.parse(b[campo]))) {
      c.erro(campo, 'Informe data e hora válidas (ISO 8601 com fuso).');
    } else {
      valor[campo] = new Date(b[campo]);
    }
  }
  if (valor.inicio && valor.fim && valor.fim <= valor.inicio) c.erro('fim', 'O fim deve ser posterior ao início.');

  const ativo = booleanoOpcional(c, 'ativo', b.ativo, parcial ? undefined : true);
  if (ativo !== undefined) valor.ativo = ativo;
  const interrompe = booleanoOpcional(c, 'interrompe_operacao', b.interrompe_operacao, parcial ? undefined : false);
  if (interrompe !== undefined) valor.interrompe_operacao = interrompe;

  if (parcial && Object.keys(valor).length === 0) c.erro('corpo', 'Nenhum campo para atualizar.');
  return c.resultado(valor);
}

function validarPonto(body, { parcial = false } = {}) {
  const c = coletor();
  const b = body && typeof body === 'object' ? body : {};
  const valor = {};

  if (!parcial || b.nome !== undefined) valor.nome = textoObrigatorio(c, 'nome', b.nome, { min: 2, max: 120 });
  if (b.referencia !== undefined && b.referencia !== null && b.referencia !== '') {
    if (typeof b.referencia !== 'string') c.erro('referencia', 'Referência deve ser texto.');
    else if (b.referencia.trim().length > 200) c.erro('referencia', 'Use no máximo 200 caracteres.');
    else valor.referencia = b.referencia.trim().replace(/\s+/g, ' ');
  } else if (!parcial || b.referencia !== undefined) {
    valor.referencia = null;
  }

  if (!parcial || b.latitude !== undefined || b.longitude !== undefined) {
    const { latitude, longitude } = validarCoordenadas(c, b.latitude, b.longitude);
    valor.latitude = latitude;
    valor.longitude = longitude;
  }

  if (!parcial || b.ordem_na_rota !== undefined) {
    const ordem = numeroEstrito(b.ordem_na_rota);
    if (!Number.isInteger(ordem) || ordem < 1 || ordem > 99) c.erro('ordem_na_rota', 'Ordem deve ser um inteiro entre 1 e 99.');
    valor.ordem_na_rota = ordem;
  }
  if (!parcial || b.sentido !== undefined) {
    if (!SENTIDOS.includes(b.sentido)) c.erro('sentido', `Sentido deve ser: ${SENTIDOS.join(' ou ')}.`);
    valor.sentido = b.sentido;
  }
  if (!parcial || b.turnos !== undefined) {
    const turnos = b.turnos === undefined ? 'M/N' : b.turnos;
    if (!TURNOS.includes(turnos)) c.erro('turnos', `Turnos deve ser: ${TURNOS.join(', ')}.`);
    valor.turnos = turnos;
  }
  const ativo = booleanoOpcional(c, 'ativo', b.ativo, parcial ? undefined : true);
  if (ativo !== undefined) valor.ativo = ativo;

  if (parcial && Object.keys(valor).length === 0) c.erro('corpo', 'Nenhum campo para atualizar.');
  return c.resultado(valor);
}

function validarLogin(body) {
  const c = coletor();
  const b = body && typeof body === 'object' ? body : {};
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+$/.test(email)) c.erro('email', 'Informe um e-mail válido.');
  if (typeof b.senha !== 'string' || b.senha.length === 0 || b.senha.length > 200) c.erro('senha', 'Informe a senha.');
  return c.resultado({ email, senha: b.senha });
}

function validarMensagem(body, { permitirDemora = false } = {}) {
  const c = coletor();
  const b = body && typeof body === 'object' ? body : {};
  const mensagem = textoObrigatorio(c, 'mensagem', b.mensagem, { min: 1, max: 500 });
  if (typeof b.sessao_local !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(b.sessao_local)) {
    c.erro('sessao_local', 'Identificador de sessão local inválido.');
  }
  let demora = 0;
  if (b.simular_demora_ms !== undefined) {
    demora = numeroEstrito(b.simular_demora_ms);
    if (!permitirDemora) c.erro('simular_demora_ms', 'Disponível apenas no modo de demonstração.');
    else if (!Number.isInteger(demora) || demora < 0 || demora > 5000) c.erro('simular_demora_ms', 'Use um inteiro entre 0 e 5000.');
  }
  return c.resultado({ mensagem, sessao_local: b.sessao_local, simular_demora_ms: demora });
}

function validarId(valor, campo = 'id') {
  const n = numeroEstrito(valor);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) {
    return { valido: false, erros: [{ campo, mensagem: 'Identificador inválido.' }] };
  }
  return { valido: true, erros: [], valor: n };
}

module.exports = {
  SENTIDOS,
  TURNOS,
  FONTES_HTTP,
  numeroEstrito,
  validarPosicao,
  validarAviso,
  validarPonto,
  validarLogin,
  validarMensagem,
  validarId,
};
