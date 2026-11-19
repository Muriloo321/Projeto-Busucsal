'use strict';

/**
 * Conjunto interno de frases de exemplo com a intenção esperada.
 * Serve para testes automatizados e para conferir regressões do classificador.
 * NÃO substitui o critério da Seção 8 (≥ 80% das mensagens livres de estudantes entendidas),
 * que precisa ser aferido com mensagens reais avaliadas manualmente.
 */
module.exports = Object.freeze([
  { texto: 'oi, cadê o bus?', intencao: 'localizacao' },
  { texto: 'onde está o ônibus agora?', intencao: 'localizacao' },
  { texto: 'cade o buzu', intencao: 'localizacao' },
  { texto: 'qual a localização do ônibus?', intencao: 'localizacao' },
  { texto: 'ta onde o busao?', intencao: 'localizacao' },
  { texto: 'bom dia, onde tá o ônibus da ucsal?', intencao: 'localizacao' },
  { texto: 'quanto tempo falta pro ônibus chegar?', intencao: 'previsao' },
  { texto: 'Quanto tempo falta pro ponto 2?', intencao: 'previsao' },
  { texto: 'que horas o ônibus passa?', intencao: 'previsao' },
  { texto: 'vai demorar muito?', intencao: 'previsao' },
  { texto: 'quando chega no ponto 3?', intencao: 'previsao' },
  { texto: 'já passou?', intencao: 'previsao' },
  { texto: 'faltam quantos minutos?', intencao: 'previsao' },
  { texto: 'o ônibus está rodando?', intencao: 'status' },
  { texto: 'hoje tem ônibus?', intencao: 'status' },
  { texto: 'status', intencao: 'status' },
  { texto: 'o serviço está funcionando?', intencao: 'status' },
  { texto: 'o bus tá circulando hoje?', intencao: 'status' },
  { texto: 'tem aviso?', intencao: 'avisos' },
  { texto: 'algum atraso hoje?', intencao: 'avisos' },
  { texto: 'o ônibus está atrasado?', intencao: 'avisos' },
  { texto: 'teve alguma interrupção?', intencao: 'avisos' },
  { texto: 'o ônibus quebrou? está em manutenção?', intencao: 'avisos' },
  { texto: 'quero trocar de ponto', intencao: 'escolher_ponto' },
  { texto: 'mudar ponto', intencao: 'escolher_ponto' },
  { texto: 'estou no ponto 1', intencao: 'escolher_ponto' },
  { texto: 'outro ponto', intencao: 'escolher_ponto' },
  { texto: 'menu', intencao: 'ajuda' },
  { texto: 'ajuda', intencao: 'ajuda' },
  { texto: 'quais as opções?', intencao: 'ajuda' },
  { texto: 'oi', intencao: 'ajuda' },
  { texto: 'boa noite', intencao: 'ajuda' },
  { texto: 'como funciona?', intencao: 'ajuda' },
  { texto: 'obrigado', intencao: 'desconhecida' },
  { texto: 'qual o preço da passagem?', intencao: 'desconhecida' },
  { texto: 'asdfgh', intencao: 'desconhecida' },
  { texto: 'gostei muito', intencao: 'desconhecida' },
]);
