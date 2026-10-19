import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient as createPlainClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

/**
 * Cliente con la sesión del usuario (cookies). Se crea uno nuevo por petición.
 * Todo lo que consulta pasa por las políticas RLS de la base de datos.
 */
export async function createSessionClient() {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // En componentes de servidor no se pueden escribir cookies; el proxy
          // se encarga de refrescar la sesión en cada navegación.
        }
      },
    },
  });
}

/**
 * Cliente anónimo sin sesión, para las funciones públicas (horarios,
 * solicitudes, enlace privado). Solo puede ejecutar las funciones permitidas
 * al rol anónimo; no puede leer ninguna tabla.
 */
export function createPublicClient() {
  return createPlainClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
