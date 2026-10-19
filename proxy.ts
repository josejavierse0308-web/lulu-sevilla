import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Rutas del panel que se pueden abrir sin sesión.
const PUBLIC_ADMIN = ['/admin/ingresar', '/admin/recuperar', '/admin/restablecer', '/admin/verificar'];

/**
 * Refresca la sesión de Supabase en cada navegación del panel y redirige al
 * inicio de sesión cuando no hay usuario. Es una comprobación optimista: la
 * autorización real se vuelve a verificar en el servidor (lib/auth.ts) y en
 * la base de datos (RLS).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_ADMIN.some((p) => path === p || path.startsWith(p + '/'));

  if (!data.user && !isPublic) {
    const to = request.nextUrl.clone();
    to.pathname = '/admin/ingresar';
    to.search = '';
    const redirect = NextResponse.redirect(to);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/auth/:path*'],
};
