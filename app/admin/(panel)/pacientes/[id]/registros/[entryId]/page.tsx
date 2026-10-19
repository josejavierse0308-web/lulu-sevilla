import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { logView, UUID } from '@/lib/admin';
import { ENTRY_KIND, GOAL_STATUS } from '@/lib/labels';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { ActionForm, TextArea } from '@/components/forms';
import { Badge, Notice, PageHeader, Section } from '@/components/ui';
import { anularRegistro, editarRegistro } from '../../../actions';
import { EntryForm } from '../../entry-form';

export const metadata = { title: 'Registro clínico' };

export default async function Registro({ params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  if (!UUID.test(id) || !UUID.test(entryId)) notFound();
  const { supabase } = await requireAdmin();
  const [{ data: p }, { data: e }, { data: revs }] = await Promise.all([
    supabase.from('patients').select('id,full_name').eq('id', id).maybeSingle(),
    supabase.from('clinical_entries').select('*').eq('id', entryId).eq('patient_id', id).maybeSingle(),
    supabase
      .from('clinical_entry_revisions')
      .select('version,kind,entry_date,title,body,goal_status,replaced_at')
      .eq('entry_id', entryId)
      .order('version', { ascending: false }),
  ]);
  if (!p || !e) notFound();
  await logView(supabase, 'clinical_entries', entryId);
  const voided = !!e.voided_at;

  return (
    <>
      <PageHeader
        back={{ href: `/admin/pacientes/${id}?seccion=registros`, label: p.full_name }}
        title={e.title || ENTRY_KIND[e.kind]}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {ENTRY_KIND[e.kind]} · {fmtDate(e.entry_date + 'T18:00:00Z')} · versión {e.version}
            {e.goal_status && <Badge tone={GOAL_STATUS[e.goal_status]!.tone}>{GOAL_STATUS[e.goal_status]!.label}</Badge>}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-6">
          {voided ? (
            <Section>
              <Notice tone="neutro">
                Registro anulado el {fmtDateTime(e.voided_at)}: {e.void_reason}
              </Notice>
              <div className="clinico mt-5 whitespace-pre-wrap text-[16px] leading-relaxed opacity-70">{e.body}</div>
            </Section>
          ) : (
            <Section title="Editar">
              <EntryForm action={editarRegistro} patientId={id} submitLabel="Guardar cambios" values={e} sessions={[]} />
            </Section>
          )}
          {!voided && (
            <details className="panel p-5 sm:p-7">
              <summary className="min-h-11 cursor-pointer text-[15px] font-medium">Anular este registro</summary>
              <p className="mt-2 text-[14px] text-tenue">
                Los registros clínicos no se borran. Al anularlo queda marcado, con su motivo, y deja de poder editarse.
              </p>
              <ActionForm
                action={anularRegistro}
                submitLabel="Anular registro"
                submitVariant="danger"
                confirm={{ title: '¿Anular este registro?', body: 'Quedará visible como anulado y no podrá editarse.', confirmLabel: 'Anular', danger: true }}
                className="mt-4"
              >
                <input type="hidden" name="id" value={entryId} />
                <input type="hidden" name="paciente" value={id} />
                <TextArea label="Motivo" name="motivo" required maxLength={300} rows={2} />
              </ActionForm>
            </details>
          )}
        </div>
        <Section title="Historial de cambios" description="Cada edición guarda la versión anterior.">
          <p className="text-[14px] text-tenue">
            Creado {fmtDateTime(e.created_at)}
            {e.version > 1 && ` · última edición ${fmtDateTime(e.updated_at)}`}
          </p>
          {(revs ?? []).length ? (
            <ol className="mt-4 grid gap-3">
              {(revs ?? []).map((r) => (
                <li key={r.version as number}>
                  <details className="rounded-2xl border border-linea p-4">
                    <summary className="cursor-pointer text-[14.5px]">
                      Versión {r.version as number} · reemplazada {fmtDateTime(r.replaced_at as string)}
                    </summary>
                    <p className="mt-2 text-[13px] text-tenue">
                      {ENTRY_KIND[r.kind as string]} · {fmtDate((r.entry_date as string) + 'T18:00:00Z')}
                      {r.title ? ` · ${r.title as string}` : ''}
                    </p>
                    <div className="clinico mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{r.body as string}</div>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-[14px] text-tenue">Sin ediciones.</p>
          )}
        </Section>
      </div>
    </>
  );
}
