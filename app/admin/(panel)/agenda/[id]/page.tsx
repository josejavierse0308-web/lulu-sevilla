import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { pgq, UUID, waNumber } from '@/lib/admin';
import { APPOINTMENT_STATUS, CHARGE_STATE, CONTACT_PREF, NOTIFICATION_KIND, NOTIFICATION_STATUS } from '@/lib/labels';
import { dateKey, fmtDateTime, fmtDayLong, fmtTime, money, MODALITY_LABEL, minutesLabel } from '@/lib/format';
import { renderTemplate } from '@/lib/templates';
import { manageUrl } from '@/lib/tokens';
import { Badge, btn, KeyValue, Notice, PageHeader, Section } from '@/components/ui';
import { ActionForm, Field, Select, TextArea } from '@/components/forms';
import { cambiarEstado, cancelarCita, confirmarCita, guardarLugar, reprogramarCita } from '../actions';
import { SlotPicker } from '../slot-picker';

export const metadata = { title: 'Cita' };

type Detail = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  modality: 'en_linea' | 'presencial';
  source: 'publica' | 'panel';
  price_cents: number | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  requester_contact_pref: string | null;
  location_details: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  rescheduled_from: string | null;
  rescheduled_to: string | null;
  created_at: string;
  session_type_id: string;
  patient: { id: string; full_name: string; internal_code: string; email: string | null; phone: string | null; preferred_contact: string | null } | null;
  service: { name: string; duration_min: number } | null;
};

