import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { UUID } from '@/lib/admin';
import { PageHeader, Section } from '@/components/ui';
import { actualizarPaciente } from '../../actions';
import { PatientForm, type PatientValues } from '../../patient-form';

export const metadata = { title: 'Editar datos' };

export default async function EditarPaciente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from('patients').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const p = data as PatientValues & { internal_code: string };
  return (
    <>
      <PageHeader
        back={{ href: `/admin/pacientes/${id}`, label: p.full_name ?? 'Expediente' }}
        title={
          <>
            Editar <em>datos</em>
          </>
        }
        subtitle={`Identificador ${p.internal_code} · no cambia`}
      />
      <Section className="max-w-3xl">
        <PatientForm action={actualizarPaciente} values={p} submitLabel="Guardar cambios" />
      </Section>
    </>
  );
}
