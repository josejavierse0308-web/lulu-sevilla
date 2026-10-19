import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { ENTRY_KIND, GOAL_STATUS } from '@/lib/labels';
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/format';
import { Badge, btn, EmptyState } from '@/components/ui';
import type { Patient } from '@/lib/admin-types';

type Entry = {
  id: string;
  kind: string;
  title: string | null;
  body: string;
  entry_date: string;
  goal_status: string | null;
  version: number;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
  appointment: { id: string; starts_at: string } | null;
};

export async function Registros({ patient: p, filter }: { patient: Patient; filter?: string }) {
  const { supabase } = await requireAdmin();
  const f = filter && filter in ENTRY_KIND ? filter : '';
  let q = supabase
    .from('clinical_entries')
    .select('id,kind,title,body,entry_date,goal_status,version,voided_at,void_reason,created_at,updated_at,appointment:appointments(id,starts_at)')
    .eq('patient_id', p.id)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (f) q = q.eq('kind', f);
  const { data } = await q.limit(300);
  const entries = (data ?? []) as unknown as Entry[];
  const goals = entries.filter((e) => e.kind === 'objetivo' && !e.voided_at && e.goal_status === 'activo');
  const base = `/admin/pacientes/${p.id}?seccion=registros`;

  return (
    <div className="grid gap-6">
      <p className="max-w-[70ch] text-[14.5px] text-tenue">
        Registros privados: solo los ve tu cuenta. No aparecen en la página, en confirmaciones ni en mensajes automáticos. Cada edición conserva la versión
        anterior y nada se borra: un registro erróneo se anula con un motivo.
      </p>

      {goals.length > 0 && !f && (
        <section aria-labelledby="objetivos" className="panel p-5 sm:p-6">
          <h2 id="objetivos" className="display mb-3 text-[24px]">
            Objetivos en curso
          </h2>
          <ul className="clinico grid gap-2">
            {goals.map((g) => (
              <li key={g.id}>
                <Link href={`/admin/pacientes/${p.id}/registros/${g.id}`} className="text-[15.5px] underline-offset-4 hover:underline">
                  {g.title ?? g.body.slice(0, 90)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav aria-label="Filtrar registros" className="flex flex-wrap gap-2">
        {[['', 'Todos'], ...Object.entries(ENTRY_KIND)].map(([k, v]) => (
          <Link
            key={k}
            href={k ? `${base}&tipo=${k}` : base}
            aria-current={f === k ? 'true' : undefined}
            className={`inline-flex min-h-9 items-center rounded-full px-3.5 text-[14px] ${f === k ? 'bg-tinta text-hueso' : 'border border-linea-fuerte hover:bg-white'}`}
          >
            {v}
          </Link>
        ))}
      </nav>

      {!entries.length ? (
        <EmptyState
          title="Sin registros."
          action={
            <Link href={`/admin/pacientes/${p.id}/registros/nuevo`} className={btn('primary')}>
              Escribir el primero
            </Link>
          }
        >
          <p>Notas de sesión, observaciones, objetivos de seguimiento y evolución, escritos y validados por ti.</p>
        </EmptyState>
      ) : (
        <ol className="grid gap-4">
          {entries.map((e) => (
            <li key={e.id}>
              <article
                className={`panel p-5 sm:p-6 ${e.voided_at ? 'opacity-65' : ''}`}
                aria-label={`${ENTRY_KIND[e.kind]} del ${fmtDate(e.entry_date + 'T18:00:00Z')}`}
              >
                <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[13.5px] text-tenue">
                      {fmtDate(e.entry_date + 'T18:00:00Z', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      {e.appointment && (
                        <>
                          {' · '}
                          <Link className="link" href={`/admin/agenda/${e.appointment.id}`}>
                            sesión de las {fmtTime(e.appointment.starts_at)}
                          </Link>
                        </>
                      )}
                    </p>
                    <h3 className={`display mt-1 text-[24px] ${e.voided_at ? 'line-through' : ''}`}>{e.title || ENTRY_KIND[e.kind]}</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {e.title && <span className="text-[13.5px] text-tenue">{ENTRY_KIND[e.kind]}</span>}
                      {e.goal_status && <Badge tone={GOAL_STATUS[e.goal_status]!.tone}>{GOAL_STATUS[e.goal_status]!.label}</Badge>}
                      {e.voided_at && <Badge tone="neutro">Anulado</Badge>}
                    </div>
                  </div>
                  <Link href={`/admin/pacientes/${p.id}/registros/${e.id}`} className={btn('quiet', 'sm')}>
                    {e.voided_at ? 'Ver' : 'Editar · historial'}
                  </Link>
                </header>
                <div className="clinico max-w-[72ch] whitespace-pre-wrap text-[16px] leading-relaxed">{e.body}</div>
                <footer className="mt-4 text-[13px] text-tenue">
                  Creado {fmtDateTime(e.created_at)}
                  {e.version > 1 && ` · editado ${fmtDateTime(e.updated_at)} (versión ${e.version})`}
                  {e.voided_at && ` · anulado ${fmtDateTime(e.voided_at)}: ${e.void_reason}`}
                </footer>
              </article>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
