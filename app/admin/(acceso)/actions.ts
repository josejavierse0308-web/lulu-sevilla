'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSessionClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { passwordProblems } from '@/lib/passwords';

const GENERIC_LOGIN_ERROR = 'Correo o contraseña incorrectos.';

async function isAdminRow(supabase: Awaited<ReturnType<typeof createSessionClient>>, userId: string) {
  const { data } = await supabase.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}

export async function iniciarSesion(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = z.object({ email: z.email().max(254), password: z.string().min(1).max(200) }).safeParse({
    email: String(fd.get('email') ?? '')
      .trim()
      .toLowerCase(),
    password: String(fd.get('password') ?? ''),
  });
  if (!parsed.success) return fail('Escribe tu correo y tu contraseña.');

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    if (error?.status === 429) return fail('Demasiados intentos. Espera unos minutos antes de volver a intentarlo.');
    return fail(GENERIC_LOGIN_ERROR);
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
    return ok(undefined, { redirectTo: '/admin/verificar' });
  }

  if (!(await isAdminRow(supabase, data.user.id))) {
    await supabase.auth.signOut();
    return fail('Esta cuenta no tiene acceso al panel.');
  }
  await supabase.rpc('log_access', { p_action: 'login', p_entity: 'sesion', p_entity_id: null });
  return ok(undefined, { redirectTo: '/admin' });
}

export async function verificarCodigo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const code = String(fd.get('code') ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return fail('Escribe los 6 dígitos de tu aplicación de autenticación.', { code: 'Deben ser 6 dígitos.' });

  const supabase = await createSessionClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return fail('Tu sesión expiró. Vuelve a iniciar sesión.', undefined);

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totp = factors?.totp?.find((f) => f.status === 'verified');
  if (!totp) return ok(undefined, { redirectTo: '/admin' });

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
  if (error) return fail('El código no es correcto o ya expiró. Usa el código que aparece ahora en tu aplicación.');

  if (!(await isAdminRow(supabase, userData.user.id))) {
    await supabase.auth.signOut();
    return fail('Esta cuenta no tiene acceso al panel.');
  }
  await supabase.rpc('log_access', { p_action: 'login', p_entity: 'sesion', p_entity_id: null });
  return ok(undefined, { redirectTo: '/admin' });
}

export async function solicitarRecuperacion(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = String(fd.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!z.email().safeParse(email).success) return fail('Escribe un correo válido.', { email: 'Revisa el correo.' });
  const supabase = await createSessionClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.siteUrl}/auth/confirmar?siguiente=/admin/restablecer`,
  });
  // Mismo mensaje exista o no la cuenta, para no revelar qué correos están registrados.
  return ok('Si el correo corresponde a la cuenta del panel, recibirás un enlace para crear una nueva contraseña. Revisa también tu carpeta de spam.', {
    resetForm: true,
  });
}

export async function restablecerContrasena(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const password = String(fd.get('password') ?? '');
  const confirm = String(fd.get('confirm') ?? '');
  const problems = passwordProblems(password);
  if (problems) return fail(problems, { password: problems });
  if (password !== confirm) return fail('Las contraseñas no coinciden.', { confirm: 'No coincide con la anterior.' });

  const supabase = await createSessionClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return fail('El enlace de recuperación expiró. Solicita uno nuevo.');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (/same|different/i.test(error.message)) return fail('La nueva contraseña debe ser distinta de la anterior.');
    if (/reauthenticat|aal2/i.test(error.message)) return fail('Por seguridad, verifica primero tu segundo factor y vuelve a intentarlo.');
    return fail('No se pudo actualizar la contraseña. Solicita un nuevo enlace e inténtalo otra vez.');
  }
  // Cierra cualquier otra sesión abierta con la contraseña anterior.
  await supabase.auth.signOut({ scope: 'others' });
  return ok('Contraseña actualizada.', { redirectTo: '/admin' });
}

export async function cerrarSesion() {
  const supabase = await createSessionClient();
  await supabase.rpc('log_access', { p_action: 'logout', p_entity: 'sesion', p_entity_id: null });
  await supabase.auth.signOut();
  redirect('/admin/ingresar?motivo=salida');
}

export async function cerrarSesionPorInactividad() {
  const supabase = await createSessionClient();
  await supabase.rpc('log_access', { p_action: 'logout', p_entity: 'sesion', p_entity_id: null });
  await supabase.auth.signOut();
  redirect('/admin/ingresar?motivo=inactividad');
}
