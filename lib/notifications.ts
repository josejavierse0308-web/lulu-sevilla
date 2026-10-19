import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { env } from '@/lib/env';
import { manageUrl } from '@/lib/tokens';
import { renderTemplate } from '@/lib/templates';
import { fmtDayLong, fmtTime, MODALITY_LABEL } from '@/lib/format';

type Claimed = {
  id: string;
  kind: 'solicitud_recibida' | 'solicitud_admin' | 'cita_confirmada' | 'recordatorio' | 'cita_cancelada';
  appointment_id: string;
  recipient: string | null;
  person_name: string | null;
  starts_at: string;
  ends_at: string;
  service_name: string;
  modality: 'en_linea' | 'presencial';
  location_details: string | null;
  timezone: string;
  template: string | null;
};

const SUBJECTS: Record<Claimed['kind'], string> = {
  solicitud_recibida: 'Recibí tu solicitud de cita',
  solicitud_admin: 'Nueva solicitud de cita',
  cita_confirmada: 'Tu sesión está confirmada',
  recordatorio: 'Recordatorio de tu sesión',
  cita_cancelada: 'Tu sesión fue cancelada',
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Mensaje de texto. Solo usa datos de la cita: nunca información clínica. */
export function composeMessage(n: Claimed): { subject: string; text: string; link: string } {
  const fecha = fmtDayLong(n.starts_at, n.timezone);
  const hora = fmtTime(n.starts_at, n.timezone);
  if (n.kind === 'solicitud_admin') {
    const link = `${env.siteUrl}/admin/agenda/${n.appointment_id}`;
    return {
      subject: SUBJECTS[n.kind],
      text: `Tienes una nueva solicitud de cita para el ${fecha} a las ${hora}. Revísala y confírmala desde tu panel.`,
      link,
    };
  }
  const link = n.kind === 'cita_cancelada' ? `${env.siteUrl}/#agenda` : manageUrl(n.appointment_id);
  const text = renderTemplate(n.template ?? '', {
    nombre: n.person_name ?? '',
    fecha,
    hora,
    servicio: n.service_name,
    modalidad: MODALITY_LABEL[n.modality],
    lugar: n.location_details ? `Lugar o enlace: ${n.location_details}.` : '',
    enlace: link,
  });
  return { subject: SUBJECTS[n.kind], text, link };
}

function toHtml(subject: string, text: string, link: string) {
  const body = escapeHtml(text)
    .replace(escapeHtml(link), `<a href="${escapeHtml(link)}" style="color:#5B5182">${escapeHtml(link)}</a>`)
    .replace(/\n/g, '<br>');
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F2EEE8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#25262C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#FBF9F6;border-radius:20px;border:1px solid rgba(37,38,44,.12)"><tr><td style="padding:32px 28px">
<p style="margin:0 0 6px;font-family:Georgia,serif;font-style:italic;font-size:22px">Lulu Sevilla</p>
<h1 style="margin:0 0 18px;font-family:Georgia,serif;font-weight:400;font-size:26px">${escapeHtml(subject)}</h1>
<p style="margin:0;font-size:16px;line-height:1.6">${body}</p>
</td></tr></table>
<p style="margin:18px 0 0;font-size:12px;color:#5F5A54">Este mensaje es automático y solo contiene datos de tu cita.</p>
</td></tr></table></body></html>`;
}

async function sendEmail(to: string, subject: string, text: string, html: string) {
  // RESEND_API_URL solo se define en pruebas locales (servidor simulado).
  const res = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.resendApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Procesa la cola. Lo llama la función programada y, al instante, cada solicitud nueva. */
export async function processOutbox(limit = 20) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('claim_notifications', { p_limit: limit });
  if (error) throw new Error(`claim_notifications: ${error.message}`);
  const rows = (data ?? []) as Claimed[];
  const emailReady = !!(env.resendApiKey && env.emailFrom);
  const summary = { sent: 0, skipped: 0, failed: 0 };

  for (const n of rows) {
    let result: 'enviado' | 'omitido' | 'error' = 'omitido';
    let note: string | null = null;
    try {
      if (!n.recipient) {
        note = 'sin_destinatario';
      } else if (!emailReady) {
        note = 'correo_no_configurado';
      } else {
        const m = composeMessage(n);
        await sendEmail(n.recipient, m.subject, m.text, toHtml(m.subject, m.text, m.link));
        result = 'enviado';
      }
    } catch (e) {
      result = 'error';
      note = e instanceof Error ? e.message : 'error';
    }
    await supabase.rpc('complete_notification', { p_id: n.id, p_result: result, p_error: note });
    if (result === 'enviado') summary.sent++;
    else if (result === 'omitido') summary.skipped++;
    else summary.failed++;
  }
  return summary;
}
