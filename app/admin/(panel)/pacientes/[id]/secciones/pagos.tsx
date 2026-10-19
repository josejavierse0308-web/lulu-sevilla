import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { CHARGE_STATE, PAYMENT_METHOD, PAYMENT_STATUS } from '@/lib/labels';
import { fmtDate, money, todayKey } from '@/lib/format';
import { ActionForm, Field, Select, TextArea } from '@/components/forms';
import { Badge, EmptyState, Section } from '@/components/ui';
import { anularPago, cancelarCargo, confirmarPago, crearCargo, registrarPago } from '../../../pagos/actions';
import type { Patient } from '@/lib/admin-types';

type Charge = {
  id: string;
  appointment_id: string | null;
  description: string;
  amount_cents: number;
  charged_on: string;
  status: string;
  paid_cents: number;
  pending_cents: number;
  payment_state: string;
};
type Payment = {
  id: string;
  charge_id: string | null;
  amount_cents: number;
  paid_on: string;
  method: string;
  reference: string | null;
  notes: string | null;
  status: string;
  void_reason: string | null;
};

export async function Pagos({ patient: p }: { patient: Patient }) {
  const { supabase } = await requireAdmin();
  const [{ data: ch }, { data: pay }, { data: bal }] = await Promise.all([
    supabase.from('charge_balances').select('*').eq('patient_id', p.id).order('charged_on', { ascending: false }),
    supabase
      .from('payments')
      .select('id,charge_id,amount_cents,paid_on,method,reference,notes,status,void_reason')
      .eq('patient_id', p.id)
      .order('paid_on', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase.from('patient_balances').select('*').eq('patient_id', p.id).maybeSingle(),
  ]);
  const charges = (ch ?? []) as Charge[];
  const payments = (pay ?? []) as Payment[];
  const open = charges.filter((c) => c.status === 'activo' && c.pending_cents > 0);
  const balance = Number(bal?.balance_cents ?? 0);

  return (
    <div className="grid gap-6">
      <section aria-label="Saldo" className="panel grid gap-4 p-5 sm:grid-cols-4 sm:p-6">
        <div>
          <p className="text-[13.5px] text-tenue">Saldo</p>
          <p className={`display text-[34px] tabular-nums ${balance > 0 ? 'text-ocre-700' : ''}`}>
            {balance < 0 ? `A favor ${money(-balance)}` : money(balance)}
          </p>
        </div>
        <div>
          <p className="text-[13.5px] text-tenue">Cargos</p>
          <p className="text-[18px] tabular-nums">{money(Number(bal?.charged_cents ?? 0))}</p>
        </div>
        <div>
          <p className="text-[13.5px] text-tenue">Pagos recibidos</p>
          <p className="text-[18px] tabular-nums">{money(Number(bal?.paid_cents ?? 0))}</p>
        </div>
        <div>
          <p className="text-[13.5px] text-tenue">Por confirmar</p>
          <p className="text-[18px] tabular-nums">{money(Number(bal?.unconfirmed_cents ?? 0))}</p>
        </div>
        <p className="text-[13.5px] text-tenue sm:col-span-4">
          Precio por sesión: {p.session_price_cents != null ? `${money(p.session_price_cents)} (propio de este paciente)` : 'el del tipo de sesión'} ·{' '}
          <Link className="link" href={`/admin/pacientes/${p.id}/editar`}>
            cambiar
          </Link>
        </p>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Section title="Cargos" description="Se generan solos al registrar una sesión como realizada. También puedes agregar uno manual.">
            {!charges.length ? (
              <EmptyState title="Sin cargos." />
            ) : (
              <ul className="divide-y divide-linea">
                {charges.map((c) => {
                  const st = CHARGE_STATE[c.payment_state]!;
                  return (
                    <li key={c.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`text-[15.5px] ${c.status === 'cancelado' ? 'line-through opacity-60' : ''}`}>{c.description}</p>
                          <p className="text-[13px] text-tenue">
                            {fmtDate(c.charged_on + 'T18:00:00Z', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {c.appointment_id && (
                              <>
                                {' · '}
                                <Link className="link" href={`/admin/agenda/${c.appointment_id}`}>
                                  ver sesión
                                </Link>
                              </>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-right tabular-nums">
                            <span className="block text-[15.5px]">{money(c.amount_cents)}</span>
                            {c.payment_state === 'parcial' && <span className="block text-[12.5px] text-tenue">faltan {money(c.pending_cents)}</span>}
                          </span>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </div>
                      </div>
                      {c.status === 'activo' && (
                        <details className="mt-2">
                          <summary className="min-h-8 cursor-pointer text-[13.5px] text-tenue">Cancelar cargo</summary>
                          <ActionForm
                            action={cancelarCargo}
                            submitLabel="Cancelar cargo"
                            submitVariant="danger"
                            confirm={{
                              title: '¿Cancelar este cargo?',
                              body: 'Dejará de contar en el saldo. Si ya tenía pagos, quedarán como saldo a favor.',
                              confirmLabel: 'Cancelar cargo',
                              danger: true,
                            }}
                            className="mt-2"
                          >
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="paciente" value={p.id} />
                            <Field label="Motivo" name="motivo" maxLength={300} required />
                          </ActionForm>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Pagos">
            {!payments.length ? (
              <EmptyState title="Sin pagos registrados." />
            ) : (
              <ul className="divide-y divide-linea">
                {payments.map((x) => {
                  const st = PAYMENT_STATUS[x.status]!;
                  const charge = charges.find((c) => c.id === x.charge_id);
                  return (
                    <li key={x.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`text-[15.5px] tabular-nums ${x.status === 'anulado' ? 'line-through opacity-60' : ''}`}>
                            {money(x.amount_cents)} <span className="text-tenue">· {PAYMENT_METHOD[x.method]}</span>
                          </p>
                          <p className="text-[13px] text-tenue">
                            {fmtDate(x.paid_on + 'T18:00:00Z', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {charge ? ` · ${charge.description}` : ' · anticipo / a cuenta'}
                            {x.reference ? ` · Ref. ${x.reference}` : ''}
                          </p>
                          {x.notes && <p className="text-[13px] text-tenue">{x.notes}</p>}
                          {x.void_reason && <p className="text-[13px] text-rosa-700">Anulado: {x.void_reason}</p>}
                        </div>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </div>
                      {x.status !== 'anulado' && (
                        <div className="mt-2 flex flex-wrap items-start gap-2">
                          {x.status === 'por_confirmar' && (
                            <ActionForm
                              inline
                              action={confirmarPago}
                              submitLabel="Confirmar recepción"
                              submitVariant="secondary"
                              confirm={{
                                title: '¿Confirmas que recibiste este pago?',
                                body: 'A partir de ahora contará como ingreso.',
                                confirmLabel: 'Sí, lo recibí',
                              }}
                            >
                              <input type="hidden" name="id" value={x.id} />
                              <input type="hidden" name="paciente" value={p.id} />
                            </ActionForm>
                          )}
                          <details>
                            <summary className="flex min-h-11 cursor-pointer items-center text-[13.5px] text-tenue">Anular</summary>
                            <ActionForm
                              action={anularPago}
                              submitLabel="Anular pago"
                              submitVariant="danger"
                              confirm={{
                                title: '¿Anular este pago?',
                                body: 'Se conserva en el historial como anulado y el saldo se recalcula.',
                                confirmLabel: 'Anular',
                                danger: true,
                              }}
                            >
                              <input type="hidden" name="id" value={x.id} />
                              <input type="hidden" name="paciente" value={p.id} />
                              <Field label="Motivo" name="motivo" maxLength={300} required />
                            </ActionForm>
                          </details>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Section
            title="Registrar pago"
            description="Registra solo dinero que ya recibiste. Si aún no lo verificas (por ejemplo, una transferencia), márcalo como por confirmar."
          >
            <ActionForm action={registrarPago} submitLabel="Registrar pago" className="grid gap-4">
              <input type="hidden" name="paciente" value={p.id} />
              <Select label="Aplicar a" name="cargo" defaultValue={open[0]?.id ?? ''}>
                {open.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.description} · pendiente {money(c.pending_cents)}
                  </option>
                ))}
                <option value="">Anticipo / a cuenta (sin cargo)</option>
              </Select>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Monto (MXN)" name="monto" inputMode="decimal" required defaultValue={open[0] ? String(open[0].pending_cents / 100) : ''} />
                <Field label="Fecha de pago" name="fecha" type="date" required max={todayKey()} defaultValue={todayKey()} />
              </div>
              <Select label="Método" name="metodo" defaultValue="transferencia">
                {Object.entries(PAYMENT_METHOD).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <Field label="Referencia" name="referencia" optional maxLength={80} hint="Folio o clave de rastreo. Nunca el número completo de una tarjeta." />
              <Select label="Estado" name="estado" defaultValue="confirmado">
                <option value="confirmado">Recibido y verificado</option>
                <option value="por_confirmar">Por confirmar</option>
              </Select>
              <TextArea label="Notas" name="notas" optional maxLength={300} rows={2} />
            </ActionForm>
          </Section>

          <Section title="Cargo manual">
            <ActionForm action={crearCargo} submitLabel="Agregar cargo" submitVariant="secondary" className="grid gap-4">
              <input type="hidden" name="paciente" value={p.id} />
              <Field label="Concepto" name="concepto" required maxLength={140} placeholder="Ej. Evaluación, informe, material" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Monto (MXN)" name="monto" inputMode="decimal" required />
                <Field label="Fecha" name="fecha" type="date" required defaultValue={todayKey()} />
              </div>
            </ActionForm>
            <p className="mt-4 text-[13.5px] text-tenue">
              Este panel es de control administrativo: no procesa cobros con tarjeta ni guarda datos bancarios.{' '}
              <Link className="link" href="/admin/pagos">
                Ver resumen general
              </Link>
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
