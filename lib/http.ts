import 'server-only';

/** IP del visitante. Netlify la entrega en x-nf-client-connection-ip. */
export function clientIp(headers: Headers): string {
  const nf = headers.get('x-nf-client-connection-ip');
  if (nf) return nf.trim();
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return headers.get('x-real-ip')?.trim() || 'desconocida';
}

/** Rechaza peticiones que no vienen del propio sitio (protección CSRF básica). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const o = new URL(origin);
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    return !!host && o.host === host;
  } catch {
    return false;
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
