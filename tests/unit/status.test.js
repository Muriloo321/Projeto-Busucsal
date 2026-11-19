'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularStatus, avisoVigente, proximoParadoDesde, rotasNaGrade } = require('../../server/domain/status');
const { dentroDaJanela, formatarHora } = require('../../server/domain/tempo');

const FUSO = 'America/Bahia';
const P = { limiteDadosVencidosS: 180, tempoParadoMin: 5 };
const ROTAS = [{ id: 1, ativa: true, horario_inicio: '06:30', horario_fim: '22:40' }];
const agora = new Date('2026-11-18T13:00:00Z'); // 10:00 em Salvador
const antes = (s) => new Date(agora.getTime() - s * 1000);

const status = (extra) => calcularStatus({ agora, rotas: ROTAS, avisos: [], ultimaAtualizacao: antes(20), paradoDesde: null, parametros: P, fuso: FUSO, ...extra });

test('em circulação: posição recente e em movimento', () => {
  const s = status();
  assert.equal(s.codigo, 'em_circulacao');
  assert.equal(s.rotulo, 'Em circulação');
});

test('sem dados: última posição com mais de 3 minutos', () => {
  assert.equal(status({ ultimaAtualizacao: antes(180) }).codigo, 'em_circulacao'); // exatamente 3 min ainda vale
  const s = status({ ultimaAtualizacao: antes(181) });
  assert.equal(s.codigo, 'sem_dados');
  assert.equal(s.motivo, 'posicao_vencida');
  assert.equal(status({ ultimaAtualizacao: null }).motivo, 'nenhuma_posicao');
});

test('parado: velocidade perto de zero por MAIS de 5 minutos, com rastreador enviando', () => {
  assert.equal(status({ paradoDesde: antes(300) }).codigo, 'em_circulacao');
  const s = status({ paradoDesde: antes(301) });
  assert.equal(s.codigo, 'parado');
  assert.equal(s.parado_ha_s, 301);
  // Se o rastreador parou de enviar, prevalece "sem dados".
  assert.equal(status({ paradoDesde: antes(900), ultimaAtualizacao: antes(600) }).codigo, 'sem_dados');
});

test('fora de operação: fora da grade de horários (no fuso de Salvador)', () => {
  const madrugada = new Date('2026-11-18T08:00:00Z'); // 05:00 em Salvador
  const s = calcularStatus({ agora: madrugada, rotas: ROTAS, avisos: [], ultimaAtualizacao: madrugada, parametros: P, fuso: FUSO });
  assert.equal(s.codigo, 'fora_de_operacao');
  assert.equal(s.motivo, 'fora_da_grade');
  const noite = new Date('2026-11-19T01:45:00Z'); // 22:45 em Salvador
  assert.equal(calcularStatus({ agora: noite, rotas: ROTAS, avisos: [], ultimaAtualizacao: noite, parametros: P, fuso: FUSO }).codigo, 'fora_de_operacao');
  assert.equal(status({ rotas: [{ ...ROTAS[0], ativa: false }] }).codigo, 'fora_de_operacao');
});

test('fora de operação: aviso de interrupção vigente tem prioridade', () => {
  const interrupcao = { id: 7, ativo: true, interrompe_operacao: true, inicio: antes(60), fim: new Date(agora.getTime() + 3600e3) };
  const s = status({ avisos: [interrupcao] });
  assert.equal(s.codigo, 'fora_de_operacao');
  assert.equal(s.motivo, 'aviso_interrupcao');
  assert.equal(s.aviso_id, 7);
  assert.equal(status({ avisos: [{ ...interrupcao, ativo: false }] }).codigo, 'em_circulacao');
  assert.equal(status({ avisos: [{ ...interrupcao, fim: antes(1) }] }).codigo, 'em_circulacao');
  assert.equal(status({ avisos: [{ ...interrupcao, interrompe_operacao: false }] }).codigo, 'em_circulacao');
});

test('vigência do aviso é [início, fim)', () => {
  const a = { ativo: true, inicio: agora, fim: new Date(agora.getTime() + 1000) };
  assert.equal(avisoVigente(a, agora), true);
  assert.equal(avisoVigente(a, new Date(agora.getTime() + 1000)), false);
  assert.equal(avisoVigente({ ...a, ativo: false }, agora), false);
});

test('parado_desde só começa com velocidade perto de zero e zera ao voltar a andar', () => {
  const t0 = antes(60);
  assert.deepEqual(proximoParadoDesde(null, 0, t0, 3), t0);
  assert.deepEqual(proximoParadoDesde(t0, 2.5, agora, 3), t0);
  assert.equal(proximoParadoDesde(t0, 15, agora, 3), null);
  assert.deepEqual(proximoParadoDesde(t0, null, agora, 3), t0); // velocidade não informada não muda nada
  assert.equal(proximoParadoDesde(null, undefined, agora, 3), null);
});

test('grade de horários e formatação respeitam o fuso configurado', () => {
  assert.equal(dentroDaJanela(agora, '06:30', '22:40', FUSO), true);
  assert.equal(dentroDaJanela(agora, '10:00', '10:01', FUSO), true);
  assert.equal(dentroDaJanela(agora, '06:30', '10:00', FUSO), false); // fim exclusivo
  assert.equal(formatarHora(agora, FUSO), '10:00');
  assert.deepEqual(rotasNaGrade(ROTAS, agora, FUSO).map((r) => r.id), [1]);
});
