import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { PATIENT_STATUS } from '@/lib/labels';
import { fmtDate, fmtTime, money } from '@/lib/format';
import { Badge, btn, EmptyState, PageHeader } from '@/components/ui';

export const metadata = { title: 'Pacientes' };

type Row = {
  id: string;
  internal_code: string;
  full_name: string;
  status: string;
  last_session_at: string | null;
  next_appointment_at: string | null;
  balance_cents: number;
};

const ULTIMA: Record<string, string> = { '': 'Cualquier fecha', reciente: 'En los últimos 30 días', antigua: 'Hace más de 30 días', nunca: 'Sin sesiones' };
const PROXIMA: Record<string, string> = { '': 'Con o sin cita', con: 'Con cita próxima', sin: 'Sin cita próxima' };
const ORDEN: Record<string, string> = { nombre: 'Nombre', ultima: 'Última sesión', proxima: 'Próxima cita' };

export default async function PacientesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 80);
  const estado = sp.estado && sp.estado in PATIENT_STATUS ? sp.estado : sp.estado === 'todos' ? 'todos' : '';
  const ultima = sp.ultima && sp.ultima in ULTIMA ? sp.ultima : '';
  const proxima = sp.proxima && sp.proxima in PROXIMA ? sp.proxima : '';
  const orden = sp.orden && sp.orden in ORDEN ? sp.orden : 'nombre';

  let query = supabase.from('patient_overview').select('id,internal_code,full_name,status,last_session_at,next_appointment_at,balance_cents');
  if (q) {
    // Búsqueda por identificador interno exacto o por nombre (sin comodines del usuario).
    if (/^ls-?\d{1,6}$/i.test(q)) {
      const n = q.replace(/\D/g, '').padStart(4, '0');
      query = query.eq('internal_code', `LS-${n}`);
    } else {
      query = query.ilike('full_name', `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`);
    }
  }
  if (estado && estado !== 'todos') query = query.eq('status', estado);
  else if (!estado) query = query.neq('status', 'archivado');
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
  if (ultima === 'reciente') query = query.gte('last_session_at', d30);
  if (ultima === 'antigua') query = query.lt('last_session_at', d30);
  if (ultima === 'nunca') query = query.is('last_session_at', null);
  if (proxima === 'con') query = query.not('next_appointment_at', 'is', null);
  if (proxima === 'sin') query = query.is('next_appointment_at', null);
  query =
    orden === 'ultima'
      ? query.order('last_session_at', { ascending: false, nullsFirst: false })
      : orden === 'proxima'
        ? query.order('next_appointment_at', { ascending: true, nullsFirst: false })
        : query.order('full_name');
  const { data, error } = await query.limit(300);
  const rows = (data ?? []) as Row[];
  const filtered = !!(q || estado || ultima || proxima);

  return (
    <>
      <PageHeader
        title="Pacientes"
        subtitle={`${rows.length} ${rows.length === 1 ? 'expediente' : 'expedientes'}${filtered ? ' con estos filtros' : ' activos y en seguimiento'}`}
        actions={
          <Link href="/admin/pacientes/nuevo" className={btn('primary')}>
            Registrar paciente
          </Link>
        }
      />

      <form role="search" className="panel mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
          <label htmlFor="q" className="text-[13.5px] font-medium">
            Nombre o identificador
          </label>
          <input id="q" name="q" type="search" defaultValue={q} className="field" placeholder="Ej. Ana o LS-0012" maxLength={80} />
        </div>
        <Filter
          id="estado"
          label="Estado"
          value={estado}
          options={{ '': 'Activos y en seguimiento', ...Object.fromEntries(Object.entries(PATIENT_STATUS).map(([k, v]) => [k, v.label])), todos: 'Todos' }}
        />
        <Filter id="ultima" label="Última sesión" value={ultima} options={ULTIMA} />
        <Filter id="proxima" label="Próxima cita" value={proxima} options={PROXIMA} />
        <Filter id="orden" label="Ordenar por" value={orden} options={ORDEN} />
        <div className="flex gap-2">
          <button type="submit" className={btn('secondary')}>
            Aplicar
          </button>
          {filtered && (
            <Link href="/admin/pacientes" className={btn('quiet')}>
              Limpiar
            </Link>
          )}
        </div>
      </form>

      {error ? (
        <EmptyState title="No se pudo cargar la lista.">
          <p>Revisa tu conexión y recarga la página.</p>
        </EmptyState>
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState title="Sin resultados.">
            <p>Prueba con otro nombre o quita algún filtro.</p>
          </EmptyState>
        ) : (
          <EmptyState
            title="Aún no hay expedientes."
            action={
              <Link href="/admin/pacientes/nuevo" className={btn('primary')}>
                Registrar el primero
              </Link>
            }
          >
            <p>También se crean al confirmar una solicitud que llegó desde la página.</p>
          </EmptyState>
        )
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Expedientes</caption>
            <thead className="hidden text-[13px] text-tenue md:table-header-group">
              <tr className="border-b border-linea">
                <th scope="col" className="px-5 py-3 font-medium">
                  Paciente
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  Estado
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  Última sesión
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  Próxima cita
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  Saldo
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {rows.map((r) => {
                const st = PATIENT_STATUS[r.status]!;
                return (
                  <tr key={r.id} className="relative block transition-colors hover:bg-white/70 md:table-row">
                    <td className="block px-5 pt-4 md:table-cell md:py-4">
                      <Link href={`/admin/pacientes/${r.id}`} className="after:absolute after:inset-0">
                        <span className="block text-[16px] font-medium">{r.full_name}</span>
                        <span className="block text-[13px] tabular-nums text-tenue">{r.internal_code}</span>
                      </Link>
                    </td>
                    <td className="inline-block px-5 pt-2 md:table-cell md:px-3 md:py-4">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="block px-5 pt-2 text-[14.5px] md:table-cell md:px-3 md:py-4">
                      <span className="text-tenue md:hidden">Última sesión: </span>
                      {r.last_session_at ? (
                        fmtDate(r.last_session_at, { day: 'numeric', month: 'short', year: 'numeric' })
                      ) : (
                        <span className="text-tenue">—</span>
                      )}
                    </td>
                    <td className="block px-5 pt-1 text-[14.5px] md:table-cell md:px-3 md:py-4">
                      <span className="text-tenue md:hidden">Próxima cita: </span>
                      {r.next_appointment_at ? (
                        `${fmtDate(r.next_appointment_at, { day: 'numeric', month: 'short' })} · ${fmtTime(r.next_appointment_at)}`
                      ) : (
                        <span className="text-tenue">—</span>
                      )}
                    </td>
                    <td className="block px-5 pb-4 pt-1 text-[14.5px] tabular-nums md:table-cell md:py-4 md:text-right">
                      <span className="text-tenue md:hidden">Saldo: </span>
                      {r.balance_cents > 0 ? (
                        <span className="text-ocre-700">{money(r.balance_cents)}</span>
                      ) : r.balance_cents < 0 ? (
                        <span className="text-salvia-700">A favor {money(-r.balance_cents)}</span>
                      ) : (
                        <span className="text-tenue">Al corriente</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Filter({ id, label, value, options }: { id: string; label: string; value: string; options: Record<string, string> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13.5px] font-medium">
        {label}
      </label>
      <select id={id} name={id} defaultValue={value} className="field">
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}
