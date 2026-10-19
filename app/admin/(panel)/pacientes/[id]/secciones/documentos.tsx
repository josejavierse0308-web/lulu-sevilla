import { requireAdmin } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { ActionForm } from '@/components/forms';
import { Badge, EmptyState, Section } from '@/components/ui';
import { eliminarDocumento } from '../../actions';
import { SubirDocumento } from './subir';
import type { Patient } from '@/lib/admin-types';

export async function Documentos({ patient: p }: { patient: Patient }) {
  const { supabase } = await requireAdmin();
  const { data } = await supabase
    .from('patient_documents')
    .select('id,kind,title,mime_type,size_bytes,uploaded_at')
    .eq('patient_id', p.id)
    .order('uploaded_at', { ascending: false });
  const docs = data ?? [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Section title="Documentos" description="Se guardan en almacenamiento privado. Cada descarga usa un enlace temporal de un minuto y queda en la bitácora.">
        {!docs.length ? (
          <EmptyState title="Sin documentos.">
            <p>Sube consentimientos firmados u otros documentos autorizados.</p>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-linea">
            {docs.map((d) => (
              <li key={d.id as string} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <a href={`/admin/pacientes/${p.id}/documentos/${d.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-[15.5px] underline-offset-4 hover:underline">{d.title as string}</span>
                  <span className="flex flex-wrap items-center gap-2 text-[13px] text-tenue">
                    {d.kind === 'consentimiento_firmado' && <Badge tone="lavanda">Consentimiento</Badge>}
                    {String(d.mime_type).split('/')[1]?.toUpperCase().replace('JPEG', 'JPG')} · {(Number(d.size_bytes) / 1024 / 1024).toFixed(1)} MB ·{' '}
                    {fmtDateTime(d.uploaded_at as string)}
                  </span>
                </a>
                <ActionForm
                  inline
                  action={eliminarDocumento}
                  submitLabel="Eliminar"
                  submitVariant="quiet"
                  pendingLabel="Eliminando…"
                  confirm={{
                    title: '¿Eliminar este documento?',
                    body: 'El archivo se borra del almacenamiento. Esta acción no se puede deshacer y queda registrada en la bitácora.',
                    confirmLabel: 'Eliminar',
                    danger: true,
                  }}
                >
                  <input type="hidden" name="id" value={d.id as string} />
                  <input type="hidden" name="paciente" value={p.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Subir documento">
        <SubirDocumento patientId={p.id} />
      </Section>
    </div>
  );
}
