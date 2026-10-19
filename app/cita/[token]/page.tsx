import Link from 'next/link';
import { headers } from 'next/headers';
import { ActionForm } from '@/components/forms';
import { Badge, btn } from '@/components/ui';
import { bookingByToken } from '@/lib/public-api';
import { friendlyError } from '@/lib/errors';
import { isWellFormedToken, manageToken, sha256Hex } from '@/lib/tokens';
import { fmtDayLong, fmtTime, fmtDateTime, MODALITY_LABEL, minutesLabel } from '@/lib/format';
import { APPOINTMENT_STATUS } from '@/lib/labels';
import { cancelarCita, reprogramarCita } from './actions';
import { Reprogramar } from './reprogramar';
import { Toaster } from '@/components/toaster';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tu cita', robots: { index: false, follow: false } };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative isolate min-h-svh overflow-hidden px-5 pb-20 pt-14">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -right-[20vmax] -top-[15vmax] size-[70vmax] rounded-full bg-[radial-gradient(circle,rgb(205_197_228/0.65),rgb(205_197_228/0)_62%)]" />
        <div className="absolute -left-[25vmax] bottom-[-25vmax] size-[70vmax] rounded-full bg-[radial-gradient(circle,rgb(240_214_176/0.45),rgb(240_214_176/0)_62%)]" />
      </div>
      <div className="aparecer mx-auto w-full max-w-[600px]">
        <Link href="/" className="display text-[24px] italic">
          Lulu Sevilla
        </Link>
        <div className="mt-10">{children}</div>
      </div>
      <Toaster />
    </main>
  );
}

export default async function CitaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = isWellFormedToken(token);
  const r = valid ? await bookingByToken(sha256Hex(token), await headers()) : ({ error: 'enlace_invalido' } as const);

  if ('error' in r) {
    return (
      <Shell>
        <h1 className="display text-[44px]">
          Este enlace <em>no está activo.</em>
        </h1>
        <p className="mt-4 max-w-[46ch] text-[16px] text-tenue">{friendlyError(r.error ?? 'enlace_invalido')}</p>
        <Link href="/#agenda" className={btn('primary', 'md', 'mt-8')}>
          Ir a la agenda
        </Link>
      </Shell>
    );
  }

  const b = r.booking;
  const st = APPOINTMENT_STATUS[b.status] ?? { label: b.status, tone: 'neutro' as const };
  const active = b.status === 'pendiente' || b.status === 'confirmada';
  const duration = Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000);
  const wa = b.contact_whatsapp ? `https://wa.me/${b.contact_whatsapp}?text=${encodeURIComponent('Hola Lulu, te escribo sobre mi cita.')}` : null;

  return (
    <Shell>
      <p className="text-[15px] text-tenue">{b.first_name ? `Hola, ${b.first_name}.` : 'Hola.'} Esta es tu cita.</p>
      <h1 className="display mt-3 text-[clamp(40px,10vw,60px)] first-letter:uppercase">{fmtDayLong(b.starts_at, b.timezone)}</h1>
      <p className="display mt-1 text-[32px] italic">{fmtTime(b.starts_at, b.timezone)} h</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="text-[15px] text-tenue">
          {b.service} · {MODALITY_LABEL[b.modality]} · {minutesLabel(duration)}
        </span>
      </div>

      {b.status === 'pendiente' && (
        <p className="mt-6 max-w-[52ch] text-[16px]">Tu horario está apartado. Lulu revisará tu solicitud y te confirmará por el medio que elegiste.</p>
      )}
      {b.status === 'confirmada' && b.location_details && (
        <div className="panel mt-6 p-5">
          <p className="text-[14px] text-tenue">Lugar o enlace de la sesión</p>
          <p className="mt-1 break-words text-[16px]">{b.location_details}</p>
        </div>
      )}
      {b.status === 'reprogramada' && b.rescheduled_to && (
        <div className="mt-6">
          <p className="text-[16px]">Esta cita se cambió a un nuevo horario.</p>
          <Link href={`/cita/${manageToken(b.rescheduled_to)}`} className={btn('primary', 'md', 'mt-4')}>
            Ver la nueva cita
          </Link>
        </div>
      )}
      {b.status === 'cancelada' && (
        <Link href="/#agenda" className={btn('primary', 'md', 'mt-6')}>
          Agendar otra fecha
        </Link>
      )}

      {active && b.can_change && (
        <div className="mt-12 grid gap-6">
          {b.service_bookable && (
            <details className="panel group p-5 sm:p-7">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4">
                <span className="display text-[28px]">Cambiar de horario</span>
                <span aria-hidden className="text-[22px] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="mt-5">
                <Reprogramar token={token} serviceId={b.session_type_id} tz={b.timezone} action={reprogramarCita} />
              </div>
            </details>
          )}
          <details className="panel group p-5 sm:p-7">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4">
              <span className="display text-[28px]">Cancelar la cita</span>
              <span aria-hidden className="text-[22px] transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <div className="mt-4">
              {b.cancellation_policy && <p className="mb-2 whitespace-pre-line text-[15px] text-tenue">{b.cancellation_policy}</p>}
              <ActionForm
                action={cancelarCita}
                submitLabel="Cancelar mi cita"
                pendingLabel="Cancelando…"
                submitVariant="danger"
                confirm={{ title: '¿Cancelar tu cita?', body: 'El horario quedará libre para otra persona.', confirmLabel: 'Sí, cancelar', danger: true }}
              >
                <input type="hidden" name="token" value={token} />
              </ActionForm>
            </div>
          </details>
          <p className="text-[14px] text-tenue">
            Puedes hacer cambios en línea hasta {b.patient_change_min_hours} h antes: antes de {fmtDateTime(b.change_deadline, b.timezone)}.
          </p>
        </div>
      )}

      {active && !b.can_change && (
        <p className="mt-10 max-w-[52ch] text-[15px] text-tenue">
          Ya pasó el plazo para cambiar o cancelar en línea ({b.patient_change_min_hours} h antes de la sesión). Si necesitas hacer un cambio, escribe
          directamente.
        </p>
      )}

      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={btn('secondary', 'md', 'mt-8')}>
          Escribir por WhatsApp
        </a>
      )}
      <p className="mt-14 text-[13px] text-tenue">Este enlace es personal. No lo compartas: permite gestionar tu cita.</p>
    </Shell>
  );
}
