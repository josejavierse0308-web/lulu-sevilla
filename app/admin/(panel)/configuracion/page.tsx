import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { env } from '@/lib/env';
import { fmtDateTime, money, MODALITY_LABEL, WEEKDAYS, minutesLabel } from '@/lib/format';
import { LEGAL_KIND } from '@/lib/labels';
import { ActionForm, Field, Select, TextArea, Toggle } from '@/components/forms';
import { Badge, EmptyState, Notice, PageHeader, Section } from '@/components/ui';
import {
  agregarBloqueo,
  agregarFranja,
  cambiarContrasena,
  cerrarOtrasSesiones,
  desactivarDosPasos,
  eliminarBloqueo,
  eliminarFranja,
  eliminarServicio,
  guardarNotificaciones,
  guardarPerfil,
  guardarReservas,
  guardarServicio,
  publicarDocumento,
} from './actions';
import { DosPasos } from './dos-pasos';

export const metadata = { title: 'Configuración' };

const SECTIONS: Array<[string, string]> = [
  ['reservas', 'Agenda en línea'],
  ['servicios', 'Servicios y precios'],
  ['horario', 'Horario de atención'],
  ['bloqueos', 'Días no disponibles'],
  ['perfil', 'Perfil público y contacto'],
  ['notificaciones', 'Notificaciones'],
  ['legal', 'Aviso de privacidad y consentimiento'],
  ['seguridad', 'Seguridad'],
  ['datos', 'Datos y privacidad'],
];

type Settings = Record<string, unknown> & {
  booking_enabled: boolean;
  slot_interval_min: number;
  min_notice_hours: number;
  max_days_ahead: number;
  patient_change_min_hours: number;
  max_pending_per_contact: number;
};

