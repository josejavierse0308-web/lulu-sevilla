import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { UUID } from '@/lib/admin';
import { dateKey, fmtDate, fmtTime } from '@/lib/format';
import { PageHeader, Section } from '@/components/ui';
import { crearRegistro } from '../../../actions';
import { EntryForm } from '../../entry-form';

export const metadata = { title: 'Nuevo registro' };

export default async function NuevoRegistro({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cita?: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { cita } = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: p }, { data: sessions }] = await Promise.all([
    supabase.from('patients').select('id,full_name').eq('id', id).maybeSingle(),
    supabase.from('appointments').select('id,starts_at').eq('patient_id', id).eq('status', 'completada').order('starts_at', { ascending: false }).limit(30),
  ]);
  if (!p) notFound();
  const linked = cita && UUID.test(cita) ? (sessions ?? []).find((s) => s.id === cita) : undefined;
  return (
    <>
      <PageHeader
        back={{ href: `/admin/pacientes/${id}?seccion=registros`, label: p.full_name }}
        title={
          <>
            Nuevo <em>registro</em>
          </>
        }
      />
      <Section className="max-w-3xl">
        <EntryForm
          action={crearRegistro}
          patientId={id}
          submitLabel="Guardar registro"
          values={{ appointment_id: linked?.id ?? null, entry_date: linked ? dateKey(linked.starts_at as string) : undefined }}
          sessions={(sessions ?? []).map((s) => ({
            id: s.id as string,
            label: `${fmtDate(s.starts_at as string, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${fmtTime(s.starts_at as string)}`,
          }))}
        />
      </Section>
    </>
  );
}
