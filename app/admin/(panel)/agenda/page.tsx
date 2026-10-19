import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { APPT_SELECT, apptName, type ApptRow } from '@/lib/admin';
import { APPOINTMENT_STATUS, type Tone } from '@/lib/labels';
import { addDays, dateKey, endOfMonth, fmtDate, fmtTime, isDateKey, startOfMonth, startOfWeek, todayKey, zonedToDate, MODALITY_LABEL } from '@/lib/format';
import { Badge, btn, EmptyState, PageHeader } from '@/components/ui';
import { ApptLine } from '@/components/appt-line';

export const metadata = { title: 'Agenda' };

type View = 'dia' | 'semana' | 'mes';
type TimeOff = { id: string; starts_at: string; ends_at: string; reason: string | null };

const TONE_BLOCK: Record<Tone, string> = {
  ocre: 'bg-ocre-50 text-ocre-700 border-ocre-700/30',
  lavanda: 'bg-lavanda-50 text-lavanda-700 border-lavanda-700/30',
  salvia: 'bg-salvia-50 text-salvia-700 border-salvia-700/30',
  rosa: 'bg-rosa-50 text-rosa-700 border-rosa-700/25 line-through decoration-1',
  pizarra: 'bg-pizarra-50 text-pizarra-700 border-pizarra-700/25',
  neutro: 'bg-[rgb(37_38_44/0.05)] text-tenue border-linea',
};

