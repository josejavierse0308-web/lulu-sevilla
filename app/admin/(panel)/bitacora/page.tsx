import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { APPOINTMENT_STATUS, PAYMENT_STATUS } from '@/lib/labels';
import { btn, EmptyState, PageHeader } from '@/components/ui';

export const metadata = { title: 'Bitácora' };

const ENTITY: Record<string, string> = {
  patients: 'Expediente',
  appointments: 'Cita',
  clinical_entries: 'Registro clínico',
  consents: 'Consentimiento',
  patient_documents: 'Documento',
  charges: 'Cargo',
  payments: 'Pago',
  practice_settings: 'Configuración',
  session_types: 'Servicio',
  availability_rules: 'Horario',
  time_off: 'Día no disponible',
  legal_documents: 'Documento legal',
  admin_users: 'Cuenta administradora',
  sesion: 'Sesión del panel',
};
const ACTION: Record<string, string> = {
  insert: 'Creó',
  update: 'Modificó',
  delete: 'Eliminó',
  view: 'Consultó',
  login: 'Inició sesión',
  logout: 'Cerró sesión',
  download: 'Descargó',
  export: 'Exportó',
};
const FIELD: Record<string, string> = {
  status: 'estado',
  full_name: 'nombre',
  email: 'correo',
  phone: 'teléfono',
  birth_date: 'fecha de nacimiento',
  body: 'contenido',
  title: 'título',
  kind: 'tipo',
  entry_date: 'fecha',
  goal_status: 'estado del objetivo',
  voided_at: 'anulación',
  void_reason: 'motivo de anulación',
  patient_id: 'expediente vinculado',
  location_details: 'lugar o enlace',
  cancel_reason: 'motivo de cancelación',
  rescheduled_to: 'reprogramación',
  confirmed_at: 'confirmación',
  completed_at: 'realización',
  cancelled_at: 'cancelación',
  cancelled_by: 'quién canceló',
  session_price_cents: 'precio propio',
  revoked_at: 'revocación',
  amount_cents: 'monto',
  confirmed_at_p: 'confirmación',
  booking_enabled: 'agenda en línea',
  is_current: 'versión vigente',
  preferred_contact: 'contacto preferido',
  public_intro: 'presentación pública',
  public_education: 'formación pública',
  public_license: 'cédula pública',
  public_approach: 'enfoque público',
  public_modality: 'modalidad pública',
  show_prices_public: 'mostrar precios',
  contact_whatsapp: 'WhatsApp',
  contact_email: 'correo de contacto',
  contact_address: 'dirección',
  slot_interval_min: 'intervalo',
  min_notice_hours: 'anticipación mínima',
  max_days_ahead: 'días abiertos',
  patient_change_min_hours: 'plazo de cambios',
  max_pending_per_contact: 'límite de solicitudes',
  cancellation_policy: 'política de cancelación',
  reschedule_policy: 'política de reprogramación',
  notify_patient_email: 'correos a pacientes',
  reminders_enabled: 'recordatorios',
  reminder_hours_before: 'anticipación del recordatorio',
  admin_alert_email: 'correo de avisos',
  admin_alert_on_request: 'avisos de solicitud',
  tpl_request_received: 'plantilla de acuse',
  tpl_confirmed: 'plantilla de confirmación',
  tpl_reminder: 'plantilla de recordatorio',
  tpl_cancelled: 'plantilla de cancelación',
  name: 'nombre',
  description: 'descripción',
  modality: 'modalidad',
  duration_min: 'duración',
  buffer_min: 'margen',
  price_cents: 'precio',
  is_public: 'visibilidad',
  active: 'activo',
  emergency_contact_name: 'contacto de emergencia',
  emergency_contact_phone: 'teléfono de emergencia',
  emergency_contact_relation: 'relación de emergencia',
};
const PAGE = 50;

function href(entity: string, id: string | null) {
  if (!id) return null;
  if (entity === 'patients') return `/admin/pacientes/${id}`;
  if (entity === 'appointments') return `/admin/agenda/${id}`;
  return null;
}

function stateLabel(s: string | undefined) {
  if (!s) return '';
  return APPOINTMENT_STATUS[s]?.label ?? PAYMENT_STATUS[s]?.label ?? s;
}

export default async function Bitacora({ searchParams }: { searchParams: Promise<{ pagina?: string; tipo?: string }> }) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Math.min(500, Number(sp.pagina) || 1));
  const tipo = sp.tipo && sp.tipo in ENTITY ? sp.tipo : '';
  let q = supabase
    .from('audit_log')
    .select('id,occurred_at,actor_role,action,entity,entity_id,changed_fields,context')
    .order('id', { ascending: false })
    .range((page - 1) * PAGE, page * PAGE);
  if (tipo) q = q.eq('entity', tipo);
  const { data } = await q;
  const rows = data ?? [];
  const more = rows.length > PAGE;

  return (
    <>
      <PageHeader title="Bitácora" subtitle="Registro de accesos y cambios. Indica qué cambió, nunca el contenido clínico. No se puede editar ni borrar." />
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="tipo" className="text-[13.5px] font-medium">
            Tipo
          </label>
          <select id="tipo" name="tipo" defaultValue={tipo} className="field min-w-56">
            <option value="">Todo</option>
            {Object.entries(ENTITY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={btn('secondary')}>
          Filtrar
        </button>
      </form>
      {!rows.length ? (
        <EmptyState title="Sin registros." />
      ) : (
        <ol className="panel divide-y divide-linea">
          {rows.slice(0, PAGE).map((r) => {
            const ctx = r.context as { status_from?: string; status_to?: string } | null;
            const link = href(r.entity as string, r.entity_id as string | null);
            const fields = ((r.changed_fields as string[] | null) ?? []).map((f) => FIELD[f] ?? f.replace(/_/g, ' '));
            const who =
              r.actor_role === 'anon' ? 'Página pública' : r.actor_role === 'service_role' ? 'Sistema' : r.actor_role === 'authenticated' ? 'Tú' : 'Sistema';
            return (
              <li key={r.id as number} className="grid gap-1 px-4 py-3 sm:grid-cols-[170px_1fr] sm:gap-4 sm:px-5">
                <span className="text-[13.5px] tabular-nums text-tenue">{fmtDateTime(r.occurred_at as string)}</span>
                <span className="text-[15px]">
                  <span className="text-tenue">{who} · </span>
                  {ACTION[r.action as string] ?? r.action}{' '}
                  {r.entity === 'sesion' ? null : link ? (
                    <Link className="link" href={link}>
                      {(ENTITY[r.entity as string] ?? r.entity).toLowerCase()}
                    </Link>
                  ) : (
                    (ENTITY[r.entity as string] ?? r.entity).toLowerCase()
                  )}
                  {ctx?.status_to && (
                    <span className="text-tenue">
                      {' '}
                      · {stateLabel(ctx.status_from)} → {stateLabel(ctx.status_to)}
                    </span>
                  )}
                  {r.action === 'update' && fields.length > 0 && !ctx?.status_to && <span className="text-tenue"> · {fields.join(', ')}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-5 flex gap-2">
        {page > 1 && (
          <Link className={btn('secondary', 'sm')} href={`/admin/bitacora?pagina=${page - 1}${tipo ? `&tipo=${tipo}` : ''}`}>
            ← Más recientes
          </Link>
        )}
        {more && (
          <Link className={btn('secondary', 'sm')} href={`/admin/bitacora?pagina=${page + 1}${tipo ? `&tipo=${tipo}` : ''}`}>
            Anteriores →
          </Link>
        )}
      </div>
    </>
  );
}
