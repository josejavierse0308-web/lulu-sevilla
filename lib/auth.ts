import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createSessionClient } from '@/lib/supabase/server';

export type AdminContext =
  | { status: 'anon' }
  | { status: 'forbidden' }
  | { status: 'mfa'; supabase: SupabaseClient; user: User }
  | { status: 'ok'; supabase: SupabaseClient; user: User; mfaEnabled: boolean };

/**
 * Verifica la sesión contra el servidor de autenticación (getUser valida el
 * token, no solo lee la cookie) y comprueba que sea la cuenta registrada en
 * admin_users. La base de datos vuelve a aplicar la misma regla en cada
 * consulta mediante RLS, así que esto es una segunda barrera, no la única.
 */
export const getAdminContext = cache(async (): Promise<AdminContext> => {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { status: 'anon' };
  const user = data.user;

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfaEnabled = aal?.nextLevel === 'aal2';
  if (mfaEnabled && aal?.currentLevel !== 'aal2') return { status: 'mfa', supabase, user };

  // Con RLS, esta fila solo es visible si la sesión es la cuenta autorizada.
  const { data: row } = await supabase.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!row) return { status: 'forbidden' };

  return { status: 'ok', supabase, user, mfaEnabled };
});

/** Para páginas y acciones del panel: redirige si no hay sesión válida. */
export async function requireAdmin() {
  const ctx = await getAdminContext();
  if (ctx.status === 'anon') redirect('/admin/ingresar');
  if (ctx.status === 'mfa') redirect('/admin/verificar');
  if (ctx.status === 'forbidden') redirect('/admin/ingresar?motivo=cuenta');
  return ctx;
}
