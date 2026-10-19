// Fechas, horas y dinero en español de México. Sirve en servidor y cliente.

export const TZ = 'America/Mexico_City';
export const LOCALE = 'es-MX';

type DateInput = string | number | Date;
const toDate = (d: DateInput) => (d instanceof Date ? d : new Date(d));

export function fmtDate(d: DateInput, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }, tz = TZ) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: tz, ...opts }).format(toDate(d));
}

/** "jueves 22 de octubre" */
export function fmtDayLong(d: DateInput, tz = TZ) {
  return fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }, tz);
}

/** "jue 22 oct" */
export function fmtDayShort(d: DateInput, tz = TZ) {
  return fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' }, tz).replace(/\./g, '');
}

/** "10:00" */
export function fmtTime(d: DateInput, tz = TZ) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(toDate(d));
}

export function fmtDateTime(d: DateInput, tz = TZ) {
  return `${fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' }, tz)} · ${fmtTime(d, tz)}`;
}

export function money(cents: number | null | undefined) {
  const v = (cents ?? 0) / 100;
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'MXN' }).format(v);
}

/** Convierte "1,250.50" o "1250" a centavos. Devuelve null si no es válido. */
export function parseMoneyToCents(input: string): number | null {
  const clean = input.replace(/[\s$,]/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

function parts(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/** "YYYY-MM-DD" del día local de una fecha. */
export function dateKey(d: DateInput, tz = TZ) {
  const { y, m, d: dd } = parts(toDate(d), tz);
  return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function todayKey(tz = TZ) {
  return dateKey(new Date(), tz);
}

function offsetMinutes(utcMs: number, tz: string) {
  const { y, m, d, h, mi, s } = parts(new Date(utcMs), tz);
  return (Date.UTC(y, m - 1, d, h, mi, s) - utcMs) / 60000;
}

/** Fecha y hora locales ("2026-10-22", "10:00") → instante real. */
export function zonedToDate(day: string, time = '00:00', tz = TZ): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ts = guess - offsetMinutes(guess, tz) * 60000;
  ts = guess - offsetMinutes(ts, tz) * 60000;
  return new Date(ts);
}

export function addDays(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado, para un "YYYY-MM-DD". */
export function weekdayOf(day: string) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Lunes de la semana que contiene el día. */
export function startOfWeek(day: string) {
  const wd = weekdayOf(day);
  return addDays(day, wd === 0 ? -6 : 1 - wd);
}

export function startOfMonth(day: string) {
  return `${day.slice(0, 7)}-01`;
}

export function endOfMonth(day: string) {
  const [y, m] = day.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function isDateKey(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const MODALITY_LABEL: Record<string, string> = { en_linea: 'En línea', presencial: 'Presencial' };

export function minutesLabel(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
