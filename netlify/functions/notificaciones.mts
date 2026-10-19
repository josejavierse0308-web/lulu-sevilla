// Función programada de Netlify (ver netlify.toml: cada 10 minutos).
// No toca la base de datos directamente: llama al endpoint protegido del sitio,
// que es quien procesa la cola de confirmaciones y recordatorios.
export default async () => {
  const site = process.env.URL || process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.CRON_SECRET;
  if (!site || !secret) {
    console.error('Faltan URL/NEXT_PUBLIC_SITE_URL o CRON_SECRET');
    return new Response('config', { status: 500 });
  }
  const res = await fetch(`${site.replace(/\/+$/, '')}/api/tareas/notificaciones`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log('notificaciones', res.status, body.slice(0, 200));
  return new Response(null, { status: res.ok ? 204 : 502 });
};
