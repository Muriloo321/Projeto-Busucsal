'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classificar, classificarComLimite, LISTA_INTENCOES } = require('../../server/domain/intencoes');
const { montarOpcoesPonto } = require('../../server/domain/dialogo');
const FRASES = require('../../server/domain/frases-validacao');
const { PONTOS_DEMO } = require('../helpers/contexto');

const pontos = montarOpcoesPonto(PONTOS_DEMO.map((p, i) => ({ ...p, id: i + 1 })));

test('só existem as sete intenções do planejamento', () => {
  assert.deepEqual([...LISTA_INTENCOES].sort(), ['ajuda', 'avisos', 'desconhecida', 'escolher_ponto', 'localizacao', 'previsao', 'status']);
});

test('classifica todas as frases do conjunto interno de validação', () => {
  const erros = FRASES.filter((f) => classificar(f.texto, { etapa: 'inicio', pontos }).intencao !== f.intencao);
  assert.deepEqual(erros, []);
});

test('o classificador devolve só a intenção e o ponto citado — nenhum número de previsão', () => {
  const r = classificar('quanto tempo falta pro ponto 2?', { etapa: 'inicio', pontos });
  assert.equal(r.intencao, 'previsao');
  assert.equal(r.ponto_id, 2);
  for (const chave of ['minutos', 'distancia', 'horario', 'resposta']) assert.equal(Object.hasOwn(r, chave), false);
});

test('reconhece pontos pelo nome ou pela referência', () => {
  assert.deepEqual([classificar('estou na portaria', { pontos }).intencao, classificar('estou na portaria', { pontos }).ponto_id], ['escolher_ponto', 3]);
  assert.equal(classificar('perto da biblioteca', { pontos }).ponto_id, 4);
  assert.equal(classificar('to no metrô', { pontos }).ponto_id, 1);
});

test('resposta numérica depende da etapa armazenada na sessão', () => {
  assert.deepEqual(
    (({ intencao, ponto_id: p }) => [intencao, p])(classificar('2', { etapa: 'aguardando_ponto', pontos })),
    ['escolher_ponto', 2],
  );
  assert.equal(classificar('2', { etapa: 'menu_principal', pontos }).intencao, 'status');
  assert.equal(classificar('3', { etapa: 'menu_principal', pontos }).intencao, 'avisos');
  assert.equal(classificar('2', { etapa: 'inicio', pontos }).intencao, 'desconhecida');
  assert.equal(classificar('dois', { etapa: 'aguardando_ponto', pontos }).ponto_id, 2);
  assert.equal(classificar('opção 4', { etapa: 'menu_principal', pontos }).intencao, 'escolher_ponto');
  const invalido = classificar('9', { etapa: 'aguardando_ponto', pontos });
  assert.equal(invalido.numero_invalido, true);
  assert.equal(invalido.ponto_id, null);
});

test('mensagem vazia ou sem sentido é desconhecida', () => {
  assert.equal(classificar('', { pontos }).intencao, 'desconhecida');
  assert.equal(classificar('????', { pontos }).intencao, 'desconhecida');
});

test('fallback quando a classificação excede 2 segundos', async () => {
  const lento = (texto, ctx) => new Promise((resolve) => setTimeout(() => resolve(classificar(texto, ctx)), 2300));
  const inicio = Date.now();
  const r = await classificarComLimite(lento, 'cadê o bus?', { pontos }, 2000);
  const decorrido = Date.now() - inicio;
  assert.equal(r.tempo_excedido, true);
  assert.equal(r.intencao, 'desconhecida');
  assert.ok(decorrido >= 1990 && decorrido < 2250, `decorreram ${decorrido} ms`);
});

test('classificação dentro do limite segue normalmente; erro do classificador também cai no menu', async () => {
  const ok = await classificarComLimite(classificar, 'cadê o bus?', { pontos }, 2000);
  assert.equal(ok.intencao, 'localizacao');
  assert.equal(ok.tempo_excedido, false);
  const falha = await classificarComLimite(() => { throw new Error('serviço fora'); }, 'oi', {}, 2000);
  assert.equal(falha.origem, 'erro_classificador');
  assert.equal(falha.intencao, 'desconhecida');
  const invalida = await classificarComLimite(() => ({ intencao: 'inventada' }), 'oi', {}, 2000);
  assert.equal(invalida.intencao, 'desconhecida');
});
