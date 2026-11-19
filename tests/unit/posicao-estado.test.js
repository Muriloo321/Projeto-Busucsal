'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarContexto, gravarTrajeto } = require('../helpers/contexto');
const { ValidationError, ForbiddenError } = require('../../server/utils/errors');

const corpo = (ctx, extra = {}) => ({ dispositivo_id: 'busucsal-01', latitude: -12.9660, longitude: -38.4176, velocidade_kmh: 15, registrado_em: ctx.relogio.agora().toISOString(), ...extra });

test('posição válida grava o histórico e atualiza o estado consolidado', async () => {
  const ctx = criarContexto();
  const r = await ctx.servicos.posicao.registrar({ body: corpo(ctx) });
  assert.equal(r.atualizou_estado, true);
  assert.equal(r.rota_id, 1);
  assert.ok(r.progresso_m > 300 && r.progresso_m < 500, `progresso ${r.progresso_m}`);
  assert.equal(ctx.repos._dados.posicoes.length, 1);
  const e = await ctx.repos.estado.obter('busucsal-01');
  assert.equal(e.ultima_posicao_id, r.posicao_id);
  assert.equal(e.velocidade_kmh, 15);
  assert.equal(e.rota_id, 1);
});

test('dispositivo não autorizado é recusado; dados inválidos geram erro de validação', async () => {
  const ctx = criarContexto();
  await assert.rejects(ctx.servicos.posicao.registrar({ body: corpo(ctx, { dispositivo_id: 'intruso' }) }), ForbiddenError);
  await assert.rejects(ctx.servicos.posicao.registrar({ body: corpo(ctx, { latitude: 200 }) }), (e) => e instanceof ValidationError && e.detalhes[0].campo === 'latitude');
  await assert.rejects(ctx.servicos.posicao.registrar({ body: corpo(ctx, { velocidade_kmh: -5 }) }), ValidationError);
  assert.equal(ctx.repos._dados.posicoes.length, 0);
});

test('posição antiga (reenviada fora de ordem) entra no histórico mas não muda o estado', async () => {
  const ctx = criarContexto();
  await ctx.servicos.posicao.registrar({ body: corpo(ctx) });
  const antiga = new Date(ctx.relogio.agora().getTime() - 120000).toISOString();
  const r = await ctx.servicos.posicao.registrar({ body: corpo(ctx, { registrado_em: antiga, latitude: -12.9690, longitude: -38.4190 }) });
  assert.equal(r.atualizou_estado, false);
  const e = await ctx.repos.estado.obter('busucsal-01');
  assert.equal(e.ultima_atualizacao.toISOString(), ctx.relogio.agora().toISOString());
  const dup = await ctx.servicos.posicao.registrar({ body: corpo(ctx, { registrado_em: antiga }) });
  assert.equal(dup.duplicada, true);
});

test('posição longe do trajeto: estado atualizado, sem rota e sem previsão', async () => {
  const ctx = criarContexto();
  const r = await ctx.servicos.posicao.registrar({ body: corpo(ctx, { latitude: -12.9900, longitude: -38.4500 }) });
  assert.equal(r.fora_do_trajeto, true);
  const e = await ctx.servicos.estado.montar();
  assert.equal(e.veiculo.fora_do_trajeto, true);
  assert.ok(e.pontos.every((p) => p.previsao.tipo === 'indisponivel' && p.previsao.motivo === 'onibus_fora_do_trajeto'));
});

