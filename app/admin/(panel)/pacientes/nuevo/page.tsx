import { requireAdmin } from '@/lib/auth';
import { PageHeader, Section } from '@/components/ui';
import { crearPaciente } from '../actions';
import { PatientForm } from '../patient-form';

export const metadata = { title: 'Registrar paciente' };

export default async function NuevoPaciente() {
  await requireAdmin();
  return (
    <>
      <PageHeader
        back={{ href: '/admin/pacientes', label: 'Pacientes' }}
        title={
          <>
            Registrar <em>paciente</em>
          </>
        }
        subtitle="Registra solo la información necesaria para la atención y la gestión del expediente."
      />
      <Section className="max-w-3xl">
        <PatientForm action={crearPaciente} submitLabel="Crear expediente" />
      </Section>
    </>
  );
}
