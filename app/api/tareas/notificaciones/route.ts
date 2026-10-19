import { processOutbox } from '@/lib/notifications';
import { env } from '@/lib/env';
import { json } from '@/lib/http';
import { safeEqual } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

/** Lo llama la función programada de Netlify cada 10 minutos. */
export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.cronSecret}`;
  if (!safeEqual(auth, expected)) return json({ error: 'no_autorizado' }, 401);
  try {
    const summary = await processOutbox(40);
    return json({ ok: true, ...summary });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'error' }, 500);
  }
}