test('estado completo: previsão pela rota, ponto já passado e comparação com linha reta', async () => {
  const ctx = criarContexto();
  await gravarTrajeto(ctx, { deM: 0, ateM: 400, quantidade: 9 }); // ~10,7 km/h
  const e = await ctx.servicos.estado.montar();
  assert.equal(e.status.codigo, 'em_circulacao');
  assert.equal(e.rota.id, 1);
  const [p1, p2, p3] = e.pontos;
  assert.equal(p1.previsao.tipo, 'ja_passou');
  assert.equal(p2.previsao.tipo, 'previsao');
  // Distância pela rota até o ponto 2 = progresso do ponto − progresso do ônibus.
  assert.ok(Math.abs(p2.previsao.distancia_rota_m - (p2.progresso_m - e.rota.progresso_m)) <= 1);
  const esperado = Math.max(1, Math.round((p2.previsao.distancia_rota_m / 1000 / p2.previsao.velocidade_usada_kmh) * 60));
  assert.equal(p2.previsao.minutos, esperado);
  // A linha reta até o ponto 3 é menor que a distância ao longo da rota.
  assert.ok(p3.distancia_reta_m < p3.previsao.distancia_rota_m, `${p3.distancia_reta_m} < ${p3.previsao.distancia_rota_m}`);
  assert.equal(e.localizacao.proximo_ponto.id, p2.id);
  assert.equal(e.veiculo.ultima_atualizacao_local, '10:00');
  assert.equal(e.dados_demonstrativos, true);
  const salvo = await ctx.repos.estado.obter('busucsal-01');
  assert.equal(salvo.status, 'em_circulacao');
  assert.equal(salvo.proximo_ponto_id, p2.id);
});

test('com dados vencidos nenhuma previsão é calculada', async () => {
  const ctx = criarContexto();
  await gravarTrajeto(ctx, { deM: 0, ateM: 400, fim: new Date(ctx.relogio.agora().getTime() - 181000) });
  const e = await ctx.servicos.estado.montar();
  assert.equal(e.status.codigo, 'sem_dados');
  assert.ok(e.pontos.every((p) => p.previsao.tipo === 'indisponivel' && p.previsao.motivo === 'dados_vencidos'));
});

test('veículo parado é detectado após 5 minutos com o rastreador enviando', async () => {
  const ctx = criarContexto();
  await gravarTrajeto(ctx, { deM: 300, ateM: 300, quantidade: 10, velocidadeKmh: 0 }); // 4,5 min
  assert.equal((await ctx.servicos.estado.montar()).status.codigo, 'em_circulacao');
  ctx.relogio.avancar(60000);
  await gravarTrajeto(ctx, { deM: 300, ateM: 300, quantidade: 1, velocidadeKmh: 1 });
  const e = await ctx.servicos.estado.montar();
  assert.equal(e.status.codigo, 'parado');
  assert.ok(e.status.parado_ha_s > 300);
  // Ao voltar a andar, o status volta a "em circulação".
  ctx.relogio.avancar(30000);
  await gravarTrajeto(ctx, { deM: 330, ateM: 330, quantidade: 1, velocidadeKmh: 14 });
  assert.equal((await ctx.servicos.estado.montar()).status.codigo, 'em_circulacao');
});

test('aviso de interrupção vigente coloca o serviço fora de operação; desativado, volta ao normal', async () => {
  const ctx = criarContexto();
  await gravarTrajeto(ctx, { deM: 0, ateM: 400 });
  const agora = ctx.relogio.agora();
  const aviso = await ctx.servicos.avisos.criar({
    texto: 'Ônibus em manutenção.', inicio: new Date(agora - 60000).toISOString(), fim: new Date(agora.getTime() + 3600000).toISOString(), interrompe_operacao: true,
  }, null);
  let e = await ctx.servicos.estado.montar();
  assert.equal(e.status.codigo, 'fora_de_operacao');
  assert.equal(e.status.motivo, 'aviso_interrupcao');
  assert.ok(e.pontos.every((p) => p.previsao.motivo === 'fora_de_operacao'));
  await ctx.servicos.avisos.definirAtivo(aviso.id, false);
  e = await ctx.servicos.estado.montar();
  assert.equal(e.status.codigo, 'em_circulacao');
});

test('fora da grade de horários o serviço fica fora de operação', async () => {
  const ctx = criarContexto({ instante: new Date('2026-11-19T02:00:00Z') }); // 23:00 em Salvador
  await gravarTrajeto(ctx, { deM: 0, ateM: 400 });
  const e = await ctx.servicos.estado.montar();
  assert.equal(e.status.codigo, 'fora_de_operacao');
  assert.equal(e.status.motivo, 'fora_da_grade');
});
