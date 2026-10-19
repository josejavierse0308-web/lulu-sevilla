import { after } from 'next/server';
import { z } from 'zod';
import { requestBooking } from '@/lib/public-api';
import { isSameOrigin, json } from '@/lib/http';
import { friendlyError } from '@/lib/errors';
import { manageUrl } from '@/lib/tokens';
import { processOutbox } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

const Body = z.object({
  servicio: z.uuid(),
  inicio: z.iso.datetime({ offset: true }),
  nombre: z.string().trim().min(2).max(120),
  correo: z.string().trim().max(254).optional().default(''),
  telefono: z.string().trim().max(25).optional().default(''),
  contacto: z.enum(['whatsapp', 'telefono', 'correo']),
  aviso: z.uuid(),
  acepta: z.literal(true),
  menor: z.boolean().optional().default(false),
  // Campo trampa: las personas no lo ven; los robots suelen llenarlo.
  sitio: z.string().max(0).optional().default(''),
});

const FIELD_ERRORS: Record<string, string> = {
  nombre_invalido: 'nombre',
  correo_invalido: 'correo',
  correo_requerido: 'correo',
  telefono_invalido: 'telefono',
  telefono_requerido: 'telefono',
  contacto_requerido: 'correo',
  consentimiento_requerido: 'acepta',
};

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ error: 'solicitud_invalida', message: friendlyError('solicitud_invalida') }, 403);
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > 8_000) return json({ error: 'solicitud_invalida', message: friendlyError('solicitud_invalida') }, 413);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'solicitud_invalida', message: friendlyError('solicitud_invalida') }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const path = String(parsed.error.issues[0]?.path[0] ?? '');
    if (path === 'sitio') return json({ error: 'solicitud_invalida', message: friendlyError('solicitud_invalida') }, 400);
    const code = path === 'acepta' ? 'consentimiento_requerido' : path === 'nombre' ? 'nombre_invalido' : 'solicitud_invalida';
    return json({ error: code, field: FIELD_ERRORS[code], message: friendlyError(code) }, 400);
  }
  const b = parsed.data;

  const r = await requestBooking(
    {
      serviceId: b.servicio,
      startsAt: b.inicio,
      name: b.nombre,
      email: b.correo || null,
      phone: b.telefono || null,
      contactPref: b.contacto,
      privacyId: b.aviso,
      acceptsPrivacy: b.acepta,
      forMinor: b.menor,
    },
    request.headers,
  );
  if ('error' in r) {
    const status = r.error === 'demasiados_intentos' ? 429 : r.error === 'horario_no_disponible' ? 409 : 400;
    const code = r.error ?? 'solicitud_invalida';
    return json({ error: code, field: FIELD_ERRORS[code], message: friendlyError(code) }, status);
  }

  // Envía el acuse en cuanto termine la respuesta (si el correo está configurado).
  after(async () => {
    try {
      await processOutbox(10);
    } catch {
      // La función programada lo reintentará.
    }
  });

  return json({ ok: true, cita: { inicio: r.startsAt, fin: r.endsAt, estado: r.status }, enlace: manageUrl(r.id) }, 201);
}
