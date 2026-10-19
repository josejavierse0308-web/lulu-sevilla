import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { APPOINTMENT_STATUS, ENTRY_KIND, CONSENT_METHOD, GOAL_STATUS } from '@/lib/labels';
import { fmtDate, fmtTime, MODALITY_LABEL } from '@/lib/format';
import { Badge, EmptyState } from '@/components/ui';
import type { Patient } from '@/lib/admin-types';

type Item =
  | { type: 'cita'; at: string; id: string; status: string; modality: string; service: string }
  | { type: 'registro'; at: string; id: string; kind: string; title: string | null; body: string; voided: boolean; goal: string | null; version: number }
  | { type: 'documento'; at: string; id: string; title: string }
  | { type: 'consentimiento'; at: string; id: string; title: string; method: string; revoked: string | null };

const FILTERS: Record<string, string> = {
  '': 'Todo',
  cita: 'Citas',
  registro: 'Registros clínicos',
  documento: 'Documentos',
  consentimiento: 'Consentimientos',
};

export async function Historial({ patient: p, filter }: { patient: Patient; filter?: string }) {
  const { supabase } = await requireAdmin();
  const f = filter && filter in FILTERS ? filter : '';
  const [{ data: appts }, { data: entries }, { data: docs }, { data: consents }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id,starts_at,status,modality,service:session_types(name)')
      .eq('patient_id', p.id)
      .neq('status', 'reprogramada')
      .order('starts_at', { ascending: false })
      .limit(300),
    supabase
      .from('clinical_entries')
      .select('id,kind,title,body,entry_date,created_at,voided_at,goal_status,version')
      .eq('patient_id', p.id)
      .order('entry_date', { ascending: false })
      .limit(300),
    supabase.from('patient_documents').select('id,title,uploaded_at').eq('patient_id', p.id).limit(200),
    supabase.from('consents').select('id,accepted_at,method,revoked_at,doc:legal_documents(title,version)').eq('patient_id', p.id),
  ]);

  const items: Item[] = [
    ...(appts ?? []).map((a) => ({
      type: 'cita' as const,
      at: a.starts_at as string,
      id: a.id as string,
      status: a.status as string,
      modality: a.modality as string,
      service: (a.service as unknown as { name: string } | null)?.name ?? '',
    })),
    ...(entries ?? []).map((e) => ({
      type: 'registro' as const,
      at: `${e.entry_date as string}T18:00:00Z`,
      id: e.id as string,
      kind: e.kind as string,
      title: e.title as string | null,
      body: e.body as string,
      voided: !!e.voided_at,
      goal: e.goal_status as string | null,
      version: e.version as number,
    })),
    ...(docs ?? []).map((d) => ({ type: 'documento' as const, at: d.uploaded_at as string, id: d.id as string, title: d.title as string })),
    ...(consents ?? []).map((c) => {
      const doc = c.doc as unknown as { title: string; version: number } | null;
      return {
        type: 'consentimiento' as const,
        at: c.accepted_at as string,
        id: c.id as string,
        title: `${doc?.title ?? ''} v${doc?.version ?? ''}`,
        method: c.method as string,
        revoked: c.revoked_at as string | null,
      };
    }),
  ]
    .filter((i) => !f || i.type === f)
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  const base = `/admin/pacientes/${p.id}?seccion=historial`;
  let lastMonth = '';

  return (
    <div>
      <nav aria-label="Filtrar historial" className="mb-6 flex flex-wrap gap-2">
        {Object.entries(FILTERS).map(([k, v]) => (
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

      {!items.length ? (
        <EmptyState title="Nada que mostrar todavía.">
          <p>Aquí aparecerán, en orden, las citas, los registros clínicos, los documentos y los consentimientos.</p>
        </EmptyState>
      ) : (
        <ol className="relative grid gap-1 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-linea-fuerte">
          {items.map((it) => {
            const month = fmtDate(it.at, { month: 'long', year: 'numeric' });
            const header = month !== lastMonth;
            lastMonth = month;
            return (
              <li key={`${it.type}-${it.id}`} className="relative pl-8">
                {header && <p className="display mb-2 mt-6 text-[22px] first-letter:uppercase">{month}</p>}
                <div className="relative">
                  <span aria-hidden className={`absolute -left-8 top-[17px] size-[15px] rounded-full border-2 border-hueso ${dot(it)}`} />
                  <TimelineCard it={it} patientId={p.id} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function dot(it: Item) {
  if (it.type === 'cita')
    return it.status === 'completada'
      ? 'bg-salvia-700'
      : it.status === 'cancelada'
        ? 'bg-rosa-700'
        : it.status === 'no_asistio'
          ? 'bg-pizarra-700'
          : 'bg-lavanda-700';
  if (it.type === 'registro') return 'bg-tinta';
  if (it.type === 'documento') return 'bg-ocre-700';
  return 'bg-lavanda';
}

function TimelineCard({ it, patientId }: { it: Item; patientId: string }) {
  const when = (
    <span className="text-[13px] tabular-nums text-tenue">{fmtDate(it.at, { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '')}</span>
  );
  if (it.type === 'cita') {
    const st = APPOINTMENT_STATUS[it.status]!;
    return (
      <Link href={`/admin/agenda/${it.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-3 hover:bg-white/70">
        <span>
          {when}
          <span className="block text-[15.5px]">
            Sesión · {fmtTime(it.at)} · {MODALITY_LABEL[it.modality]}
            <span className="text-tenue"> · {it.service}</span>
          </span>
        </span>
        <Badge tone={st.tone}>{it.status === 'completada' ? 'Asistió' : st.label}</Badge>
      </Link>
    );
  }
  if (it.type === 'registro') {
    return (
      <Link
        href={`/admin/pacientes/${patientId}/registros/${it.id}`}
        className={`block rounded-2xl px-3 py-3 hover:bg-white/70 ${it.voided ? 'opacity-60' : ''}`}
      >
        {when}
        <span className="flex flex-wrap items-center gap-2 text-[15.5px]">
          <span className={it.voided ? 'line-through' : ''}>{ENTRY_KIND[it.kind]}</span>
          {it.goal && <Badge tone={GOAL_STATUS[it.goal]!.tone}>{GOAL_STATUS[it.goal]!.label}</Badge>}
          {it.voided && <Badge tone="neutro">Anulado</Badge>}
          {it.version > 1 && <span className="text-[13px] text-tenue">editado</span>}
        </span>
        <span className="clinico mt-1 block max-w-[70ch] text-[14.5px] text-tenue">
          {it.title ? <strong className="font-medium text-tinta">{it.title}. </strong> : null}
          {it.body.length > 220 ? it.body.slice(0, 220) + '…' : it.body}
        </span>
      </Link>
    );
  }
  if (it.type === 'documento') {
    return (
      <a href={`/admin/pacientes/${patientId}/documentos/${it.id}`} className="block rounded-2xl px-3 py-3 hover:bg-white/70">
        {when}
        <span className="block text-[15.5px]">Documento · {it.title}</span>
      </a>
    );
  }
  return (
    <div className="rounded-2xl px-3 py-3">
      {when}
      <span className="block text-[15.5px]">
        Consentimiento · {it.title} <span className="text-tenue">· {CONSENT_METHOD[it.method]}</span>
      </span>
      {it.revoked && <span className="text-[13.5px] text-rosa-700">Revocado el {fmtDate(it.revoked)}</span>}
    </div>
  );
}
