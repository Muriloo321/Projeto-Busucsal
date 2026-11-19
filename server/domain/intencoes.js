'use strict';

/**
 * Classificador local e determinístico de intenções (Seção 4.3 — RF05 e RF06).
 *
 * Não usa serviço externo de IA nesta etapa. A interface `classificar(texto, contexto)`
 * é a mesma que uma futura implementação com LLM deverá seguir: ela devolve apenas a
 * intenção (e, se houver, o ponto citado). Nenhum número, distância ou horário sai daqui.
 */

const INTENCOES = Object.freeze({
  LOCALIZACAO: 'localizacao',
  STATUS: 'status',
  PREVISAO: 'previsao',
  AVISOS: 'avisos',
  ESCOLHER_PONTO: 'escolher_ponto',
  AJUDA: 'ajuda',
  DESCONHECIDA: 'desconhecida',
});

const LISTA_INTENCOES = Object.values(INTENCOES);

/** Opções do menu numerado (fallback). A ordem aqui define o número exibido. */
const MENU = Object.freeze([
  { numero: 1, intencao: INTENCOES.LOCALIZACAO, texto: 'Onde está o ônibus e quando ele chega' },
  { numero: 2, intencao: INTENCOES.STATUS, texto: 'Status do serviço' },
  { numero: 3, intencao: INTENCOES.AVISOS, texto: 'Avisos da equipe' },
  { numero: 4, intencao: INTENCOES.ESCOLHER_PONTO, texto: 'Trocar ponto de embarque' },
]);

const NUMEROS_POR_EXTENSO = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

// [termo, peso]. Termos terminados em "*" casam por prefixo.
const VOCABULARIO = {
  [INTENCOES.AJUDA]: [
    ['menu', 3], ['ajuda', 3], ['opcoes', 3], ['opcao', 2], ['help', 3], ['comandos', 3],
    ['como funciona', 3], ['o que voce faz', 3],
    // saudações sozinhas levam ao menu
    ['oi', 1], ['ola', 1], ['bom dia', 1], ['boa tarde', 1], ['boa noite', 1], ['e ai', 1], ['eai', 1], ['opa', 1],
  ],
  [INTENCOES.AVISOS]: [
    ['aviso*', 3], ['atras*', 3], ['interrup*', 3], ['manutencao', 3], ['problema*', 2], ['comunicado*', 3],
    ['novidade*', 2], ['noticia*', 2],
  ],
  [INTENCOES.STATUS]: [
    ['status', 3], ['funcionando', 3], ['rodando', 3], ['circulando', 3], ['operando', 3], ['operacao', 2],
    ['servico', 2], ['tem onibus', 3], ['tem bus', 3], ['tem buzu', 3], ['hoje tem', 2], ['vai ter', 2],
  ],
  [INTENCOES.PREVISAO]: [
    ['quanto tempo', 4], ['falta', 3], ['faltam', 3], ['chega', 3], ['chegar', 3], ['chegando', 2],
    ['demora', 3], ['demorar', 3], ['previsao', 3], ['minuto*', 2], ['quando', 2], ['que horas', 3],
    ['vai passar', 3], ['passa', 2], ['passou', 2],
  ],
  [INTENCOES.LOCALIZACAO]: [
    ['cade', 3], ['onde', 3], ['localiza*', 3], ['posicao', 2], ['ta onde', 3], ['esta onde', 3],
    ['bus', 1], ['onibus', 1], ['busao', 1], ['buzu', 1],
  ],
  [INTENCOES.ESCOLHER_PONTO]: [
    ['trocar ponto', 4], ['trocar de ponto', 4], ['mudar ponto', 4], ['mudar de ponto', 4], ['outro ponto', 3],
    ['meu ponto', 2], ['estou no ponto', 2], ['to no ponto', 2],
  ],
};

// Em empate, a intenção mais específica vence.
const PRECEDENCIA = [
  INTENCOES.ESCOLHER_PONTO, INTENCOES.AVISOS, INTENCOES.STATUS, INTENCOES.PREVISAO, INTENCOES.LOCALIZACAO, INTENCOES.AJUDA,
];

