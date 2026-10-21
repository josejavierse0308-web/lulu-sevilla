import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { PATIENT_STATUS } from '@/lib/labels';
import { fmtDate, fmtTime, money } from '@/lib/format';
import { Badge, btn, EmptyState, Fab, PageHeader } from '@/components/ui';
import { Icon } from '@/components/icons';

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
  const activeFilters = [estado, ultima, proxima, orden !== 'nombre' ? orden : ''].filter(Boolean).length;

  return (
    <>
      <PageHeader
        title="Pacientes"
        subtitle={`${rows.length} ${rows.length === 1 ? 'expediente' : 'expedientes'}${filtered ? ' con estos filtros' : ' activos y en seguimiento'}`}
        actionsClassName="max-md:hidden"
        actions={
          <Link href="/admin/pacientes/nuevo" className={btn('primary')}>
            Registrar paciente
          </Link>
        }
      />

      <form
        role="search"
        className="mb-6 grid gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-end lg:rounded-[20px] lg:border lg:border-linea lg:bg-superficie lg:p-4"
      >
        <div className="flex gap-2 lg:contents">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor="q" className="sr-only text-[13.5px] font-medium lg:not-sr-only">
              Nombre o identificador
            </label>
            <span className="relative">
              <Icon name="buscar" className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-tenue lg:hidden" />
              <input id="q" name="q" type="search" enterKeyHint="search" defaultValue={q} className="field max-lg:!pl-11" placeholder="Nombre o LS-0012" maxLength={80} />
            </span>
          </div>
          {/* Celular: los filtros se abren aparte para no ocupar la pantalla. */}
          <label
            htmlFor="ver-filtros"
            className={`relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border transition-colors lg:hidden [form:has(#ver-filtros:focus-visible)_&]:outline-2 [form:has(#ver-filtros:focus-visible)_&]:outline-offset-2 [form:has(#ver-filtros:focus-visible)_&]:outline-lavanda-700 ${activeFilters ? 'border-tinta bg-tinta text-hueso' : 'border-linea-fuerte bg-superficie'}`}
          >
            <Icon name="filtros" className="size-[22px]" />
            <span className="sr-only">Filtros{activeFilters ? ` (${activeFilters} activos)` : ''}</span>
            {activeFilters > 0 && (
              <span aria-hidden className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-lavanda px-1 text-center text-[11px] font-medium leading-[18px] text-tinta ring-2 ring-hueso">
                {activeFilters}
              </span>
            )}
          </label>
        </div>
        <input id="ver-filtros" type="checkbox" className="peer sr-only lg:hidden" aria-label="Mostrar filtros" />
        <div className="panel hidden gap-3 p-4 peer-checked:grid sm:grid-cols-2 lg:contents lg:border-0 lg:bg-transparent lg:p-0">
          <Filter
            id="estado"
            label="Estado"
            value={estado}
            options={{ '': 'Activos y en seguimiento', ...Object.fromEntries(Object.entries(PATIENT_STATUS).map(([k, v]) => [k, v.label])), todos: 'Todos' }}
          />
          <Filter id="ultima" label="Última sesión" value={ultima} options={ULTIMA} />
          <Filter id="proxima" label="Próxima cita" value={proxima} options={PROXIMA} />
          <Filter id="orden" label="Ordenar por" value={orden} options={ORDEN} />
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
            <button type="submit" className={btn('secondary', 'md', 'max-lg:flex-1')}>
              Aplicar
            </button>
            {filtered && (
              <Link href="/admin/pacientes" className={btn('quiet')}>
                Limpiar
              </Link>
            )}
          </div>
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
        <>
        {/* Celular: lista compacta */}
        <ul className="panel divide-y divide-linea overflow-hidden md:hidden">
          {rows.map((r) => {
            const st = PATIENT_STATUS[r.status]!;
            return (
              <li key={r.id}>
                <Link href={`/admin/pacientes/${r.id}`} className="flex min-h-[76px] items-center gap-3.5 px-4 py-3 transition-colors active:bg-white">
                  <span
                    aria-hidden
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lavanda-50 text-[15px] font-medium text-lavanda-700"
                  >
                    {initials(r.full_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[16px] font-medium leading-snug">{r.full_name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13.5px] text-tenue">
                      <span className="tabular-nums">{r.internal_code}</span>
                      <span aria-hidden>·</span>
                      {r.next_appointment_at ? (
                        <span>
                          Próxima: {fmtDate(r.next_appointment_at, { day: 'numeric', month: 'short' })} {fmtTime(r.next_appointment_at)}
                        </span>
                      ) : (
                        <span>Sin cita próxima</span>
                      )}
                    </span>
                    {(r.status !== 'activo' || r.balance_cents !== 0) && (
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {r.status !== 'activo' && <Badge tone={st.tone}>{st.label}</Badge>}
                        {r.balance_cents > 0 && <Badge tone="ocre">Pendiente {money(r.balance_cents)}</Badge>}
                        {r.balance_cents < 0 && <Badge tone="salvia">A favor {money(-r.balance_cents)}</Badge>}
                      </span>
                    )}
                  </span>
                  <Icon name="flecha" className="size-4 text-tenue/70" />
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="panel hidden overflow-hidden md:block">
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
        </>
      )}
      <Fab href="/admin/pacientes/nuevo" label="Registrar paciente" />
    </>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter((w) => !/^(de|del|la|los|las|y)$/i.test(w));
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
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
