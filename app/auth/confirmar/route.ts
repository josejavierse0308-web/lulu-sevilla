import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSessionClient } from '@/lib/supabase/server';

const ALLOWED_TYPES: EmailOtpType[] = ['recovery', 'email', 'email_change'];

/**
 * Destino de los enlaces de correo de Supabase (recuperar contraseña).
 * Acepta el flujo PKCE (?code=) y el de token_hash (?token_hash=&type=).
 * Solo redirige dentro de /admin para evitar redirecciones abiertas.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = url.searchParams.get('siguiente') ?? '/admin';
  const safeNext = /^\/admin(\/[a-z-]*)*$/.test(next) ? next : '/admin';
  const supabase = await createSessionClient();

  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;

  let okFlow = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    okFlow = !error;
  } else if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    okFlow = !error;
  }

  const to = url.clone();
  to.search = '';
  if (okFlow) {
    to.pathname = safeNext;
  } else {
    to.pathname = '/admin/ingresar';
    to.searchParams.set('motivo', 'enlace');
  }
  return NextResponse.redirect(to);
}