export default async function CitaDetalle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase } = await requireAdmin();

  const { data } = await supabase
    .from('appointments')
    .select(
      'id,starts_at,ends_at,status,modality,source,price_cents,requester_name,requester_email,requester_phone,requester_contact_pref,location_details,confirmed_at,completed_at,cancelled_at,cancelled_by,cancel_reason,rescheduled_from,rescheduled_to,created_at,session_type_id,patient:patients(id,full_name,internal_code,email,phone,preferred_contact),service:session_types(name,duration_min)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!data) notFound();
  const a = data as unknown as Detail;

  const [{ data: notes }, { data: consents }, { data: charge }, { data: settings }, matches, { data: patients }] = await Promise.all([
    supabase.from('notification_outbox').select('kind,status,send_after,sent_at').eq('appointment_id', id).order('created_at'),
    supabase.from('consents').select('id,accepted_at,on_behalf_of_minor,method,doc:legal_documents(title,version)').eq('appointment_id', id),
    supabase.from('charge_balances').select('id,amount_cents,paid_cents,pending_cents,payment_state').eq('appointment_id', id).maybeSingle(),
    supabase.from('practice_settings').select('tpl_confirmed,tpl_reminder').single(),
    !a.patient && (a.requester_email || a.requester_phone)
      ? supabase
          .from('patients')
          .select('id,full_name,internal_code')
          .or(
            [a.requester_email ? `email.eq.${pgq(a.requester_email)}` : null, a.requester_phone ? `phone.eq.${pgq(a.requester_phone)}` : null]
              .filter(Boolean)
              .join(','),
          )
          .limit(5)
      : Promise.resolve({ data: [] as { id: string; full_name: string; internal_code: string }[] }),
    !a.patient
      ? supabase.from('patients').select('id,full_name,internal_code').neq('status', 'archivado').order('full_name').limit(300)
      : Promise.resolve({ data: [] }),
  ]);

  const st = APPOINTMENT_STATUS[a.status] ?? { label: a.status, tone: 'neutro' as const };
  const name = a.patient?.full_name ?? a.requester_name ?? 'Sin nombre';
  const active = a.status === 'pendiente' || a.status === 'confirmada';
  const past = new Date(a.starts_at).getTime() <= Date.now();
  const phone = a.patient?.phone ?? a.requester_phone;
  const email = a.patient?.email ?? a.requester_email;
  const wa = waNumber(phone);
  const suggested = (matches.data ?? []) as { id: string; full_name: string; internal_code: string }[];
  const others = ((patients ?? []) as { id: string; full_name: string; internal_code: string }[]).filter((p) => !suggested.some((s) => s.id === p.id));

  const vars = {
    nombre: name.split(' ')[0],
    fecha: fmtDayLong(a.starts_at),
    hora: fmtTime(a.starts_at),
    servicio: a.service?.name,
    modalidad: MODALITY_LABEL[a.modality],
    lugar: a.location_details ? `Lugar o enlace: ${a.location_details}.` : '',
    enlace: manageUrl(a.id),
  };
  const waLink = (tpl?: string | null) => (wa && tpl ? `https://wa.me/${wa}?text=${encodeURIComponent(renderTemplate(tpl, vars))}` : null);

  return (
    <>
      <PageHeader
        back={{ href: `/admin/agenda?vista=dia&fecha=${dateKey(a.starts_at)}`, label: 'Agenda' }}
        title={
          <>
            {fmtDayLong(a.starts_at).replace(/^./, (c) => c.toUpperCase())}, <em>{fmtTime(a.starts_at)}</em>
          </>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span>
              {a.service?.name} · {MODALITY_LABEL[a.modality]} · {minutesLabel(a.service?.duration_min ?? 50)}
            </span>
          </span>
        }
        actions={
          a.patient ? (
            <Link href={`/admin/pacientes/${a.patient.id}`} className={btn('secondary')}>
              Ver expediente
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {a.rescheduled_to && (
            <Notice tone="neutro">
              Esta cita se reprogramó.{' '}
              <Link href={`/admin/agenda/${a.rescheduled_to}`} className="link">
                Ver la nueva cita
              </Link>
            </Notice>
          )}

          {a.status === 'pendiente' && (
            <Section
              title="Confirmar solicitud"
              description={a.patient ? undefined : 'Vincúlala a un expediente existente o crea uno nuevo con los datos de la solicitud.'}
            >
              <ActionForm action={confirmarCita} submitLabel="Confirmar cita" pendingLabel="Confirmando…" className="grid gap-4">
                <input type="hidden" name="id" value={a.id} />
                {!a.patient && (
                  <Select label="Expediente" name="paciente" defaultValue={suggested[0]?.id ?? 'nuevo'}>
                    <option value="nuevo">Crear expediente nuevo para {a.requester_name}</option>
                    {suggested.length > 0 && (
                      <optgroup label="Coinciden por correo o teléfono">
                        {suggested.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.full_name} · {p.internal_code}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {others.length > 0 && (
                      <optgroup label="Otros expedientes">
                        {others.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.full_name} · {p.internal_code}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                )}
                <Field
                  label={a.modality === 'en_linea' ? 'Enlace de la videollamada' : 'Dirección o indicaciones'}
                  name="lugar"
                  optional
                  defaultValue={a.location_details ?? ''}
                  maxLength={300}
                  hint="Se incluye en la confirmación y en el recordatorio."
                />
              </ActionForm>
            </Section>
          )}

          {a.status === 'confirmada' && past && (
            <Section title="¿Cómo fue esta sesión?" description="Registrar la sesión como realizada genera su cargo con el precio correspondiente.">
              <div className="flex flex-wrap gap-3">
                <ActionForm
                  action={cambiarEstado}
                  submitLabel="Registrar como realizada"
                  confirm={{ title: '¿Registrar como realizada?', body: 'Se generará el cargo de la sesión en el expediente.', confirmLabel: 'Sí, registrar' }}
                >
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="estado" value="completada" />
                </ActionForm>
                <ActionForm inline action={cambiarEstado} submitLabel="No asistió" submitVariant="secondary">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="estado" value="no_asistio" />
                </ActionForm>
              </div>
            </Section>
          )}

          {a.status === 'completada' && a.patient && (
            <Section title="Sesión realizada">
              <div className="flex flex-wrap gap-3">
                <Link href={`/admin/pacientes/${a.patient.id}/registros/nuevo?cita=${a.id}`} className={btn('primary')}>
                  Escribir nota de sesión
                </Link>
                <ActionForm
                  inline
                  action={cambiarEstado}
                  submitLabel="Corregir: no asistió"
                  submitVariant="quiet"
                  confirm={{
                    title: '¿Corregir el registro?',
                    body: 'El cargo generado se conserva; puedes cancelarlo desde Pagos si corresponde.',
                    confirmLabel: 'Corregir',
                  }}
                >
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="estado" value="no_asistio" />
                </ActionForm>
              </div>
            </Section>
          )}
          {a.status === 'no_asistio' && (
            <Section title="El paciente no asistió">
              <ActionForm
                inline
                action={cambiarEstado}
                submitLabel="Corregir: sí asistió"
                submitVariant="secondary"
                confirm={{ title: '¿Registrar como realizada?', body: 'Se generará el cargo de la sesión.', confirmLabel: 'Sí, registrar' }}
              >
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="estado" value="completada" />
              </ActionForm>
            </Section>
          )}

          {a.status === 'confirmada' && (
            <Section title={a.modality === 'en_linea' ? 'Enlace de la sesión' : 'Lugar de la sesión'}>
              <ActionForm action={guardarLugar} submitLabel="Guardar" submitVariant="secondary">
                <input type="hidden" name="id" value={a.id} />
                <Field
                  label={a.modality === 'en_linea' ? 'Enlace de la videollamada' : 'Dirección o indicaciones'}
                  name="lugar"
                  defaultValue={a.location_details ?? ''}
                  maxLength={300}
                />
              </ActionForm>
            </Section>
          )}

          {active && (
            <details className="panel group p-5 sm:p-7">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between">
                <span className="display text-[28px]">Reprogramar</span>
                <span aria-hidden className="text-[22px] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="mt-5">
                <ActionForm action={reprogramarCita} submitLabel="Reprogramar cita" pendingLabel="Reprogramando…">
                  <input type="hidden" name="id" value={a.id} />
                  <SlotPicker fixedServiceId={a.session_type_id} exclude={a.id} defaultDay={dateKey(a.starts_at)} />
                </ActionForm>
              </div>
            </details>
          )}

          {active && (
            <details className="panel group p-5 sm:p-7">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between">
                <span className="display text-[28px]">Cancelar</span>
                <span aria-hidden className="text-[22px] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="mt-5">
                <ActionForm
                  action={cancelarCita}
                  submitLabel="Cancelar cita"
                  submitVariant="danger"
                  confirm={{
                    title: '¿Cancelar esta cita?',
                    body: 'El horario quedará libre. Si el paciente dejó correo, recibirá un aviso.',
                    confirmLabel: 'Sí, cancelar',
                    danger: true,
                  }}
                >
                  <input type="hidden" name="id" value={a.id} />
                  <TextArea
                    label="Motivo (administrativo)"
                    name="motivo"
                    optional
                    maxLength={300}
                    rows={2}
                    hint="Solo lo ves tú. No escribas información clínica."
                  />
                </ActionForm>
              </div>
            </details>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Section title="Paciente">
            <KeyValue
              items={[
                [
                  'Nombre',
                  a.patient ? (
                    <Link className="link" href={`/admin/pacientes/${a.patient.id}`}>
                      {a.patient.full_name}
                    </Link>
                  ) : (
                    a.requester_name
                  ),
                ],
                ['Expediente', a.patient?.internal_code ?? 'Sin vincular'],
                ['Teléfono', phone],
                ['Correo', email],
                ['Prefiere', CONTACT_PREF[a.patient?.preferred_contact ?? a.requester_contact_pref ?? ''] ?? null],
              ]}
            />
            {wa && active && (
              <div className="mt-4 flex flex-wrap gap-2">
                {a.status === 'confirmada' && waLink(settings?.tpl_confirmed) && (
                  <a className={btn('secondary', 'sm')} href={waLink(settings?.tpl_confirmed)!} target="_blank" rel="noopener noreferrer">
                    Confirmación por WhatsApp
                  </a>
                )}
                {a.status === 'confirmada' && waLink(settings?.tpl_reminder) && (
                  <a className={btn('secondary', 'sm')} href={waLink(settings?.tpl_reminder)!} target="_blank" rel="noopener noreferrer">
                    Recordatorio por WhatsApp
                  </a>
                )}
                {a.status === 'pendiente' && (
                  <a className={btn('secondary', 'sm')} href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">
                    Escribir por WhatsApp
                  </a>
                )}
              </div>
            )}
          </Section>

          {charge && (
            <Section title="Pago">
              <KeyValue
                items={[
                  ['Cargo', money(charge.amount_cents)],
                  ['Pagado', money(charge.paid_cents)],
                  [
                    'Estado',
                    <Badge key="s" tone={CHARGE_STATE[charge.payment_state]?.tone ?? 'neutro'}>
                      {CHARGE_STATE[charge.payment_state]?.label}
                    </Badge>,
                  ],
                ]}
              />
              {a.patient && (
                <Link href={`/admin/pacientes/${a.patient.id}?seccion=pagos`} className="link mt-3 inline-block text-[15px]">
                  Registrar pago
                </Link>
              )}
            </Section>
          )}

          <Section title="Historial">
            <ul className="grid gap-2 text-[14.5px]">
              <li>
                Creada {fmtDateTime(a.created_at)} · {a.source === 'publica' ? 'desde la página' : 'desde el panel'}
              </li>
              {a.rescheduled_from && (
                <li>
                  Viene de una{' '}
                  <Link className="link" href={`/admin/agenda/${a.rescheduled_from}`}>
                    cita reprogramada
                  </Link>
                </li>
              )}
              {a.confirmed_at && <li>Confirmada {fmtDateTime(a.confirmed_at)}</li>}
              {a.completed_at && <li>Registrada como realizada {fmtDateTime(a.completed_at)}</li>}
              {a.cancelled_at && (
                <li>
                  Cancelada {fmtDateTime(a.cancelled_at)} por {a.cancelled_by === 'paciente' ? 'el paciente' : 'ti'}
                  {a.cancel_reason ? ` · ${a.cancel_reason}` : ''}
                </li>
              )}
              {(consents ?? []).map((c) => {
                const doc = c.doc as unknown as { title: string; version: number } | null;
                return (
                  <li key={c.id as string}>
                    Aceptó {doc?.title ?? 'el aviso'} (v{doc?.version}) {fmtDateTime(c.accepted_at as string)}
                    {c.on_behalf_of_minor ? ' · lo solicitó su madre, padre o tutor' : ''}
                  </li>
                );
              })}
            </ul>
            {(notes ?? []).length > 0 && (
              <>
                <h3 className="mb-2 mt-5 text-[14px] font-medium">Mensajes automáticos</h3>
                <ul className="grid gap-1.5 text-[14px] text-tenue">
                  {(notes ?? []).map((n, i) => (
                    <li key={i}>
                      {NOTIFICATION_KIND[n.kind as string]}: {NOTIFICATION_STATUS[n.status as string]}
                      {n.status === 'pendiente' ? ` · ${fmtDateTime(n.send_after as string)}` : n.sent_at ? ` · ${fmtDateTime(n.sent_at as string)}` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