export default async function ConfigPage({ searchParams }: { searchParams: Promise<{ seccion?: string }> }) {
  const { supabase, mfaEnabled } = await requireAdmin();
  const { seccion } = await searchParams;
  const current = SECTIONS.some(([k]) => k === seccion) ? seccion! : 'reservas';
  const { data } = await supabase.from('practice_settings').select('*').single();
  const s = data as Settings;

  return (
    <>
      <PageHeader title="Configuración" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav
          aria-label="Secciones de configuración"
          className="no-print -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:sticky lg:top-8 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0"
        >
          {SECTIONS.map(([k, v]) => (
            <Link
              key={k}
              href={`/admin/configuracion?seccion=${k}`}
              aria-current={current === k ? 'page' : undefined}
              className={`flex min-h-10 shrink-0 items-center rounded-full px-4 text-[14.5px] transition-colors lg:rounded-xl ${current === k ? 'bg-tinta text-hueso' : 'hover:bg-[rgb(37_38_44/0.06)]'}`}
            >
              {v}
            </Link>
          ))}
        </nav>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {current === 'reservas' && <Reservas s={s} />}
          {current === 'servicios' && <Servicios />}
          {current === 'horario' && <Horario />}
          {current === 'bloqueos' && <Bloqueos />}
          {current === 'perfil' && <Perfil s={s} />}
          {current === 'notificaciones' && <Notificaciones s={s} />}
          {current === 'legal' && <Legal />}
          {current === 'seguridad' && <Seguridad mfaEnabled={mfaEnabled} />}
          {current === 'datos' && <Datos />}
        </div>
      </div>
    </>
  );

  async function Reservas({ s }: { s: Settings }) {
    const [{ count: services }, { count: rules }, { count: privacy }] = await Promise.all([
      supabase.from('session_types').select('id', { count: 'exact', head: true }).eq('active', true).eq('is_public', true),
      supabase.from('availability_rules').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('legal_documents').select('id', { count: 'exact', head: true }).eq('kind', 'aviso_privacidad').eq('is_current', true),
    ]);
    const checks: Array<[boolean, string, string]> = [
      [!!privacy, 'Aviso de privacidad publicado', 'legal'],
      [!!services, 'Al menos un servicio visible en la página', 'servicios'],
      [!!rules, 'Horario de atención configurado', 'horario'],
    ];
    return (
      <Section title="Agenda en línea" description="Controla si la sección “Agenda tu sesión” de tu página acepta solicitudes y con qué reglas.">
        <ul className="mb-6 grid gap-2">
          {checks.map(([okv, label, sec]) => (
            <li key={label} className="flex items-center justify-between gap-3 text-[15px]">
              <span className="flex items-center gap-2">
                <span aria-hidden className={`size-2.5 rounded-full ${okv ? 'bg-salvia-700' : 'bg-ocre-700'}`} />
                {label}
              </span>
              {okv ? (
                <span className="text-[13.5px] text-salvia-700">Listo</span>
              ) : (
                <Link className="link text-[14px]" href={`/admin/configuracion?seccion=${sec}`}>
                  Configurar
                </Link>
              )}
            </li>
          ))}
        </ul>
        <ActionForm action={guardarReservas} submitLabel="Guardar" className="grid gap-5">
          <Toggle
            name="activar"
            label="Aceptar solicitudes desde la página"
            description="Si la apagas, la página muestra que la agenda abrirá pronto y ofrece tu contacto."
            defaultChecked={s.booking_enabled}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Intervalo entre horarios (min)"
              name="intervalo"
              type="number"
              min={10}
              max={240}
              defaultValue={s.slot_interval_min}
              hint="Cada cuánto inicia un horario ofrecido. Ej. 60 → 9:00, 10:00…"
            />
            <Field
              label="Anticipación mínima (horas)"
              name="anticipacion"
              type="number"
              min={0}
              max={720}
              defaultValue={s.min_notice_hours}
              hint="No se ofrecen horarios más pronto que esto."
            />
            <Field label="Agenda abierta hasta (días)" name="dias" type="number" min={1} max={365} defaultValue={s.max_days_ahead} />
            <Field
              label="Cambios del paciente hasta (horas antes)"
              name="cambios"
              type="number"
              min={0}
              max={720}
              defaultValue={s.patient_change_min_hours}
              hint="Plazo para cancelar o reprogramar desde su enlace."
            />
            <Field label="Solicitudes pendientes por persona" name="pendientes" type="number" min={1} max={10} defaultValue={s.max_pending_per_contact} />
          </div>
          <TextArea
            label="Política de cancelación"
            name="politica_cancelacion"
            optional
            rows={3}
            maxLength={2000}
            defaultValue={(s.cancellation_policy as string) ?? ''}
            hint="Se muestra al paciente en su enlace antes de cancelar."
          />
          <TextArea
            label="Política de reprogramación"
            name="politica_reprogramacion"
            optional
            rows={3}
            maxLength={2000}
            defaultValue={(s.reschedule_policy as string) ?? ''}
          />
        </ActionForm>
      </Section>
    );
  }

  async function Servicios() {
    const { data } = await supabase.from('session_types').select('*').order('sort_order').order('name');
    const list = data ?? [];
    return (
      <>
        <Section
          title="Servicios y precios"
          description="Solo los servicios visibles y activos se ofrecen en la página. El margen es el tiempo libre que se reserva después de cada sesión."
        >
          {!list.length ? (
            <EmptyState title="Aún no hay servicios." />
          ) : (
            <ul className="divide-y divide-linea">
              {list.map((sv) => (
                <li key={sv.id as string} className="py-4">
                  <details>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                      <span>
                        <span className="block text-[16px] font-medium">{sv.name as string}</span>
                        <span className="block text-[13.5px] text-tenue">
                          {MODALITY_LABEL[sv.modality as string]} · {minutesLabel(sv.duration_min as number)}
                          {(sv.buffer_min as number) > 0 ? ` + ${sv.buffer_min} min de margen` : ''} · {money(sv.price_cents as number)}
                        </span>
                      </span>
                      <span className="flex gap-2">
                        {!sv.active ? (
                          <Badge tone="neutro">Inactivo</Badge>
                        ) : sv.is_public ? (
                          <Badge tone="salvia">En la página</Badge>
                        ) : (
                          <Badge tone="lavanda">Solo panel</Badge>
                        )}
                      </span>
                    </summary>
                    <div className="mt-4 rounded-2xl border border-linea p-4">
                      <ServiceForm values={sv} />
                      <ActionForm
                        inline
                        action={eliminarServicio}
                        submitLabel="Eliminar servicio"
                        submitVariant="quiet"
                        confirm={{
                          title: '¿Eliminar este servicio?',
                          body: 'Solo es posible si no tiene citas. Si ya las tiene, mejor desactívalo.',
                          confirmLabel: 'Eliminar',
                          danger: true,
                        }}
                        className="mt-3"
                      >
                        <input type="hidden" name="id" value={sv.id as string} />
                      </ActionForm>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Nuevo servicio">
          <ServiceForm values={{}} />
        </Section>
      </>
    );
  }

  function ServiceForm({ values: v }: { values: Record<string, unknown> }) {
    const editing = !!v.id;
    return (
      <ActionForm
        action={guardarServicio}
        submitLabel={editing ? 'Guardar servicio' : 'Crear servicio'}
        submitVariant={editing ? 'secondary' : 'primary'}
        className="grid gap-4"
      >
        {editing && <input type="hidden" name="id" value={v.id as string} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" name="nombre" required maxLength={80} defaultValue={(v.name as string) ?? ''} placeholder="Ej. Sesión individual" />
          <Select label="Modalidad" name="modalidad" defaultValue={(v.modality as string) ?? 'en_linea'}>
            <option value="en_linea">En línea</option>
            <option value="presencial">Presencial</option>
          </Select>
          <Field label="Duración (min)" name="duracion" type="number" min={15} max={240} required defaultValue={(v.duration_min as number) ?? 50} />
          <Field label="Margen después (min)" name="margen" type="number" min={0} max={120} defaultValue={(v.buffer_min as number) ?? 10} />
          <Field
            label="Precio (MXN)"
            name="precio"
            inputMode="decimal"
            required
            defaultValue={v.price_cents != null ? String((v.price_cents as number) / 100) : ''}
          />
          <Field label="Orden" name="orden" type="number" min={0} max={99} defaultValue={(v.sort_order as number) ?? 0} hint="Menor número aparece primero." />
        </div>
        <TextArea
          label="Descripción breve"
          name="descripcion"
          optional
          rows={2}
          maxLength={400}
          defaultValue={(v.description as string) ?? ''}
          hint="Se muestra en la página. Sin información clínica."
        />
        <div className="grid gap-1 sm:grid-cols-2">
          <Toggle name="publico" label="Visible en la página" defaultChecked={editing ? !!v.is_public : true} />
          <Toggle name="activo" label="Activo" defaultChecked={editing ? !!v.active : true} />
        </div>
      </ActionForm>
    );
  }

  async function Horario() {
    const { data } = await supabase
      .from('availability_rules')
      .select('id,weekday,start_time,end_time,modality')
      .eq('active', true)
      .order('weekday')
      .order('start_time');
    const rules = data ?? [];
    const order = [1, 2, 3, 4, 5, 6, 0];
    return (
      <>
        <Section
          title="Horario de atención"
          description="Franjas en las que se ofrecen horarios. Para un descanso, crea dos franjas (por ejemplo 9:00–13:00 y 16:00–19:00)."
        >
          <ul className="divide-y divide-linea">
            {order.map((d) => {
              const day = rules.filter((r) => r.weekday === d);
              return (
                <li key={d} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="w-28 text-[15.5px] font-medium">{WEEKDAYS[d]}</span>
                  <span className="flex flex-1 flex-wrap gap-2">
                    {day.length ? (
                      day.map((r) => (
                        <span
                          key={r.id as string}
                          className="inline-flex items-center gap-1 rounded-full border border-linea-fuerte bg-superficie py-1 pl-3 pr-1 text-[14px] tabular-nums"
                        >
                          {(r.start_time as string).slice(0, 5)}–{(r.end_time as string).slice(0, 5)}
                          {r.modality ? <span className="text-tenue"> · {MODALITY_LABEL[r.modality as string]}</span> : null}
                          <ActionForm
                            inline
                            action={eliminarFranja}
                            submitLabel="×"
                            submitVariant="quiet"
                            confirm={{ title: '¿Quitar esta franja?', body: 'Las citas ya agendadas no cambian.', confirmLabel: 'Quitar' }}
                          >
                            <input type="hidden" name="id" value={r.id as string} />
                          </ActionForm>
                        </span>
                      ))
                    ) : (
                      <span className="text-[14px] text-tenue">Sin atención</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
        <Section title="Agregar franja">
          <ActionForm action={agregarFranja} submitLabel="Agregar">
            <div className="grid gap-4 sm:grid-cols-4 sm:items-end">
              <Select label="Día" name="dia" defaultValue="1">
                {order.map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAYS[d]}
                  </option>
                ))}
              </Select>
              <Field label="Desde" name="inicio" type="time" required defaultValue="09:00" step={300} />
              <Field label="Hasta" name="fin" type="time" required defaultValue="13:00" step={300} />
              <Select label="Modalidad" name="modalidad" defaultValue="">
                <option value="">Cualquiera</option>
                <option value="en_linea">Solo en línea</option>
                <option value="presencial">Solo presencial</option>
              </Select>
            </div>
          </ActionForm>
        </Section>
      </>
    );
  }

  async function Bloqueos() {
    const { data } = await supabase.from('time_off').select('id,starts_at,ends_at,reason').gt('ends_at', new Date().toISOString()).order('starts_at');
    return (
      <>
        <Section
          title="Días no disponibles"
          description="Vacaciones, congresos o cualquier periodo sin atención. El motivo es privado: nunca se muestra en la página."
        >
          {(data ?? []).length ? (
            <ul className="divide-y divide-linea">
              {(data ?? []).map((t) => (
                <li key={t.id as string} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block text-[15.5px]">
                      {fmtDateTime(t.starts_at as string)} → {fmtDateTime(t.ends_at as string)}
                    </span>
                    {t.reason && <span className="block text-[13.5px] text-tenue">{t.reason as string}</span>}
                  </span>
                  <ActionForm
                    inline
                    action={eliminarBloqueo}
                    submitLabel="Quitar"
                    submitVariant="quiet"
                    confirm={{ title: '¿Quitar este bloqueo?', confirmLabel: 'Quitar' }}
                  >
                    <input type="hidden" name="id" value={t.id as string} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-tenue">No hay periodos bloqueados próximos.</p>
          )}
        </Section>
        <Section title="Bloquear un periodo">
          <ActionForm action={agregarBloqueo} submitLabel="Bloquear" className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Desde (día)" name="desde" type="date" required />
              <Field label="Hasta (día)" name="hasta" type="date" optional hint="Déjalo vacío para un solo día." />
            </div>
            <Toggle name="todo_el_dia" label="Días completos" defaultChecked />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Hora de inicio" name="hora_desde" type="time" optional hint="Solo si no son días completos." />
              <Field label="Hora de fin" name="hora_hasta" type="time" optional />
            </div>
            <Field label="Motivo (privado)" name="motivo" optional maxLength={200} />
          </ActionForm>
        </Section>
      </>
    );
  }

  function Perfil({ s }: { s: Settings }) {
    return (
      <Section
        title="Perfil público y contacto"
        description="Estos datos reemplazan los marcadores de la sección “Soy Lulu” y los botones de contacto de tu página. Escribe solo información real y verificable; si dejas un campo vacío, no se publica."
      >
        <ActionForm action={guardarPerfil} submitLabel="Guardar y publicar" className="grid gap-4">
          <TextArea label="Presentación (2–3 líneas)" name="presentacion" optional rows={3} maxLength={600} defaultValue={(s.public_intro as string) ?? ''} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Formación profesional" name="formacion" optional maxLength={200} defaultValue={(s.public_education as string) ?? ''} />
            <Field label="Cédula profesional" name="cedula" optional maxLength={60} defaultValue={(s.public_license as string) ?? ''} />
            <Field label="Enfoque terapéutico" name="enfoque" optional maxLength={200} defaultValue={(s.public_approach as string) ?? ''} />
            <Field
              label="Modalidad"
              name="modalidad"
              optional
              maxLength={200}
              defaultValue={(s.public_modality as string) ?? ''}
              placeholder="Ej. En línea y presencial en Tuxtla"
            />
          </div>
          <h3 className="display mt-4 text-[22px]">Contacto</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="WhatsApp"
              name="whatsapp"
              type="tel"
              optional
              maxLength={20}
              defaultValue={(s.contact_whatsapp as string) ?? ''}
              hint="Con lada del país. Si escribes 10 dígitos se agrega 52."
            />
            <Field label="Correo de contacto" name="correo" type="email" optional maxLength={254} defaultValue={(s.contact_email as string) ?? ''} />
          </div>
          <Field label="Dirección del consultorio" name="direccion" optional maxLength={300} defaultValue={(s.contact_address as string) ?? ''} />
          <Toggle
            name="mostrar_precios"
            label="Mostrar precios en la página"
            description="Si la apagas, el paciente ve el servicio y la duración, sin precio."
            defaultChecked={!!s.show_prices_public}
          />
        </ActionForm>
      </Section>
    );
  }

  function Notificaciones({ s }: { s: Settings }) {
    const emailReady = !!(env.resendApiKey && env.emailFrom);
    return (
      <Section title="Notificaciones" description="Los mensajes solo incluyen datos de la cita: nunca información clínica.">
        {!emailReady && (
          <div className="mb-5">
            <Notice tone="ocre">
              El envío de correos aún no está configurado (faltan RESEND_API_KEY y EMAIL_FROM en Netlify). Mientras tanto, el paciente ve su confirmación en
              pantalla y tú puedes avisar por WhatsApp desde cada cita.
            </Notice>
          </div>
        )}
        <ActionForm action={guardarNotificaciones} submitLabel="Guardar" className="grid gap-5">
          <div className="grid gap-1">
            <Toggle
              name="correo_pacientes"
              label="Enviar correos a pacientes"
              description="Acuse de solicitud, confirmación y aviso de cancelación (si dejaron correo)."
              defaultChecked={!!s.notify_patient_email}
            />
            <Toggle name="recordatorios" label="Enviar recordatorios" description="Solo para citas confirmadas." defaultChecked={!!s.reminders_enabled} />
            <Toggle name="avisarme" label="Avisarme de cada nueva solicitud" defaultChecked={!!s.admin_alert_on_request} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Recordatorio con anticipación (horas)"
              name="horas_recordatorio"
              type="number"
              min={1}
              max={168}
              defaultValue={s.reminder_hours_before as number}
            />
            <Field
              label="Correo donde recibes los avisos"
              name="correo_avisos"
              type="email"
              optional
              maxLength={254}
              defaultValue={(s.admin_alert_email as string) ?? ''}
              hint="El aviso no incluye el nombre del paciente."
            />
          </div>
          <p className="text-[14px] text-tenue">
            Variables disponibles: <code>{'{nombre}'}</code> <code>{'{fecha}'}</code> <code>{'{hora}'}</code> <code>{'{servicio}'}</code>{' '}
            <code>{'{modalidad}'}</code> <code>{'{lugar}'}</code> <code>{'{enlace}'}</code>
          </p>
          <TextArea label="Acuse de solicitud" name="tpl_request_received" rows={3} maxLength={1500} defaultValue={s.tpl_request_received as string} />
          <TextArea label="Confirmación" name="tpl_confirmed" rows={3} maxLength={1500} defaultValue={s.tpl_confirmed as string} />
          <TextArea label="Recordatorio" name="tpl_reminder" rows={3} maxLength={1500} defaultValue={s.tpl_reminder as string} />
          <TextArea label="Cancelación" name="tpl_cancelled" rows={3} maxLength={1500} defaultValue={s.tpl_cancelled as string} />
        </ActionForm>
      </Section>
    );
  }

  async function Legal() {
    const { data } = await supabase
      .from('legal_documents')
      .select('id,kind,version,title,body,is_current,published_at')
      .order('kind')
      .order('version', { ascending: false });
    const docs = data ?? [];
    return (
      <>
        <Notice tone="lavanda">
          El texto legal lo redactas tú (idealmente con asesoría). Debe cumplir la Ley Federal de Protección de Datos Personales en Posesión de los
          Particulares: identidad y domicilio del responsable, datos que se recaban (incluidos los sensibles de salud), finalidades, transferencias, medios para
          ejercer los derechos ARCO y para revocar el consentimiento, y cómo se comunican los cambios. Cada versión publicada queda fija y se registra cuál
          aceptó cada persona.
        </Notice>
        {(['aviso_privacidad', 'consentimiento_informado'] as const).map((kind) => {
          const versions = docs.filter((d) => d.kind === kind);
          const cur = versions.find((d) => d.is_current);
          return (
            <Section
              key={kind}
              title={LEGAL_KIND[kind]}
              description={cur ? `Vigente: versión ${cur.version}, publicada ${fmtDateTime(cur.published_at as string)}` : 'Aún no se ha publicado.'}
            >
              <ActionForm
                action={publicarDocumento}
                submitLabel={cur ? 'Publicar nueva versión' : 'Publicar'}
                confirm={{
                  title: '¿Publicar esta versión?',
                  body: 'Quedará fija y será la vigente desde ahora. Las versiones anteriores se conservan.',
                  confirmLabel: 'Publicar',
                }}
                className="grid gap-4"
              >
                <input type="hidden" name="tipo" value={kind} />
                <Field label="Título" name="titulo" required maxLength={140} defaultValue={(cur?.title as string) ?? LEGAL_KIND[kind]} />
                <TextArea
                  label="Texto"
                  name="contenido"
                  required
                  rows={14}
                  maxLength={60000}
                  defaultValue={(cur?.body as string) ?? ''}
                  hint="Separa los párrafos con una línea en blanco."
                />
              </ActionForm>
              {versions.length > 1 && (
                <details className="mt-5">
                  <summary className="min-h-9 cursor-pointer text-[14.5px]">Versiones anteriores ({versions.length - 1})</summary>
                  <ul className="mt-3 grid gap-3">
                    {versions
                      .filter((d) => !d.is_current)
                      .map((d) => (
                        <li key={d.id as string} className="rounded-2xl border border-linea p-4">
                          <p className="text-[14px] text-tenue">
                            Versión {d.version as number} · {fmtDateTime(d.published_at as string)}
                          </p>
                          <p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[14px]">{d.body as string}</p>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </Section>
          );
        })}
      </>
    );
  }

  async function Seguridad({ mfaEnabled }: { mfaEnabled: boolean }) {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp?.find((f) => f.status === 'verified');
    return (
      <>
        <Section
          title="Verificación en dos pasos"
          description="Además de tu contraseña, se pedirá un código de una aplicación como Google Authenticator, 1Password o Authy. Muy recomendable para un expediente clínico."
        >
          {mfaEnabled && totp ? (
            <div className="grid gap-4">
              <Notice tone="salvia">Activada desde {fmtDateTime(totp.created_at)}.</Notice>
              <ActionForm
                action={desactivarDosPasos}
                submitLabel="Desactivar"
                submitVariant="danger"
                confirm={{
                  title: '¿Desactivar la verificación en dos pasos?',
                  body: 'Tu cuenta quedará protegida solo con la contraseña.',
                  confirmLabel: 'Desactivar',
                  danger: true,
                }}
              >
                <input type="hidden" name="factor" value={totp.id} />
              </ActionForm>
            </div>
          ) : (
            <DosPasos />
          )}
        </Section>
        <Section title="Contraseña">
          <ActionForm action={cambiarContrasena} submitLabel="Cambiar contraseña" className="grid max-w-md gap-4">
            <Field label="Contraseña actual" name="actual" type="password" autoComplete="current-password" required />
            <Field
              label="Nueva contraseña"
              name="nueva"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              hint="Al menos 12 caracteres, combinando tipos."
            />
            <Field label="Repite la nueva contraseña" name="confirmar" type="password" autoComplete="new-password" required minLength={12} />
          </ActionForm>
        </Section>
        <Section title="Sesiones" description="Si iniciaste sesión en otro equipo y no recuerdas haberla cerrado.">
          <ActionForm action={cerrarOtrasSesiones} submitLabel="Cerrar sesiones en otros dispositivos" submitVariant="secondary" inline>
            <span />
          </ActionForm>
          <p className="mt-4 text-[14px] text-tenue">
            El panel cierra la sesión sola tras 30 minutos sin actividad. Para revisar accesos y cambios, consulta la{' '}
            <Link className="link" href="/admin/bitacora">
              bitácora
            </Link>
            .
          </p>
        </Section>
      </>
    );
  }

  function Datos() {
    return (
      <Section title="Datos y privacidad" description="Cómo se protege y se conserva la información del expediente.">
        <div className="grid max-w-[70ch] gap-4 text-[15.5px] leading-relaxed">
          <p>
            <strong className="font-medium">Acceso.</strong> Solo tu cuenta puede ver expedientes, notas, documentos y pagos. La base de datos lo verifica en
            cada consulta, no solo el panel. Los documentos están en almacenamiento privado y se descargan con enlaces temporales.
          </p>
          <p>
            <strong className="font-medium">Bitácora.</strong> Se registra quién abrió o modificó cada expediente y qué campos cambiaron, sin copiar el
            contenido clínico.
          </p>
          <p>
            <strong className="font-medium">Conservación.</strong> Los registros clínicos no se borran: se anulan con motivo. Conserva los expedientes por el
            plazo que marque la normativa aplicable (la NOM-004-SSA3-2012 establece un mínimo de 5 años desde el último acto registrado). Para dejar de usar un
            expediente, cámbialo a “Archivado”.
          </p>
          <p>
            <strong className="font-medium">Derechos ARCO.</strong> Si un paciente solicita acceso, rectificación, cancelación u oposición: verifica su
            identidad, responde dentro de 20 días hábiles y deja constancia. La rectificación se hace editando sus datos; para la cancelación, archiva el
            expediente (bloqueo) y elimínalo al terminar el plazo de conservación siguiendo el procedimiento de la guía de operación.
          </p>
          <p>
            <strong className="font-medium">Respaldos.</strong> Supabase hace respaldos automáticos diarios en los planes de pago. Revisa la guía de despliegue
            para activar la recuperación a un punto en el tiempo y para descargar un respaldo propio cifrado.
          </p>
        </div>
      </Section>
    );
  }
}
