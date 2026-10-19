import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { APPT_SELECT, apptName, type ApptRow } from '@/lib/admin';
import { addDays, dateKey, endOfMonth, fmtDate, fmtDayLong, fmtTime, money, MODALITY_LABEL, startOfMonth, todayKey, zonedToDate } from '@/lib/format';
import { APPOINTMENT_STATUS } from '@/lib/labels';
import { ApptLine } from '@/components/appt-line';
import { Badge, btn, EmptyState } from '@/components/ui';

export const metadata = { title: 'Hoy' };

const PERIODS = {
  mes: 'Este mes',
  anterior: 'Mes anterior',
  '30': 'Últimos 30 días',
} as const;
type Period = keyof typeof PERIODS;

function periodRange(p: Period): [string, string] {
  const t = todayKey();
  if (p === 'anterior') {
    const prev = addDays(startOfMonth(t), -1);
    return [startOfMonth(prev), endOfMonth(prev)];
  }
  if (p === '30') return [addDays(t, -29), t];
  return [startOfMonth(t), t];
}

function greeting() {
  const h = Number(fmtTime(new Date()).slice(0, 2));
  return h < 12 ? 'Buenos días.' : h < 19 ? 'Buenas tardes.' : 'Buenas noches.';
}

export default async function HoyPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const period: Period = sp.periodo && sp.periodo in PERIODS ? (sp.periodo as Period) : 'mes';
  const [pFrom, pTo] = periodRange(period);

  const today = todayKey();
  const now = new Date().toISOString();
  const dayStart = zonedToDate(today).toISOString();
  const dayEnd = zonedToDate(addDays(today, 1)).toISOString();
  const weekEnd = zonedToDate(addDays(today, 7)).toISOString();
  const since = new Date(Date.now() - 14 * 86400000).toISOString();

  const [todayQ, nextQ, pendingQ, weekQ, changesQ, activeQ, totalQ, balancesQ, unconfirmedQ, finance] = await Promise.all([
    supabase.from('appointments').select(APPT_SELECT).gte('starts_at', dayStart).lt('starts_at', dayEnd).neq('status', 'reprogramada').order('starts_at'),
    supabase
      .from('appointments')
      .select(APPT_SELECT + ',location_details')
      .in('status', ['confirmada', 'pendiente'])
      .gt('ends_at', now)
      .order('starts_at')
      .limit(1)
      .maybeSingle(),
    supabase.from('appointments').select(APPT_SELECT, { count: 'exact' }).eq('status', 'pendiente').gt('starts_at', now).order('starts_at').limit(5),
    supabase.from('appointments').select('starts_at,status').in('status', ['confirmada', 'pendiente']).gte('starts_at', dayStart).lt('starts_at', weekEnd),
    supabase
      .from('appointments')
      .select(APPT_SELECT + ',updated_at,cancelled_by')
      .in('status', ['cancelada', 'reprogramada'])
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
      .limit(5),
    supabase.from('patients').select('id', { count: 'exact', head: true }).eq('status', 'activo'),
    supabase.from('patients').select('id', { count: 'exact', head: true }),
    supabase.from('patient_balances').select('balance_cents').gt('balance_cents', 0),
    supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'por_confirmar'),
    supabase.rpc('admin_finance_summary', { p_from: pFrom, p_to: pTo }).single(),
  ]);

  const todays = (todayQ.data ?? []) as unknown as ApptRow[];
  const next = nextQ.data as unknown as (ApptRow & { location_details: string | null }) | null;
  const pending = (pendingQ.data ?? []) as unknown as ApptRow[];
  const changes = (changesQ.data ?? []) as unknown as Array<ApptRow & { updated_at: string; cancelled_by: string | null }>;
  const owed = (balancesQ.data ?? []).reduce((s, r) => s + Number(r.balance_cents), 0);
  const owedCount = (balancesQ.data ?? []).length;
  const fin = finance.data as { income_cents: number; payments_count: number; unconfirmed_cents: number } | null;

  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const weekCount = new Map<string, number>();
  for (const r of weekQ.data ?? []) {
    const k = dateKey(r.starts_at as string);
    weekCount.set(k, (weekCount.get(k) ?? 0) + 1);
  }
  const maxWeek = Math.max(1, ...weekCount.values());
  const todayActive = todays.filter((a) => a.status !== 'cancelada');
  const noon = (k: string) => new Date(k + 'T18:00:00Z');
  const isNow = next && new Date(next.starts_at).getTime() <= Date.now();

  return (
    <div className="grid gap-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-[15px] text-tenue">{greeting()}</p>
          <h1 className="display mt-1 text-[clamp(38px,6.4vw,58px)]">{fmtDayLong(new Date()).replace(/^./, (c) => c.toUpperCase())}</h1>
          <p className="mt-2 text-[15px] text-tenue">
            {todayActive.length === 0
              ? 'No tienes sesiones hoy.'
              : todayActive.length === 1
                ? 'Tienes una sesión hoy.'
                : `Tienes ${todayActive.length} sesiones hoy.`}
          </p>
        </div>
        <form action="/admin/pacientes" role="search" className="flex w-full max-w-sm gap-2 sm:w-auto">
          <label htmlFor="buscar" className="sr-only">
            Buscar expediente
          </label>
          <input id="buscar" name="q" type="search" placeholder="Nombre o LS-0001" className="field" maxLength={80} />
          <button type="submit" className={btn('secondary')}>
            Buscar
          </button>
        </form>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {/* Próxima sesión */}
          <section aria-labelledby="proxima" className="relative isolate overflow-hidden rounded-[28px] bg-noche p-6 text-[#efeaf6] sm:p-8">
            <div
              aria-hidden
              className="absolute -right-16 -top-24 -z-10 size-72 rounded-full bg-[radial-gradient(circle,rgb(255_246_226/0.55),rgb(228_220_248/0.25)_35%,transparent_68%)]"
            />
            <h2 id="proxima" className="text-[14px] text-[#c9c4d6]">
              {isNow ? 'Sesión en curso' : 'Próxima sesión'}
            </h2>
            {next ? (
              <>
                <p className="display mt-3 text-[clamp(44px,8vw,68px)] leading-none tabular-nums">{fmtTime(next.starts_at)}</p>
                <p className="mt-1 text-[15px] text-[#c9c4d6]">
                  {dateKey(next.starts_at) === today ? 'Hoy' : fmtDayLong(next.starts_at).replace(/^./, (c) => c.toUpperCase())}
                </p>
                <p className="display mt-5 text-[30px] leading-tight">{apptName(next)}</p>
                <p className="mt-1 text-[15px] text-[#c9c4d6]">
                  {next.service?.name} · {MODALITY_LABEL[next.modality]}
                  {next.status === 'pendiente' ? ' · por confirmar' : ''}
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <Link
                    href={`/admin/agenda/${next.id}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-full px-5 text-[15px] font-medium transition-colors active:scale-[0.97] border border-white/30 bg-white/10 text-[#f6f3ee] hover:bg-white/20"
                  >
                    Abrir cita
                  </Link>
                  {next.patient && (
                    <Link
                      href={`/admin/pacientes/${next.patient.id}`}
                      className="inline-flex min-h-11 items-center justify-center rounded-full px-5 text-[15px] font-medium transition-colors active:scale-[0.97] text-[#efeaf6] hover:bg-white/10"
                    >
                      Expediente
                    </Link>
                  )}
                  {next.modality === 'en_linea' && next.location_details && /^https?:\/\//.test(next.location_details) && (
                    <a
                      href={next.location_details}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center justify-center rounded-full px-5 text-[15px] font-medium transition-colors active:scale-[0.97] text-[#efeaf6] hover:bg-white/10"
                    >
                      Entrar a la videollamada
                    </a>
                  )}
                </div>
              </>
            ) : (
              <p className="display mt-3 text-[32px]">Sin sesiones próximas.</p>
            )}
          </section>

          {/* Hoy */}
          <section aria-labelledby="hoy" className="min-w-0">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="hoy" className="display text-[28px]">
                Hoy
              </h2>
              <Link href={`/admin/agenda?vista=dia&fecha=${today}`} className="link text-[14px]">
                Ver día
              </Link>
            </div>
            {todays.length ? (
              <ul className="panel divide-y divide-linea">
                {todays.map((a) => (
                  <ApptLine key={a.id} a={a} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Un día sin sesiones.">
                <p>Buen momento para revisar expedientes o descansar.</p>
              </EmptyState>
            )}
          </section>

          {/* Por confirmar */}
          <section aria-labelledby="porconfirmar" className="min-w-0">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="porconfirmar" className="display text-[28px]">
                Por confirmar {(pendingQ.count ?? 0) > 0 && <span className="text-tenue">· {pendingQ.count}</span>}
              </h2>
            </div>
            {pending.length ? (
              <ul className="panel divide-y divide-linea">
                {pending.map((a) => (
                  <ApptLine key={a.id} a={a} showDate />
                ))}
              </ul>
            ) : (
              <p className="text-[15px] text-tenue">No hay solicitudes pendientes.</p>
            )}
          </section>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {/* Semana */}
          <section aria-labelledby="semana" className="panel p-5 sm:p-6">
            <h2 id="semana" className="display mb-4 text-[26px]">
              Próximos 7 días
            </h2>
            <ol className="grid grid-cols-7 items-end gap-1.5">
              {week.map((d) => {
                const n = weekCount.get(d) ?? 0;
                return (
                  <li key={d}>
                    <Link
                      href={`/admin/agenda?vista=dia&fecha=${d}`}
                      className="flex flex-col items-center gap-1.5 rounded-xl py-1 hover:bg-white"
                      aria-label={`${fmtDate(noon(d), { weekday: 'long', day: 'numeric' })}: ${n} sesiones`}
                    >
                      <span className="text-[13px] font-medium tabular-nums">{n || ''}</span>
                      <span className="flex h-16 w-full items-end justify-center">
                        <span
                          className={`w-3 rounded-full ${n ? 'bg-lavanda-700/70' : 'bg-linea'}`}
                          style={{ height: n ? `${Math.max(18, (n / maxWeek) * 100)}%` : '6px' }}
                        />
                      </span>
                      <span className={`text-[12px] capitalize ${d === today ? 'font-medium text-tinta' : 'text-tenue'}`}>
                        {fmtDate(noon(d), { weekday: 'short' }).replace('.', '').slice(0, 3)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* Resumen */}
          <section aria-labelledby="resumen" className="panel p-5 sm:p-6">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="resumen" className="display text-[26px]">
                Resumen
              </h2>
              <nav aria-label="Periodo" className="flex gap-1">
                {(['mes', 'anterior', '30'] as Period[]).map((p) => (
                  <Link
                    key={p}
                    href={`/admin?periodo=${p}`}
                    aria-current={p === period ? 'true' : undefined}
                    className={`rounded-full px-2.5 py-1 text-[12.5px] ${p === period ? 'bg-tinta text-hueso' : 'text-tenue hover:bg-[rgb(37_38_44/0.06)]'}`}
                  >
                    {PERIODS[p]}
                  </Link>
                ))}
              </nav>
            </div>
            <dl className="divide-y divide-linea">
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="text-[14.5px] text-tenue">Ingresos recibidos</dt>
                <dd className="text-right">
                  <span className="display text-[26px] tabular-nums">{money(fin?.income_cents)}</span>
                  <span className="block text-[12.5px] text-tenue">{fin?.payments_count ?? 0} pagos confirmados</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="text-[14.5px] text-tenue">Pagos pendientes</dt>
                <dd className="text-right">
                  <Link href="/admin/pagos" className="text-[17px] tabular-nums hover:underline">
                    {money(owed)}
                  </Link>
                  <span className="block text-[12.5px] text-tenue">
                    {owedCount} {owedCount === 1 ? 'paciente' : 'pacientes'}
                    {(unconfirmedQ.count ?? 0) > 0 ? ` · ${unconfirmedQ.count} por confirmar` : ''}
                  </span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="text-[14.5px] text-tenue">Pacientes activos</dt>
                <dd className="text-right">
                  <Link href="/admin/pacientes?estado=activo" className="text-[17px] tabular-nums hover:underline">
                    {activeQ.count ?? 0}
                  </Link>
                  <span className="block text-[12.5px] text-tenue">{totalQ.count ?? 0} registrados</span>
                </dd>
              </div>
            </dl>
          </section>

          {/* Accesos */}
          <section aria-label="Accesos rápidos" className="flex flex-wrap gap-2">
            <Link href="/admin/pacientes/nuevo" className={btn('primary')}>
              Registrar paciente
            </Link>
            <Link href="/admin/agenda/nueva" className={btn('secondary')}>
              Agendar cita
            </Link>
          </section>

          {/* Cambios */}
          {changes.length > 0 && (
            <section aria-labelledby="cambios" className="min-w-0">
              <h2 id="cambios" className="display mb-3 text-[24px]">
                Cambios recientes
              </h2>
              <ul className="grid gap-2">
                {changes.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/admin/agenda/${c.id}`}
                      className="flex items-center justify-between gap-3 rounded-2xl px-1 py-1.5 text-[14.5px] hover:bg-white/60"
                    >
                      <span className="min-w-0 truncate">
                        {apptName(c)} ·{' '}
                        <span className="text-tenue">
                          {fmtDate(c.starts_at, { day: 'numeric', month: 'short' })} {fmtTime(c.starts_at)}
                        </span>
                      </span>
                      <Badge tone={APPOINTMENT_STATUS[c.status]!.tone} className="shrink-0">
                        {c.status === 'cancelada' && c.cancelled_by === 'paciente' ? 'Canceló el paciente' : APPOINTMENT_STATUS[c.status]!.label}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
