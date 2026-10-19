import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { isDateKey, todayKey } from '@/lib/format';
import { ActionForm, Field, Select } from '@/components/forms';
import { EmptyState, PageHeader, Section, btn } from '@/components/ui';
import { crearCita } from '../actions';
import { SlotPicker } from '../slot-picker';

export const metadata = { title: 'Agendar cita' };

export default async function NuevaCita({ searchParams }: { searchParams: Promise<{ paciente?: string; fecha?: string }> }) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const [{ data: patients }, { data: services }] = await Promise.all([
    supabase.from('patients').select('id,full_name,internal_code').in('status', ['activo', 'en_pausa']).order('full_name').limit(500),
    supabase.from('session_types').select('id,name,duration_min,modality').eq('active', true).order('sort_order'),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: '/admin/agenda', label: 'Agenda' }}
        title={
          <>
            Agendar <em>cita</em>
          </>
        }
      />
      {!services?.length ? (
        <EmptyState
          title="Primero configura un servicio."
          action={
            <Link href="/admin/configuracion?seccion=servicios" className={btn('primary')}>
              Ir a servicios
            </Link>
          }
        >
          <p>Para agendar necesitas al menos un tipo de sesión con su duración y precio.</p>
        </EmptyState>
      ) : !patients?.length ? (
        <EmptyState
          title="Aún no hay expedientes."
          action={
            <Link href="/admin/pacientes/nuevo" className={btn('primary')}>
              Registrar paciente
            </Link>
          }
        >
          <p>Las citas del panel se agendan para un paciente registrado.</p>
        </EmptyState>
      ) : (
        <Section className="max-w-2xl">
          <ActionForm action={crearCita} submitLabel="Agendar y confirmar" pendingLabel="Agendando…" className="grid gap-5">
            <Select label="Paciente" name="paciente" defaultValue={sp.paciente ?? ''} required>
              <option value="" disabled>
                Elige un paciente
              </option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} · {p.internal_code}
                </option>
              ))}
            </Select>
            <SlotPicker services={services} defaultDay={isDateKey(sp.fecha) && sp.fecha >= todayKey() ? sp.fecha : todayKey()} />
            <Field label="Enlace de videollamada o lugar" name="lugar" optional maxLength={300} />
          </ActionForm>
        </Section>
      )}
    </>
  );
}
