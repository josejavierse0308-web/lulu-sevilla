import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '@/lib/labels';
import { addDays, endOfMonth, fmtDate, isDateKey, money, startOfMonth, todayKey } from '@/lib/format';
import { ActionForm } from '@/components/forms';
import { Badge, btn, EmptyState, PageHeader, Section } from '@/components/ui';
import { Icon } from '@/components/icons';
import { confirmarPago } from './actions';

export const metadata = { title: 'Pagos' };

type Pay = {
  id: string;
  patient_id: string;
  amount_cents: number;
  paid_on: string;
  method: string;
  status: string;
  reference: string | null;
  patient: { full_name: string; internal_code: string } | null;
};

const PRESETS: Array<[string, string]> = [
  ['mes', 'Este mes'],
  ['anterior', 'Mes anterior'],
  ['anio', 'Este año'],
];

export default async function PagosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const t = todayKey();
  let from = startOfMonth(t);
  let to = t;
  let preset = sp.periodo ?? 'mes';
  if (preset === 'anterior') {
    const prev = addDays(startOfMonth(t), -1);
    from = startOfMonth(prev);
    to = endOfMonth(prev);
  } else if (preset === 'anio') {
    from = `${t.slice(0, 4)}-01-01`;
  } else if (isDateKey(sp.desde) && isDateKey(sp.hasta) && sp.desde <= sp.hasta) {
    from = sp.desde;
    to = sp.hasta;
    preset = 'personalizado';
  }
  const sixMonthsAgo = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 6, 1)).toISOString().slice(0, 10);

  const [summary, { data: unconfirmed }, { data: periodPays }, { data: balances }, { data: history }] = await Promise.all([
    supabase.rpc('admin_finance_summary', { p_from: from, p_to: to }).single(),
    supabase
      .from('payments')
      .select('id,patient_id,amount_cents,paid_on,method,status,reference,patient:patients(full_name,internal_code)')
      .eq('status', 'por_confirmar')
      .order('paid_on'),
    supabase
      .from('payments')
      .select('id,patient_id,amount_cents,paid_on,method,status,reference,patient:patients(full_name,internal_code)')
      .gte('paid_on', from)
      .lte('paid_on', to)
      .neq('status', 'anulado')
      .order('paid_on', { ascending: false })
      .limit(300),
    supabase.from('patient_balances').select('patient_id,balance_cents').gt('balance_cents', 0).order('balance_cents', { ascending: false }).limit(100),
    supabase.from('payments').select('amount_cents,paid_on').eq('status', 'confirmado').gte('paid_on', sixMonthsAgo),
  ]);
  const s = summary.data as {
    income_cents: number;
    payments_count: number;
    unconfirmed_cents: number;
    charged_cents: number;
    outstanding_cents: number;
  } | null;

  const ids = (balances ?? []).map((b) => b.patient_id as string);
  const { data: names } = ids.length ? await supabase.from('patients').select('id,full_name,internal_code').in('id', ids) : { data: [] };
  const nameOf = new Map((names ?? []).map((n) => [n.id as string, n]));

  // Ingresos por mes (últimos 6), para una gráfica discreta.
  const [ty, tm] = t.split('-').map(Number) as [number, number];
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(ty, tm - 1 - (5 - i), 1));
    return d.toISOString().slice(0, 7);
  });
  const byMonth = new Map<string, number>(months.map((m) => [m, 0]));
  for (const h of history ?? []) {
    const k = (h.paid_on as string).slice(0, 7);
    if (byMonth.has(k)) byMonth.set(k, (byMonth.get(k) ?? 0) + Number(h.amount_cents));
  }
  const maxMonth = Math.max(1, ...byMonth.values());

  return (
    <>
      <PageHeader title="Pagos" subtitle={`Del ${fmtDate(from + 'T18:00:00Z')} al ${fmtDate(to + 'T18:00:00Z')}`} />

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <nav aria-label="Periodo" className="grid w-full grid-cols-3 rounded-full border border-linea-fuerte bg-superficie p-1 sm:inline-grid sm:w-auto">
          {PRESETS.map(([k, v]) => (
            <Link
              key={k}
              href={`/admin/pagos?periodo=${k}`}
              aria-current={preset === k ? 'true' : undefined}
              className={`inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-full px-3 text-[14px] transition-colors duration-200 sm:min-h-9 sm:px-4 ${preset === k ? 'bg-tinta text-hueso' : 'hover:bg-[rgb(37_38_44/0.06)]'}`}
            >
              {v}
            </Link>
          ))}
        </nav>
        <details className="group w-full sm:w-auto" open={preset === 'personalizado'}>
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full px-3 text-[14.5px] text-tinta hover:bg-[rgb(37_38_44/0.06)] sm:min-h-10 [&::-webkit-details-marker]:hidden">
            <Icon name="agenda" className="size-5 text-tenue" />
            {preset === 'personalizado' ? 'Periodo elegido' : 'Elegir fechas'}
            <Icon name="flecha" className="size-4 text-tenue transition-transform group-open:rotate-90" />
          </summary>
          <form className="mt-2 grid grid-cols-2 items-end gap-2 sm:flex">
            <input type="hidden" name="periodo" value="personalizado" />
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="desde" className="text-[13px] text-tenue">
                Desde
              </label>
              <input id="desde" name="desde" type="date" className="field min-h-11 py-1.5" defaultValue={from} max={t} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="hasta" className="text-[13px] text-tenue">
                Hasta
              </label>
              <input id="hasta" name="hasta" type="date" className="field min-h-11 py-1.5" defaultValue={to} max={t} />
            </div>
            <button type="submit" className={btn('secondary', 'sm', 'col-span-2 min-h-11')}>
              Ver periodo
            </button>
          </form>
        </details>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <section aria-label="Resumen del periodo" className="panel grid grid-cols-2 gap-5 p-5 sm:grid-cols-[1.3fr_1fr_1fr] sm:p-7">
            <div className="col-span-2 sm:col-span-1">
              <p className="text-[14px] text-tenue">Ingresos recibidos</p>
              <p className="display text-[42px] leading-none tabular-nums">{money(s?.income_cents)}</p>
              <p className="mt-1 text-[13px] text-tenue">{s?.payments_count ?? 0} pagos confirmados</p>
            </div>
            <div>
              <p className="text-[14px] text-tenue">Cargos del periodo</p>
              <p className="text-[20px] tabular-nums">{money(s?.charged_cents)}</p>
            </div>
            <div>
              <p className="text-[14px] text-tenue">Por confirmar</p>
              <p className="text-[20px] tabular-nums">{money(s?.unconfirmed_cents)}</p>
            </div>
            <p className="col-span-2 text-[13px] text-tenue sm:col-span-3">Solo cuentan como ingreso los pagos recibidos y confirmados, por su fecha de pago.</p>
          </section>

          <Section title="Ingresos por mes">
            <ol className="grid h-44 grid-cols-6 items-end gap-3" aria-label="Ingresos confirmados de los últimos seis meses">
              {[...byMonth.entries()].map(([m, v]) => (
                <li key={m} className="flex h-full flex-col items-center justify-end gap-1.5">
                  <span className="text-[11.5px] tabular-nums text-tenue">{v ? money(v).replace('.00', '') : ''}</span>
                  <span
                    className="w-full max-w-10 rounded-t-lg bg-salvia/80"
                    style={{ height: v ? `${Math.max(4, (v / maxMonth) * 100)}%` : '2px' }}
                    aria-hidden
                  />
                  <span className="text-[12px] capitalize text-tenue">{fmtDate(m + '-15T18:00:00Z', { month: 'short' }).replace('.', '')}</span>
                  <span className="sr-only">
                    {fmtDate(m + '-15T18:00:00Z', { month: 'long' })}: {money(v)}
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Pagos del periodo">
            {(periodPays ?? []).length ? (
              <>
              <ul className="-mx-1 divide-y divide-linea md:hidden">
                {((periodPays ?? []) as unknown as Pay[]).map((x) => {
                  const st = PAYMENT_STATUS[x.status]!;
                  return (
                    <li key={x.id}>
                      <Link href={`/admin/pacientes/${x.patient_id}?seccion=pagos`} className="flex min-h-16 items-center gap-3 rounded-xl px-1 py-2.5 active:bg-white">
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-[15.5px] leading-snug">{x.patient?.full_name}</span>
                          <span className="block text-[13px] text-tenue">
                            {fmtDate(x.paid_on + 'T18:00:00Z', { day: 'numeric', month: 'short' })} · {PAYMENT_METHOD[x.method]}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[16px] tabular-nums">{money(x.amount_cents)}</span>
                          <span className={`text-[12.5px] ${x.status === 'por_confirmar' ? 'text-ocre-700' : 'text-salvia-700'}`}>{st.label}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-[14.5px]">
                  <thead className="text-[13px] text-tenue">
                    <tr className="border-b border-linea">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Fecha
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Paciente
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">
                        Monto
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-linea">
                    {((periodPays ?? []) as unknown as Pay[]).map((x) => (
                      <tr key={x.id}>
                        <td className="py-2.5 pr-3 tabular-nums">{fmtDate(x.paid_on + 'T18:00:00Z', { day: 'numeric', month: 'short' })}</td>
                        <td className="py-2.5 pr-3">
                          <Link href={`/admin/pacientes/${x.patient_id}?seccion=pagos`} className="underline-offset-4 hover:underline">
                            {x.patient?.full_name}
                          </Link>
                          <span className="block text-[12.5px] text-tenue">{PAYMENT_METHOD[x.method]}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{money(x.amount_cents)}</td>
                        <td className="py-2.5">
                          <Badge tone={PAYMENT_STATUS[x.status]!.tone}>{PAYMENT_STATUS[x.status]!.label}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            ) : (
              <EmptyState title="Sin pagos en este periodo." />
            )}
          </Section>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Section title="Por confirmar" description="Pagos registrados que aún no verificas. No cuentan como ingreso.">
            {(unconfirmed ?? []).length ? (
              <ul className="divide-y divide-linea">
                {((unconfirmed ?? []) as unknown as Pay[]).map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <Link href={`/admin/pacientes/${x.patient_id}?seccion=pagos`} className="min-w-0">
                      <span className="block text-[15px]">{x.patient?.full_name}</span>
                      <span className="block text-[13px] text-tenue">
                        {money(x.amount_cents)} · {PAYMENT_METHOD[x.method]} · {fmtDate(x.paid_on + 'T18:00:00Z', { day: 'numeric', month: 'short' })}
                        {x.reference ? ` · Ref. ${x.reference}` : ''}
                      </span>
                    </Link>
                    <ActionForm
                      inline
                      action={confirmarPago}
                      submitLabel="Confirmar"
                      submitVariant="secondary"
                      confirm={{ title: '¿Confirmas que recibiste este pago?', confirmLabel: 'Sí, lo recibí' }}
                    >
                      <input type="hidden" name="id" value={x.id} />
                      <input type="hidden" name="paciente" value={x.patient_id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[15px] text-tenue">Nada por confirmar.</p>
            )}
          </Section>

          <Section title="Saldos pendientes" description={`Total por cobrar: ${money(s?.outstanding_cents)}`}>
            {(balances ?? []).length ? (
              <ul className="divide-y divide-linea">
                {(balances ?? []).map((b) => {
                  const n = nameOf.get(b.patient_id as string);
                  return (
                    <li key={b.patient_id as string}>
                      <Link href={`/admin/pacientes/${b.patient_id}?seccion=pagos`} className="flex items-center justify-between gap-3 py-3 hover:bg-white/50">
                        <span className="min-w-0">
                          <span className="block truncate text-[15px]">{n?.full_name as string}</span>
                          <span className="block text-[13px] tabular-nums text-tenue">{n?.internal_code as string}</span>
                        </span>
                        <span className="tabular-nums text-ocre-700">{money(Number(b.balance_cents))}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[15px] text-tenue">Todos los pacientes están al corriente.</p>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
