import { z } from 'zod';
import { getSlots } from '@/lib/public-api';
import { json } from '@/lib/http';
import { friendlyError } from '@/lib/errors';
import { isDateKey } from '@/lib/format';

export const dynamic = 'force-dynamic';

const Query = z.object({
  servicio: z.uuid(),
  desde: z.string().refine(isDateKey),
  hasta: z.string().refine(isDateKey),
});

export async function GET(request: Request) {
  const u = new URL(request.url);
  const q = Query.safeParse(Object.fromEntries(u.searchParams));
  if (!q.success) return json({ error: 'solicitud_invalida', message: friendlyError('solicitud_invalida') }, 400);
  const r = await getSlots(q.data.servicio, q.data.desde, q.data.hasta);
  if (r.error) return json({ error: r.error, message: friendlyError(r.error) }, r.error === 'reservas_cerradas' ? 409 : 400);
  return json({ slots: r.data });
}
