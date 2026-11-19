/** Formatação de datas, horas e distâncias para exibição. */

let fusoPadrao = 'America/Bahia';
export function definirFuso(fuso) { if (fuso) fusoPadrao = fuso; }

export function hora(iso, fuso = fusoPadrao) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export function horaSegundos(iso, fuso = fusoPadrao) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export function dataHora(iso, fuso = fusoPadrao) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

/** "há 25 s", "há 3 min", "há 2 h". */
export function haQuanto(segundos) {
  if (segundos === null || segundos === undefined || !Number.isFinite(segundos)) return '';
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  return `há ${Math.floor(s / 3600)} h`;
}

export function distancia(metros) {
  if (metros === null || metros === undefined || !Number.isFinite(Number(metros))) return '—';
  const m = Number(metros);
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1).replace('.', ',')} km`;
}

export function numero(valor, casas = 1) {
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return '—';
  return Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: casas });
}

/** Valor de <input type="datetime-local"> → ISO com fuso (interpretado no horário do navegador). */
export function localParaIso(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO → valor para <input type="datetime-local"> no horário do navegador. */
export function isoParaLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const ROTULO_STATUS = {
  em_circulacao: 'Em circulação',
  parado: 'Parado',
  sem_dados: 'Sem dados',
  fora_de_operacao: 'Fora de operação',
};

export const COR_STATUS = {
  em_circulacao: 'verde',
  parado: 'ambar',
  sem_dados: 'laranja',
  fora_de_operacao: 'vermelho',
};