const PALAVRAS_GENERICAS = new Set([
  'ponto', 'avenida', 'rua', 'principal', 'campus', 'ucsal', 'entrada', 'saida', 'proximo', 'perto', 'frente',
  'lado', 'interno', 'interna', 'para', 'pela', 'pelo', 'onde', 'esta', 'estou',
]);

function normalizar(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contemTermo(textoNormalizado, termo) {
  if (termo.endsWith('*')) {
    const prefixo = termo.slice(0, -1).replace(/\s+/g, '\\s+');
    return new RegExp(`(^|\\s)${prefixo}[a-z0-9]*`).test(textoNormalizado);
  }
  return ` ${textoNormalizado} `.includes(` ${termo} `);
}

/** Extrai um número isolado ("2", "2)", "opção 2", "dois"). */
function extrairNumeroIsolado(textoNormalizado) {
  const m = /^(?:opcao|numero|n|o|a|no|na)?\s*(\d{1,2})$/.exec(textoNormalizado);
  if (m) return Number(m[1]);
  if (Object.prototype.hasOwnProperty.call(NUMEROS_POR_EXTENSO, textoNormalizado)) return NUMEROS_POR_EXTENSO[textoNormalizado];
  return null;
}

/** Número exibido ao estudante na lista de pontos (sequencial); cai para a ordem na rota. */
function numeroDoPonto(p) {
  return Number(p.numero_opcao ?? p.ordem_na_rota);
}

function tokensDistintivos(texto) {
  return normalizar(texto).split(' ').filter((t) => t.length >= 4 && !PALAVRAS_GENERICAS.has(t));
}

/**
 * Procura menção a um ponto: "ponto 2", "ponto dois" ou palavras do nome/referência.
 * @returns {{ponto_id:number|null, ambiguo:boolean, ordem_citada:number|null}}
 */
function identificarPonto(textoNormalizado, pontos) {
  const lista = pontos || [];
  const porOrdem = /\bponto\s+(?:numero\s+|n\s+)?(\d{1,2}|um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/.exec(textoNormalizado);
  if (porOrdem) {
    const ordem = /^\d+$/.test(porOrdem[1]) ? Number(porOrdem[1]) : NUMEROS_POR_EXTENSO[porOrdem[1]];
    const ponto = lista.find((p) => numeroDoPonto(p) === ordem);
    return { ponto_id: ponto ? ponto.id : null, ambiguo: false, ordem_citada: ordem };
  }

  const palavras = new Set(textoNormalizado.split(' '));
  const pontuacoes = lista.map((p) => {
    let pontos_ = 0;
    for (const t of new Set(tokensDistintivos(p.nome))) if (palavras.has(t)) pontos_ += 2;
    for (const t of new Set(tokensDistintivos(p.referencia))) if (palavras.has(t)) pontos_ += 1;
    return { id: p.id, pontos: pontos_ };
  }).filter((x) => x.pontos > 0).sort((a, b) => b.pontos - a.pontos);

  if (pontuacoes.length === 0) return { ponto_id: null, ambiguo: false, ordem_citada: null };
  if (pontuacoes.length > 1 && pontuacoes[0].pontos === pontuacoes[1].pontos) {
    return { ponto_id: null, ambiguo: true, ordem_citada: null };
  }
  return { ponto_id: pontuacoes[0].id, ambiguo: false, ordem_citada: null };
}

/**
 * Classifica a mensagem considerando a etapa da sessão (respostas numéricas são contextuais).
 * @param {string} texto
 * @param {{etapa:string, pontos:Array}} contexto
 */
function classificar(texto, { etapa = 'inicio', pontos = [] } = {}) {
  const normalizado = normalizar(texto);
  const base = { intencao: INTENCOES.DESCONHECIDA, ponto_id: null, origem: 'palavras_chave', confianca: 0 };
  if (!normalizado) return base;

  const numero = extrairNumeroIsolado(normalizado);
  if (numero !== null) {
    if (etapa === 'aguardando_ponto' || etapa === 'ponto_definido') {
      const ponto = pontos.find((p) => numeroDoPonto(p) === numero);
      return {
        intencao: INTENCOES.ESCOLHER_PONTO, ponto_id: ponto ? ponto.id : null, numero,
        numero_invalido: !ponto, origem: 'numero_contextual', confianca: ponto ? 1 : 0,
      };
    }
    if (etapa === 'menu_principal') {
      const opcao = MENU.find((o) => o.numero === numero);
      if (opcao) return { intencao: opcao.intencao, ponto_id: null, numero, origem: 'numero_contextual', confianca: 1 };
      return { ...base, numero, numero_invalido: true, origem: 'numero_contextual' };
    }
    return { ...base, numero, origem: 'numero_sem_contexto' };
  }

  const placar = {};
  for (const intencao of Object.keys(VOCABULARIO)) {
    placar[intencao] = VOCABULARIO[intencao].reduce((soma, [termo, peso]) => soma + (contemTermo(normalizado, termo) ? peso : 0), 0);
  }
  const ponto = identificarPonto(normalizado, pontos);

  let melhor = null;
  for (const intencao of PRECEDENCIA) {
    if (placar[intencao] > 0 && (!melhor || placar[intencao] > placar[melhor])) melhor = intencao;
  }

  // Um ponto citado sem outra intenção clara significa escolha de ponto ("estou na portaria").
  if (ponto.ponto_id && (!melhor || melhor === INTENCOES.AJUDA)) melhor = INTENCOES.ESCOLHER_PONTO;

  if (!melhor) return { ...base, ponto_ambiguo: ponto.ambiguo };

  const total = Object.values(placar).reduce((a, b) => a + b, 0);
  return {
    intencao: melhor,
    ponto_id: ponto.ponto_id,
    ponto_ambiguo: ponto.ambiguo,
    origem: 'palavras_chave',
    confianca: placar[melhor] > 0 ? Math.round((placar[melhor] / total) * 100) / 100 : 0.5,
  };
}

/**
 * Executa um classificador (síncrono ou assíncrono) com limite de tempo.
 * Ao exceder o limite, devolve `tempo_excedido` para que o fluxo mostre o menu numerado.
 */
async function classificarComLimite(classificador, texto, contexto, limiteMs) {
  const inicio = process.hrtime.bigint();
  let temporizador;
  const limite = new Promise((resolve) => {
    temporizador = setTimeout(() => resolve({ tempoExcedido: true }), limiteMs);
  });
  try {
    const resultado = await Promise.race([
      Promise.resolve()
        .then(() => classificador(texto, contexto))
        .then((r) => ({ resultado: r }), (erro) => ({ erro })),
      limite,
    ]);
    const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
    if (resultado.tempoExcedido) {
      return { intencao: INTENCOES.DESCONHECIDA, ponto_id: null, origem: 'tempo_excedido', tempo_excedido: true, duracao_ms: Math.round(duracaoMs) };
    }
    if (resultado.erro) {
      // Falha do classificador também leva ao menu numerado, nunca a uma resposta inventada.
      return { intencao: INTENCOES.DESCONHECIDA, ponto_id: null, origem: 'erro_classificador', tempo_excedido: false, duracao_ms: Math.round(duracaoMs) };
    }
    const r = resultado.resultado || {};
    const intencao = LISTA_INTENCOES.includes(r.intencao) ? r.intencao : INTENCOES.DESCONHECIDA;
    return { ...r, intencao, tempo_excedido: false, duracao_ms: Math.round(duracaoMs * 100) / 100 };
  } finally {
    clearTimeout(temporizador);
  }
}

module.exports = {
  INTENCOES,
  LISTA_INTENCOES,
  MENU,
  normalizar,
  identificarPonto,
  classificar,
  classificarComLimite,
};
