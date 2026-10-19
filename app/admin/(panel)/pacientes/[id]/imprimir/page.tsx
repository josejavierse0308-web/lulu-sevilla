import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { UUID } from '@/lib/admin';
import { APPOINTMENT_STATUS, CONSENT_METHOD, CONTACT_PREF, ENTRY_KIND, GOAL_STATUS, PATIENT_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '@/lib/labels';
import { fmtDate, fmtDateTime, fmtTime, money, MODALITY_LABEL } from '@/lib/format';
import { PrintButton } from './print-button';

export const metadata = { title: 'Expediente para imprimir' };

/** Copia completa del expediente (para solicitudes de acceso o resguardo en papel). Se registra como exportación. */
export default async function Imprimir({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase } = await requireAdmin();
  const [{ data: p }, { data: appts }, { data: entries }, { data: consents }, { data: pays }, { data: charges }] = await Promise.all([
    supabase.from('patient_overview').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('appointments')
      .select('starts_at,status,modality,service:session_types(name)')
      .eq('patient_id', id)
      .neq('status', 'reprogramada')
      .order('starts_at'),
    supabase
      .from('clinical_entries')
      .select('kind,title,body,entry_date,goal_status,version,voided_at,void_reason,created_at')
      .eq('patient_id', id)
      .order('entry_date')
      .order('created_at'),
    supabase
      .from('consents')
      .select('accepted_at,accepted_by_name,method,revoked_at,doc:legal_documents(title,version)')
      .eq('patient_id', id)
      .order('accepted_at'),
    supabase.from('payments').select('paid_on,amount_cents,method,status').eq('patient_id', id).order('paid_on'),
    supabase.from('charge_balances').select('charged_on,description,amount_cents,payment_state').eq('patient_id', id).order('charged_on'),
  ]);
  if (!p) notFound();
  await supabase.rpc('log_access', { p_action: 'export', p_entity: 'patients', p_entity_id: id });

  const H = ({ children }: { children: React.ReactNode }) => <h2 className="display mb-3 mt-10 border-b border-linea pb-1 text-[26px]">{children}</h2>;
  return (
    <article className="mx-auto max-w-3xl text-[15px] leading-relaxed">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-tenue">Documento confidencial. Esta exportación quedó registrada en la bitácora.</p>
        <PrintButton />
      </div>
      <p className="text-[13px] text-tenue">Generado {fmtDateTime(new Date())} · Confidencial</p>
      <h1 className="display mt-2 text-[44px]">{p.full_name}</h1>
      <p className="text-tenue">
        {p.internal_code} · {PATIENT_STATUS[p.status]?.label} · registrado {fmtDate(p.created_at)}
      </p>

      <H>Datos generales</H>
      <dl className="grid grid-cols-[200px_1fr] gap-y-1">
        <dt className="text-tenue">Teléfono</dt>
        <dd>{p.phone ?? '—'}</dd>
        <dt className="text-tenue">Correo</dt>
        <dd>{p.email ?? '—'}</dd>
        <dt className="text-tenue">Contacto preferido</dt>
        <dd>{p.preferred_contact ? CONTACT_PREF[p.preferred_contact] : '—'}</dd>
        <dt className="text-tenue">Fecha de nacimiento</dt>
        <dd>{p.birth_date ? fmtDate(p.birth_date + 'T18:00:00Z') : '—'}</dd>
        <dt className="text-tenue">Contacto de emergencia</dt>
        <dd>
          {p.emergency_contact_name
            ? `${p.emergency_contact_name} ${p.emergency_contact_relation ? `(${p.emergency_contact_relation})` : ''} ${p.emergency_contact_phone ?? ''}`
            : '—'}
        </dd>
      </dl>

      <H>Consentimientos</H>
      {(consents ?? []).length ? (
        <ul className="grid gap-1">
          {(consents ?? []).map((c, i) => {
            const d = c.doc as unknown as { title: string; version: number } | null;
            return (
              <li key={i}>
                {d?.title} v{d?.version} · {CONSENT_METHOD[c.method as string]} · {c.accepted_by_name as string} · {fmtDateTime(c.accepted_at as string)}
                {c.revoked_at ? ` · revocado ${fmtDateTime(c.revoked_at as string)}` : ''}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-tenue">Sin registros.</p>
      )}

      <H>Citas</H>
      {(appts ?? []).length ? (
        <ul className="grid gap-1">
          {(appts ?? []).map((a, i) => (
            <li key={i}>
              {fmtDate(a.starts_at as string, { day: 'numeric', month: 'short', year: 'numeric' })} {fmtTime(a.starts_at as string)} ·{' '}
              {(a.service as unknown as { name: string } | null)?.name} · {MODALITY_LABEL[a.modality as string]} ·{' '}
              {APPOINTMENT_STATUS[a.status as string]?.label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-tenue">Sin citas.</p>
      )}

      <H>Registros clínicos</H>
      {(entries ?? []).length ? (
        <ol className="grid gap-5">
          {(entries ?? []).map((e, i) => (
            <li key={i} className="break-inside-avoid">
              <p className="text-[13.5px] text-tenue">
                {fmtDate((e.entry_date as string) + 'T18:00:00Z')} · {ENTRY_KIND[e.kind as string]}
                {e.goal_status ? ` · ${GOAL_STATUS[e.goal_status as string]?.label}` : ''} · versión {e.version as number}
                {e.voided_at ? ` · ANULADO: ${e.void_reason}` : ''}
              </p>
              {e.title && <p className="font-medium">{e.title as string}</p>}
              <p className={`whitespace-pre-wrap ${e.voided_at ? 'line-through opacity-70' : ''}`}>{e.body as string}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-tenue">Sin registros.</p>
      )}

      <H>Cargos y pagos</H>
      <p>Saldo: {p.balance_cents > 0 ? `pendiente ${money(p.balance_cents)}` : p.balance_cents < 0 ? `a favor ${money(-p.balance_cents)}` : 'al corriente'}</p>
      <ul className="mt-2 grid gap-1">
        {(charges ?? []).map((c, i) => (
          <li key={`c${i}`}>
            Cargo · {fmtDate((c.charged_on as string) + 'T18:00:00Z', { day: 'numeric', month: 'short', year: 'numeric' })} · {c.description as string} ·{' '}
            {money(c.amount_cents as number)} · {c.payment_state as string}
          </li>
        ))}
        {(pays ?? []).map((x, i) => (
          <li key={`p${i}`}>
            Pago · {fmtDate((x.paid_on as string) + 'T18:00:00Z', { day: 'numeric', month: 'short', year: 'numeric' })} · {money(x.amount_cents as number)} ·{' '}
            {PAYMENT_METHOD[x.method as string]} · {PAYMENT_STATUS[x.status as string]?.label}
          </li>
        ))}
      </ul>
    </article>
  );
}
