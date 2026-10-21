import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { CONSENT_METHOD, CONTACT_PREF } from '@/lib/labels';
import { fmtDate, fmtDateTime, fmtTime, money, MODALITY_LABEL } from '@/lib/format';
import { ActionForm, Field, Select } from '@/components/forms';
import { Badge, btn, ContactActions, KeyValue, Notice, Section } from '@/components/ui';
import { waNumber } from '@/lib/admin';
import { registrarConsentimiento, revocarConsentimiento } from '../../actions';
import type { Patient } from '@/lib/admin-types';

function age(birth: string) {
  const b = new Date(birth + 'T12:00:00Z');
  const n = new Date();
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

export async function Resumen({ patient: p }: { patient: Patient }) {
  const { supabase } = await requireAdmin();
  const [{ data: consents }, { data: docs }, { data: upcoming }] = await Promise.all([
    supabase
      .from('consents')
      .select('id,accepted_at,accepted_by_name,method,on_behalf_of_minor,revoked_at,revocation_note,doc:legal_documents(kind,title,version)')
      .eq('patient_id', p.id)
      .order('accepted_at', { ascending: false }),
    supabase.from('legal_documents').select('id,kind,title,version').eq('is_current', true),
    supabase
      .from('appointments')
      .select('id,starts_at,status,modality,service:session_types(name)')
      .eq('patient_id', p.id)
      .in('status', ['pendiente', 'confirmada'])
      .gt('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(4),
  ]);
  const minor = p.birth_date ? age(p.birth_date) < 18 : false;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <ContactActions phone={p.phone} whatsapp={waNumber(p.phone)} email={p.email} className="order-first lg:hidden" />
      <div className="grid min-w-0 grid-cols-1 content-start gap-6">
        <Section
          title="Datos generales"
          actions={
            <Link href={`/admin/pacientes/${p.id}/editar`} className={btn('secondary', 'sm')}>
              Editar datos
            </Link>
          }
        >
          <KeyValue
            items={[
              [
                'Identificador interno',
                <span key="c" className="tabular-nums">
                  {p.internal_code}
                </span>,
              ],
              [
                'Teléfono',
                p.phone ? (
                  <a key="t" className="link" href={`tel:${p.phone.replace(/[^\d+]/g, '')}`}>
                    {p.phone}
                  </a>
                ) : null,
              ],
              [
                'Correo',
                p.email ? (
                  <a key="e" className="link" href={`mailto:${p.email}`}>
                    {p.email}
                  </a>
                ) : null,
              ],
              ['Prefiere contacto por', p.preferred_contact ? CONTACT_PREF[p.preferred_contact] : null],
              ['Fecha de nacimiento', p.birth_date ? `${fmtDate(p.birth_date + 'T12:00:00Z')} · ${age(p.birth_date)} años` : null],
              [
                'Contacto de emergencia',
                p.emergency_contact_name
                  ? `${p.emergency_contact_name}${p.emergency_contact_relation ? ` (${p.emergency_contact_relation})` : ''}${p.emergency_contact_phone ? ` · ${p.emergency_contact_phone}` : ''}`
                  : null,
              ],
              ['Precio por sesión', p.session_price_cents != null ? money(p.session_price_cents) : 'El del tipo de sesión'],
              ['Registro', fmtDate(p.created_at)],
            ]}
          />
          {minor && (
            <div className="mt-4">
              <Notice tone="ocre">Según su fecha de nacimiento es menor de edad: verifica el consentimiento de su madre, padre o tutor.</Notice>
            </div>
          )}
        </Section>

        <Section title="Consentimientos" description="Avisos y consentimientos aceptados, con su versión y fecha.">
          {(consents ?? []).length ? (
            <ul className="divide-y divide-linea">
              {(consents ?? []).map((c) => {
                const doc = c.doc as unknown as { kind: string; title: string; version: number } | null;
                return (
                  <li key={c.id as string} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-[15.5px]">
                        {doc?.title} <span className="text-tenue">· v{doc?.version}</span>
                      </p>
                      <p className="text-[13.5px] text-tenue">
                        {CONSENT_METHOD[c.method as string]} · {c.accepted_by_name as string} · {fmtDateTime(c.accepted_at as string)}
                        {c.on_behalf_of_minor ? ' · en representación de menor' : ''}
                      </p>
                      {c.revoked_at && (
                        <p className="text-[13.5px] text-rosa-700">
                          Revocado {fmtDateTime(c.revoked_at as string)}
                          {c.revocation_note ? ` · ${c.revocation_note}` : ''}
                        </p>
                      )}
                    </div>
                    {!c.revoked_at && (
                      <ActionForm
                        inline
                        action={revocarConsentimiento}
                        submitLabel="Registrar revocación"
                        submitVariant="quiet"
                        confirm={{
                          title: '¿Registrar la revocación?',
                          body: 'Queda constancia de la fecha. El registro original se conserva.',
                          confirmLabel: 'Registrar',
                          danger: true,
                        }}
                      >
                        <input type="hidden" name="id" value={c.id as string} />
                        <input type="hidden" name="paciente" value={p.id} />
                      </ActionForm>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[15px] text-tenue">Aún no hay consentimientos registrados.</p>
          )}

          {(docs ?? []).length > 0 ? (
            <details className="mt-5 rounded-2xl border border-linea p-4">
              <summary className="min-h-9 cursor-pointer text-[15px] font-medium">Registrar consentimiento firmado</summary>
              <ActionForm action={registrarConsentimiento} submitLabel="Registrar" className="mt-4 grid gap-4">
                <input type="hidden" name="paciente" value={p.id} />
                <Select label="Documento" name="documento" defaultValue={(docs ?? []).find((d) => d.kind === 'consentimiento_informado')?.id ?? ''}>
                  {(docs ?? []).map((d) => (
                    <option key={d.id as string} value={d.id as string}>
                      {d.title as string} · v{d.version as number}
                    </option>
                  ))}
                </Select>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select label="Cómo se otorgó" name="metodo" defaultValue="firma_fisica">
                    <option value="firma_fisica">Firma en papel</option>
                    <option value="firma_digital">Firma digital</option>
                    <option value="verbal_registrado">Verbal (registrado)</option>
                  </Select>
                  <Field label="Quién lo otorga" name="quien" defaultValue={p.full_name} maxLength={120} />
                </div>
                <label className="flex items-center gap-3 text-[15px]">
                  <input type="checkbox" name="menor" className="size-5 accent-tinta" defaultChecked={minor} /> En representación de una persona menor de edad
                </label>
                <p className="text-[13.5px] text-tenue">Si tienes el documento firmado escaneado, súbelo en la sección Documentos.</p>
              </ActionForm>
            </details>
          ) : (
            <p className="mt-4 text-[14px] text-tenue">
              Publica tu aviso de privacidad y consentimiento informado en{' '}
              <Link className="link" href="/admin/configuracion?seccion=legal">
                Configuración
              </Link>{' '}
              para registrar consentimientos.
            </p>
          )}
        </Section>
      </div>

      {/* En el celular esta columna (próxima cita, saldo) va primero. */}
      <div className="order-first grid min-w-0 grid-cols-1 content-start gap-6 lg:order-none">
        <Section title="Seguimiento">
          <KeyValue
            items={[
              ['Última sesión', p.last_session_at ? fmtDate(p.last_session_at) : 'Aún sin sesiones realizadas'],
              [
                'Próxima cita',
                p.next_appointment_at
                  ? `${fmtDate(p.next_appointment_at, { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmtTime(p.next_appointment_at)}`
                  : 'Sin cita agendada',
              ],
              [
                'Saldo',
                p.balance_cents > 0 ? (
                  <Link key="s" href={`/admin/pacientes/${p.id}?seccion=pagos`} className="text-ocre-700 underline-offset-4 hover:underline">
                    Pendiente {money(p.balance_cents)}
                  </Link>
                ) : p.balance_cents < 0 ? (
                  `A favor ${money(-p.balance_cents)}`
                ) : (
                  'Al corriente'
                ),
              ],
            ]}
          />
        </Section>
        <Section
          title="Copia del expediente"
          description="Para atender una solicitud de acceso del paciente o resguardar en papel. Queda registrada en la bitácora."
        >
          <Link href={`/admin/pacientes/${p.id}/imprimir`} className={btn('secondary', 'sm')}>
            Ver para imprimir o exportar
          </Link>
        </Section>
        <Section
          title="Próximas citas"
          actions={
            <Link href={`/admin/agenda/nueva?paciente=${p.id}`} className={btn('secondary', 'sm')}>
              Agendar
            </Link>
          }
        >
          {(upcoming ?? []).length ? (
            <ul className="grid gap-2">
              {(upcoming ?? []).map((a) => (
                <li key={a.id as string}>
                  <Link href={`/admin/agenda/${a.id}`} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-white">
                    <span className="text-[15px]">
                      {fmtDate(a.starts_at as string, { weekday: 'short', day: 'numeric', month: 'short' })} · {fmtTime(a.starts_at as string)}
                      <span className="block text-[13px] text-tenue">
                        {(a.service as unknown as { name: string } | null)?.name} · {MODALITY_LABEL[a.modality as string]}
                      </span>
                    </span>
                    {a.status === 'pendiente' && <Badge tone="ocre">Por confirmar</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-tenue">Sin citas próximas.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
