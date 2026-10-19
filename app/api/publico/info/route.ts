import { getPublicInfo } from '@/lib/public-api';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const info = await getPublicInfo();
  if (!info) return json({ error: 'no_disponible' }, 503);
  return json(info);
}
