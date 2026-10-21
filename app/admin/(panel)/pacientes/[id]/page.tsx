import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { logView, UUID } from '@/lib/admin';
import type { Patient } from '@/lib/admin-types';
import { PATIENT_STATUS } from '@/lib/labels';
import { Badge, btn, PageHeader, Tabs } from '@/components/ui';
import { DiscreetToggle } from './discreto';
import { Resumen } from './secciones/resumen';
import { Historial } from './secciones/historial';
import { Registros } from './secciones/registros';
import { Documentos } from './secciones/documentos';
import { Pagos } from './secciones/pagos';

export const metadata = { title: 'Expediente' };

const SECTIONS = ['resumen', 'historial', 'registros', 'documentos', 'pagos'] as const;
type SectionKey = (typeof SECTIONS)[number];

export default async function Expediente({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const section: SectionKey = (SECTIONS as readonly string[]).includes(sp.seccion ?? '') ? (sp.seccion as SectionKey) : 'resumen';
  const { supabase } = await requireAdmin();

  const { data } = await supabase.from('patient_overview').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const p = data as Patient;
  await logView(supabase, 'patients', id);

  const [{ count: entries }, { count: docs }] = await Promise.all([
    supabase.from('clinical_entries').select('id', { count: 'exact', head: true }).eq('patient_id', id).is('voided_at', null),
    supabase.from('patient_documents').select('id', { count: 'exact', head: true }).eq('patient_id', id),
  ]);
  const st = PATIENT_STATUS[p.status]!;
  const base = `/admin/pacientes/${id}`;

  return (
    <>
      <PageHeader
        back={{ href: '/admin/pacientes', label: 'Pacientes' }}
        title={p.full_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tabular-nums">{p.internal_code}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
          </span>
        }
        actions={
          <>
            <DiscreetToggle />
            <Link href={`/admin/agenda/nueva?paciente=${id}`} className={btn('secondary', 'md', 'max-sm:flex-1 max-sm:px-3')}>
              Agendar cita
            </Link>
            <Link href={`${base}/registros/nuevo`} className={btn('primary', 'md', 'max-sm:flex-1 max-sm:px-3')}>
              Nuevo registro
            </Link>
          </>
        }
      />
      <Tabs
        current={section}
        items={[
          { key: 'resumen', label: 'Resumen', href: base },
          { key: 'historial', label: 'Historial', href: `${base}?seccion=historial` },
          { key: 'registros', label: 'Registros clínicos', href: `${base}?seccion=registros`, count: entries ?? 0 },
          { key: 'documentos', label: 'Documentos', href: `${base}?seccion=documentos`, count: docs ?? 0 },
          { key: 'pagos', label: 'Pagos', href: `${base}?seccion=pagos` },
        ]}
      />
      {section === 'resumen' && <Resumen patient={p} />}
      {section === 'historial' && <Historial patient={p} filter={sp.tipo} />}
      {section === 'registros' && <Registros patient={p} filter={sp.tipo} />}
      {section === 'documentos' && <Documentos patient={p} />}
      {section === 'pagos' && <Pagos patient={p} />}
    </>
  );
}