const noon = (k: string) => new Date(k + 'T18:00:00Z');

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const view: View = sp.vista === 'dia' || sp.vista === 'mes' ? sp.vista : 'semana';
  const day = isDateKey(sp.fecha) ? sp.fecha : todayKey();
  const showCancelled = sp.canceladas === '1';

  let from: string;
  let to: string; // exclusivo
  if (view === 'dia') {
    from = day;
    to = addDays(day, 1);
  } else if (view === 'semana') {
    from = startOfWeek(day);
    to = addDays(from, 7);
  } else {
    from = startOfWeek(startOfMonth(day));
    to = addDays(startOfWeek(endOfMonth(day)), 7);
  }
  const fromTs = zonedToDate(from).toISOString();
  const toTs = zonedToDate(to).toISOString();

  let q = supabase.from('appointments').select(APPT_SELECT).gte('starts_at', fromTs).lt('starts_at', toTs).order('starts_at');
  q = showCancelled ? q.neq('status', 'reprogramada') : q.not('status', 'in', '(cancelada,reprogramada)');
  const [{ data: appts }, { data: offs }, { data: rules }] = await Promise.all([
    q,
    supabase.from('time_off').select('id,starts_at,ends_at,reason').lt('starts_at', toTs).gt('ends_at', fromTs).order('starts_at'),
    supabase.from('availability_rules').select('weekday,start_time,end_time').eq('active', true),
  ]);
  const list = (appts ?? []) as unknown as ApptRow[];
  const timeOff = (offs ?? []) as TimeOff[];

  const byDay = new Map<string, ApptRow[]>();
  for (const a of list) {
    const k = dateKey(a.starts_at);
    byDay.set(k, [...(byDay.get(k) ?? []), a]);
  }

  // Rango horario visible: el de la disponibilidad (con margen) o 8–20.
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const ruleMins = (rules ?? []).flatMap((r) => [toMin(r.start_time as string), toMin(r.end_time as string)]);
  const apptMins = list.flatMap((a) => [toMin(fmtTime(a.starts_at)), toMin(fmtTime(a.ends_at))]);
  const startH = Math.max(0, Math.floor(Math.min(8 * 60, ...ruleMins, ...apptMins) / 60));
  const endH = Math.min(24, Math.ceil(Math.max(20 * 60, ...ruleMins, ...apptMins) / 60));

  const step = view === 'dia' ? 1 : view === 'semana' ? 7 : 0;
  const prev = view === 'mes' ? addDays(startOfMonth(day), -1) : addDays(day, -step);
  const next = view === 'mes' ? addDays(endOfMonth(day), 1) : addDays(day, step);
  const href = (p: Record<string, string>) => {
    const u = new URLSearchParams({ vista: view, fecha: day, ...(showCancelled ? { canceladas: '1' } : {}), ...p });
    return `/admin/agenda?${u.toString()}`;
  };

  const title =
    view === 'dia'
      ? fmtDate(noon(day), { weekday: 'long', day: 'numeric', month: 'long' })
      : view === 'semana'
        ? `${fmtDate(noon(from), { day: 'numeric', month: 'short' })} – ${fmtDate(noon(addDays(from, 6)), { day: 'numeric', month: 'short', year: 'numeric' })}`
        : fmtDate(noon(day), { month: 'long', year: 'numeric' });

  const pendingCount = list.filter((a) => a.status === 'pendiente').length;

  return (
    <>
      <PageHeader
        title={<>{title.charAt(0).toUpperCase() + title.slice(1)}</>}
        subtitle={
          <>
            {list.filter((a) => a.status !== 'cancelada').length} citas en este periodo
            {pendingCount > 0 && <> · {pendingCount} por confirmar</>}
          </>
        }
        actions={
          <Link href={`/admin/agenda/nueva?fecha=${day}`} className={btn('primary')}>
            Agendar cita
          </Link>
        }
      />

      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Vista" className="inline-flex rounded-full border border-linea-fuerte bg-superficie p-1">
          {(['dia', 'semana', 'mes'] as const).map((v) => (
            <Link
              key={v}
              href={`/admin/agenda?${new URLSearchParams({ vista: v, fecha: day, ...(showCancelled ? { canceladas: '1' } : {}) })}`}
              aria-current={view === v ? 'page' : undefined}
              className={`inline-flex min-h-9 items-center rounded-full px-4 text-[14px] transition-colors ${view === v ? 'bg-tinta text-hueso' : 'hover:bg-[rgb(37_38_44/0.06)]'}`}
            >
              {v === 'dia' ? 'Día' : v === 'semana' ? 'Semana' : 'Mes'}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Link href={href({ fecha: prev })} className={btn('quiet', 'sm')} aria-label="Anterior">
            ←
          </Link>
          <Link href={href({ fecha: todayKey() })} className={btn('secondary', 'sm')}>
            Hoy
          </Link>
          <Link href={href({ fecha: next })} className={btn('quiet', 'sm')} aria-label="Siguiente">
            →
          </Link>
          <Link href={href({ canceladas: showCancelled ? '0' : '1' })} className={btn('quiet', 'sm', 'ml-2')}>
            {showCancelled ? 'Ocultar canceladas' : 'Ver canceladas'}
          </Link>
        </div>
      </div>

      {view === 'mes' ? (
        <MonthGrid from={from} to={to} month={day.slice(0, 7)} byDay={byDay} timeOff={timeOff} />
      ) : (
        <>
          <div className="hidden md:block">
            <TimeGrid
              days={Array.from({ length: view === 'dia' ? 1 : 7 }, (_, i) => addDays(from, i))}
              byDay={byDay}
              timeOff={timeOff}
              startH={startH}
              endH={endH}
            />
          </div>
          <div className="md:hidden">
            <DayList days={Array.from({ length: view === 'dia' ? 1 : 7 }, (_, i) => addDays(from, i))} byDay={byDay} timeOff={timeOff} />
          </div>
        </>
      )}

      <ul className="mt-6 flex flex-wrap gap-2" aria-label="Estados">
        {(['pendiente', 'confirmada', 'completada', 'no_asistio', 'cancelada'] as const).map((s) => (
          <li key={s}>
            <Badge tone={APPOINTMENT_STATUS[s]!.tone}>{APPOINTMENT_STATUS[s]!.label}</Badge>
          </li>
        ))}
      </ul>
    </>
  );
}

function offsFor(day: string, offs: TimeOff[]) {
  const s = zonedToDate(day).getTime();
  const e = zonedToDate(addDays(day, 1)).getTime();
  return offs.filter((o) => new Date(o.starts_at).getTime() < e && new Date(o.ends_at).getTime() > s);
}

function TimeGrid({ days, byDay, timeOff, startH, endH }: { days: string[]; byDay: Map<string, ApptRow[]>; timeOff: TimeOff[]; startH: number; endH: number }) {
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
  const total = (endH - startH) * 60;
  const HOUR_PX = 64;
  const today = todayKey();
  const pos = (iso: string, dayStart: number) => ((new Date(iso).getTime() - dayStart) / 60000 - startH * 60) / total;

  return (
    <div className="panel overflow-hidden">
      <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="border-b border-linea" />
        {days.map((d) => (
          <Link
            key={d}
            href={`/admin/agenda?vista=dia&fecha=${d}`}
            className={`flex min-h-14 flex-col items-center justify-center border-b border-l border-linea text-center hover:bg-white/60 ${d === today ? 'text-lavanda-700' : ''}`}
          >
            <span className="text-[12.5px] capitalize">{fmtDate(noon(d), { weekday: 'short' }).replace('.', '')}</span>
            <span className={`display text-[24px] leading-none ${d === today ? 'rounded-full bg-lavanda px-2' : ''}`}>
              {fmtDate(noon(d), { day: 'numeric' })}
            </span>
          </Link>
        ))}

        <div className="relative" style={{ height: hours.length * HOUR_PX }}>
          {hours.map((h, i) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-[12px] tabular-nums text-tenue" style={{ top: i * HOUR_PX }}>
              {i === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
            </span>
          ))}
        </div>
        {days.map((d) => {
          const dayStart = zonedToDate(d).getTime();
          const items = byDay.get(d) ?? [];
          return (
            <div key={d} className="relative border-l border-linea" style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h, i) => (
                <div key={h} className="absolute inset-x-0 border-t border-linea" style={{ top: i * HOUR_PX }} />
              ))}
              {offsFor(d, timeOff).map((o) => {
                const top = Math.max(0, pos(o.starts_at, dayStart));
                const bottom = Math.min(1, pos(o.ends_at, dayStart));
                return (
                  <div
                    key={o.id}
                    className="absolute inset-x-0 bg-[repeating-linear-gradient(135deg,rgb(37_38_44/0.05)_0_6px,transparent_6px_12px)]"
                    style={{ top: `${top * 100}%`, height: `${Math.max(0, bottom - top) * 100}%` }}
                    title={`No disponible${o.reason ? `: ${o.reason}` : ''}`}
                  >
                    <span className="m-1 inline-block rounded-md bg-hueso/90 px-1.5 text-[11.5px] text-tenue">No disponible</span>
                  </div>
                );
              })}
              {items.map((a) => {
                const st = APPOINTMENT_STATUS[a.status] ?? { label: a.status, tone: 'neutro' as Tone };
                const top = pos(a.starts_at, dayStart);
                const height = pos(a.ends_at, dayStart) - top;
                return (
                  <Link
                    key={a.id}
                    href={`/admin/agenda/${a.id}`}
                    className={`absolute inset-x-1 overflow-hidden rounded-xl border px-2 py-1 text-[12.5px] leading-tight transition-transform hover:z-10 hover:scale-[1.02] ${TONE_BLOCK[st.tone]}`}
                    style={{ top: `${top * 100}%`, height: `${Math.max(height * 100, 4)}%` }}
                    aria-label={`${fmtTime(a.starts_at)}, ${apptName(a)}, ${st.label}`}
                  >
                    <span className="block font-medium tabular-nums">{fmtTime(a.starts_at)}</span>
                    <span className="block truncate text-tinta">{apptName(a)}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayList({ days, byDay, timeOff }: { days: string[]; byDay: Map<string, ApptRow[]>; timeOff: TimeOff[] }) {
  const any = days.some((d) => (byDay.get(d) ?? []).length);
  if (!any && days.length === 1)
    return (
      <EmptyState title="Sin citas este día.">
        <p>Puedes agendar una desde el botón “Agendar cita”.</p>
      </EmptyState>
    );
  return (
    <div className="grid grid-cols-1 gap-5">
      {days.map((d) => {
        const items = byDay.get(d) ?? [];
        const offs = offsFor(d, timeOff);
        return (
          <section key={d} aria-labelledby={`d-${d}`} className="min-w-0">
            <h2 id={`d-${d}`} className="mb-2 flex items-baseline gap-2">
              <span className="display text-[24px] capitalize">{fmtDate(noon(d), { weekday: 'long' })}</span>
              <span className="text-[14px] text-tenue">{fmtDate(noon(d), { day: 'numeric', month: 'long' })}</span>
            </h2>
            {offs.length > 0 && <p className="mb-2 rounded-xl bg-[rgb(37_38_44/0.05)] px-3 py-2 text-[14px] text-tenue">No disponible en parte del día</p>}
            {items.length ? (
              <ul className="panel divide-y divide-linea">
                {items.map((a) => (
                  <ApptLine key={a.id} a={a} />
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-tenue">Sin citas</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MonthGrid({ from, to, month, byDay, timeOff }: { from: string; to: string; month: string; byDay: Map<string, ApptRow[]>; timeOff: TimeOff[] }) {
  const days: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
  const today = todayKey();
  const heads = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  return (
    <div className="panel overflow-hidden">
      <div className="grid grid-cols-7 border-b border-linea">
        {heads.map((h) => (
          <div key={h} className="py-2 text-center text-[12.5px] text-tenue">
            {h}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const items = byDay.get(d) ?? [];
          const inMonth = d.startsWith(month);
          const off = offsFor(d, timeOff).length > 0;
          return (
            <Link
              key={d}
              href={`/admin/agenda?vista=dia&fecha=${d}`}
              className={`min-h-[92px] border-linea p-1.5 transition-colors hover:bg-white/70 sm:min-h-[118px] sm:p-2 ${i % 7 ? 'border-l' : ''} ${i >= 7 ? 'border-t' : ''} ${
                inMonth ? '' : 'bg-[rgb(37_38_44/0.025)] text-tenue'
              } ${off ? 'bg-[repeating-linear-gradient(135deg,rgb(37_38_44/0.04)_0_6px,transparent_6px_12px)]' : ''}`}
              aria-label={`${fmtDate(noon(d), { weekday: 'long', day: 'numeric', month: 'long' })}: ${items.length} citas`}
            >
              <span
                className={`inline-flex size-7 items-center justify-center rounded-full text-[14px] ${d === today ? 'bg-lavanda font-medium text-tinta' : ''}`}
              >
                {Number(d.slice(8))}
              </span>
              <ul className="mt-1 hidden gap-0.5 sm:grid">
                {items.slice(0, 3).map((a) => {
                  const st = APPOINTMENT_STATUS[a.status]!;
                  return (
                    <li key={a.id} className={`truncate rounded-md border px-1.5 text-[12px] leading-5 ${TONE_BLOCK[st.tone]}`}>
                      <span className="tabular-nums">{fmtTime(a.starts_at)}</span> <span className="text-tinta">{apptName(a).split(' ')[0]}</span>
                    </li>
                  );
                })}
                {items.length > 3 && <li className="px-1.5 text-[12px] text-tenue">+{items.length - 3} más</li>}
              </ul>
              {items.length > 0 && (
                <span className="mt-1 flex gap-0.5 sm:hidden" aria-hidden>
                  {items.slice(0, 4).map((a) => (
                    <span
                      key={a.id}
                      className={`size-1.5 rounded-full ${a.status === 'pendiente' ? 'bg-ocre-700' : a.status === 'completada' ? 'bg-salvia-700' : 'bg-lavanda-700'}`}
                    />
                  ))}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
