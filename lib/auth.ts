import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSessionClient } from '@/lib/supabase/server';

export type SessionUser = { id: string; email: string | null };

export type AdminContext =
  | { status: 'anon' }
  | { status: 'forbidden' }
  | { status: 'mfa'; supabase: SupabaseClient; user: SessionUser }
  | { status: 'ok'; supabase: SupabaseClient; user: SessionUser; mfaEnabled: boolean };

/**
 * Identifica la sesión verificando la firma del token (getClaims). El proyecto
 * firma con llaves asimétricas (ES256), así que la verificación es local con
 * la llave pública: no hace falta un viaje al servidor de autenticación en
 * cada pantalla. Después comprueba que sea la cuenta registrada en
 * admin_users. La base de datos vuelve a aplicar la misma regla en cada
 * consulta mediante RLS, así que esto es una segunda barrera, no la única.
 */
export const getAdminContext = cache(async (): Promise<AdminContext> => {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return { status: 'anon' };
  const user: SessionUser = { id: claims.sub, email: (claims.email as string | undefined) ?? null };

  // Con RLS, esta fila solo es visible si la sesión es la cuenta autorizada y,
  // si activó la verificación en dos pasos, si ya la superó (aal2).
  const { data: row } = await supabase.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!row) {
    // ¿No se ve porque falta el segundo paso? (solo en este caso se consulta).
    if (claims.aal !== 'aal2') {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel === 'aal2') return { status: 'mfa', supabase, user };
    }
    return { status: 'forbidden' };
  }

  // Si la sesión está en aal2 es porque tiene la verificación activa; si está en
  // aal1 y aun así ve su fila, la base de datos confirma que no la tiene.
  return { status: 'ok', supabase, user, mfaEnabled: claims.aal === 'aal2' };
});

/**
 * Para acciones que modifican datos: además de la firma, confirma con el
 * servidor de autenticación que la sesión siga vigente (por ejemplo, que no se
 * haya cerrado desde «Cerrar sesiones en otros dispositivos»).
 */
export async function getVerifiedAdminContext(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (ctx.status !== 'ok') return ctx;
  const { data, error } = await ctx.supabase.auth.getUser();
  if (error || !data.user || data.user.id !== ctx.user.id) return { status: 'anon' };
  return ctx;
}

/** Para páginas del panel: redirige si no hay sesión válida. */
export async function requireAdmin() {
  const ctx = await getAdminContext();
  if (ctx.status === 'anon') redirect('/admin/ingresar');
  if (ctx.status === 'mfa') redirect('/admin/verificar');
  if (ctx.status === 'forbidden') redirect('/admin/ingresar?motivo=cuenta');
  return ctx;
}
