import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Cliente con la clave de servicio. SOLO lo usa el procesador de
 * notificaciones (lib/notifications.ts) y solo llama a dos funciones de la
 * base de datos: claim_notifications y complete_notification.
 * Nunca se importa desde componentes de cliente ni desde el panel.
 */
export function createServiceClient() {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
