'use strict';

/**
 * Utilitários de data/hora com fuso explícito (padrão: America/Bahia).
 * A grade de horários é comparada no horário local configurado, nunca no fuso do servidor.
 */

const formatadores = new Map();

function formatador(fuso, opcoes) {
  const chave = `${fuso}|${JSON.stringify(opcoes)}`;
  if (!formatadores.has(chave)) {
    formatadores.set(chave, new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hourCycle: 'h23', ...opcoes }));
  }
  return formatadores.get(chave);
}

function partes(data, fuso, opcoes) {
  const resultado = {};
  for (const p of formatador(fuso, opcoes).formatToParts(data)) {
    if (p.type !== 'literal') resultado[p.type] = p.value;
  }
  return resultado;
}

/** Minutos decorridos desde 00:00 no fuso informado (com fração de segundos). */
function minutosDoDia(data, fuso) {
  const p = partes(data, fuso, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60;
}

/** Converte 'HH:MM' ou 'HH:MM:SS' em minutos do dia. */
function horarioParaMinutos(horario) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(horario || '').trim());
  if (!m) throw new Error(`Horário inválido: ${horario}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3] || 0);
  if (h > 23 || min > 59 || s > 59) throw new Error(`Horário inválido: ${horario}`);
  return h * 60 + min + s / 60;
}

/** Verdadeiro se `data` está em [inicio, fim) no horário local. Janelas não atravessam a meia-noite. */
function dentroDaJanela(data, inicio, fim, fuso) {
  const agora = minutosDoDia(data, fuso);
  return agora >= horarioParaMinutos(inicio) && agora < horarioParaMinutos(fim);
}

function formatarHora(data, fuso) {
  if (!data) return null;
  const p = partes(new Date(data), fuso, { hour: '2-digit', minute: '2-digit' });
  return `${p.hour}:${p.minute}`;
}

function formatarDataHora(data, fuso) {
  if (!data) return null;
  const p = partes(new Date(data), fuso, {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** 'HH:MM:SS' vindo do PostgreSQL → 'HH:MM'. */
function horarioCurto(horario) {
  return String(horario || '').slice(0, 5);
}

module.exports = {
  minutosDoDia,
  horarioParaMinutos,
  dentroDaJanela,
  formatarHora,
  formatarDataHora,
  horarioCurto,
};
