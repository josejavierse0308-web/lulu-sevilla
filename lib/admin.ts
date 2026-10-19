import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminContext } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { fail, type ActionResult } from '@/lib/action-result';

/**
 * Envoltorio para las acciones del panel: verifica la sesión en el servidor
 * (además de RLS) y convierte cualquier error en un mensaje claro.
 */
export async function adminAction(fn: (supabase: SupabaseClient) => Promise<ActionResult>): Promise<ActionResult> {
  const ctx = await getAdminContext();
  if (ctx.status !== 'ok') {
    return { ok: false, message: 'Tu sesión expiró. Vuelve a iniciar sesión.', redirectTo: '/admin/ingresar' };
  }
  try {
    return await fn(ctx.supabase);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

/** Lanza si Supabase devolvió error; así adminAction lo traduce. */
export function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw r.error;
  return r.data;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function str(fd: FormData, key: string, max = 2000): string {
  return String(fd.get(key) ?? '')
    .trim()
    .slice(0, max);
}

export function optStr(fd: FormData, key: string, max = 2000): string | null {
  const v = str(fd, key, max);
  return v ? v : null;
}

export function uuid(fd: FormData, key: string): string | null {
  const v = str(fd, key, 40);
  return UUID.test(v) ? v : null;
}

/** Valor entre comillas para filtros or() de PostgREST. */
export function pgq(v: string) {
  return `"${v.replace(/[\\"]/g, (c) => '\\' + c)}"`;
}

/** Número de WhatsApp: dígitos; 10 dígitos de México → 52 + número. */
export function waNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length === 10) return '52' + d;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

export { APPT_SELECT, apptName, type ApptRow } from '@/lib/admin-types';

export async function logView(supabase: SupabaseClient, entity: string, id: string) {
  await supabase.rpc('log_access', { p_action: 'view', p_entity: entity, p_entity_id: id });
}
