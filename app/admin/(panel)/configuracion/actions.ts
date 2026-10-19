'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminAction, must, optStr, str, uuid } from '@/lib/admin';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { isDateKey, parseMoneyToCents, zonedToDate } from '@/lib/format';
import { templateIsValid } from '@/lib/templates';
import { passwordProblems } from '@/lib/passwords';
import { getAdminContext } from '@/lib/auth';

const int = (fd: FormData, k: string) => {
  const n = Number(str(fd, k, 6));
  return Number.isInteger(n) ? n : NaN;
};
const inRange = (n: number, a: number, b: number) => Number.isInteger(n) && n >= a && n <= b;

function refresh() {
  revalidatePath('/admin', 'layout');
}

export async function guardarReservas(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const e: Record<string, string> = {};
    const interval = int(fd, 'intervalo');
    const notice = int(fd, 'anticipacion');
    const ahead = int(fd, 'dias');
    const change = int(fd, 'cambios');
    const pending = int(fd, 'pendientes');
    if (!inRange(interval, 10, 240)) e.intervalo = 'Entre 10 y 240 minutos.';
    if (!inRange(notice, 0, 720)) e.anticipacion = 'Entre 0 y 720 horas.';
    if (!inRange(ahead, 1, 365)) e.dias = 'Entre 1 y 365 días.';
    if (!inRange(change, 0, 720)) e.cambios = 'Entre 0 y 720 horas.';
    if (!inRange(pending, 1, 10)) e.pendientes = 'Entre 1 y 10.';
    if (Object.keys(e).length) return fail('Revisa los campos marcados.', e);
    const enable = fd.get('activar') === 'on';
    if (enable) {
      const [{ count: services }, { count: rules }, { count: privacy }] = await Promise.all([
        sb.from('session_types').select('id', { count: 'exact', head: true }).eq('active', true).eq('is_public', true),
        sb.from('availability_rules').select('id', { count: 'exact', head: true }).eq('active', true),
        sb.from('legal_documents').select('id', { count: 'exact', head: true }).eq('kind', 'aviso_privacidad').eq('is_current', true),
      ]);
      const missing = [!privacy && 'el aviso de privacidad', !services && 'al menos un servicio público', !rules && 'tu horario de atención'].filter(Boolean);
      if (missing.length) return fail(`Para abrir la agenda falta publicar ${missing.join(', ')}.`);
    }
    must(
      await sb
        .from('practice_settings')
        .update({
          booking_enabled: enable,
          slot_interval_min: interval,
          min_notice_hours: notice,
          max_days_ahead: ahead,
          patient_change_min_hours: change,
          max_pending_per_contact: pending,
          cancellation_policy: optStr(fd, 'politica_cancelacion', 2000),
          reschedule_policy: optStr(fd, 'politica_reprogramacion', 2000),
        })
        .eq('id', true)
        .select('id')
        .single(),
    );
    refresh();
    return ok(enable ? 'Guardado. La agenda en línea está abierta.' : 'Guardado. La agenda en línea está cerrada.');
  });
}

export async function guardarPerfil(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const e: Record<string, string> = {};
    const wa = str(fd, 'whatsapp', 20).replace(/\D/g, '');
    const waFinal = wa.length === 10 ? '52' + wa : wa;
    if (wa && !/^[0-9]{11,15}$/.test(waFinal)) e.whatsapp = 'Escribe el número con lada, por ejemplo 52 961 000 0000.';
    const email = optStr(fd, 'correo', 254)?.toLowerCase() ?? null;
    if (email && !z.email().safeParse(email).success) e.correo = 'Revisa el correo.';
    if (Object.keys(e).length) return fail('Revisa los campos marcados.', e);
    must(
      await sb
        .from('practice_settings')
        .update({
          public_intro: optStr(fd, 'presentacion', 600),
          public_education: optStr(fd, 'formacion', 200),
          public_license: optStr(fd, 'cedula', 60),
          public_approach: optStr(fd, 'enfoque', 200),
          public_modality: optStr(fd, 'modalidad', 200),
          show_prices_public: fd.get('mostrar_precios') === 'on',
          contact_whatsapp: wa ? waFinal : null,
          contact_email: email,
          contact_address: optStr(fd, 'direccion', 300),
        })
        .eq('id', true)
        .select('id')
        .single(),
    );
    refresh();
    return ok('Datos públicos guardados. Ya se muestran en tu página.');
  });
}

export async function guardarNotificaciones(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const e: Record<string, string> = {};
    const hours = int(fd, 'horas_recordatorio');
    if (!inRange(hours, 1, 168)) e.horas_recordatorio = 'Entre 1 y 168 horas.';
    const alert = optStr(fd, 'correo_avisos', 254)?.toLowerCase() ?? null;
    if (alert && !z.email().safeParse(alert).success) e.correo_avisos = 'Revisa el correo.';
    const tpl: Record<string, string> = {};
    for (const k of ['tpl_request_received', 'tpl_confirmed', 'tpl_reminder', 'tpl_cancelled']) {
      const v = String(fd.get(k) ?? '').trim();
      if (!v) e[k] = 'La plantilla no puede quedar vacía.';
      else if (!templateIsValid(v)) e[k] = 'Solo puedes usar {nombre}, {fecha}, {hora}, {servicio}, {modalidad}, {lugar} y {enlace}.';
      tpl[k] = v;
    }
    if (Object.keys(e).length) return fail('Revisa los campos marcados.', e);
    must(
      await sb
        .from('practice_settings')
        .update({
          notify_patient_email: fd.get('correo_pacientes') === 'on',
          reminders_enabled: fd.get('recordatorios') === 'on',
          reminder_hours_before: hours,
          admin_alert_email: alert,
          admin_alert_on_request: fd.get('avisarme') === 'on',
          ...tpl,
        })
        .eq('id', true)
        .select('id')
        .single(),
    );
    refresh();
    return ok('Preferencias de notificaciones guardadas.');
  });
}

// Servicios --------------------------------------------------------------------
function serviceFields(fd: FormData) {
  const e: Record<string, string> = {};
  const name = str(fd, 'nombre', 80);
  if (name.length < 2) e.nombre = 'Escribe un nombre.';
  const modality = str(fd, 'modalidad', 12);
  if (!['en_linea', 'presencial'].includes(modality)) e.modalidad = 'Elige la modalidad.';
  const duration = int(fd, 'duracion');
  if (!inRange(duration, 15, 240)) e.duracion = 'Entre 15 y 240 minutos.';
  const buffer = int(fd, 'margen');
  if (!inRange(buffer, 0, 120)) e.margen = 'Entre 0 y 120 minutos.';
  const price = parseMoneyToCents(str(fd, 'precio', 14));
  if (price === null) e.precio = 'Escribe un precio válido, por ejemplo 800.';
  return {
    e,
    row: {
      name,
      description: optStr(fd, 'descripcion', 400),
      modality,
      duration_min: duration,
      buffer_min: buffer,
      price_cents: price ?? 0,
      is_public: fd.get('publico') === 'on',
      active: fd.get('activo') === 'on',
      sort_order: Number.isInteger(int(fd, 'orden')) ? int(fd, 'orden') : 0,
    },
  };
}

export async function guardarServicio(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    const { e, row } = serviceFields(fd);
    if (Object.keys(e).length) return fail('Revisa los campos marcados.', e);
    if (id) must(await sb.from('session_types').update(row).eq('id', id).select('id').single());
    else must(await sb.from('session_types').insert(row).select('id').single());
    refresh();
    return ok(id ? 'Servicio actualizado. Los cambios aplican a las citas nuevas.' : 'Servicio creado.', { resetForm: !id });
  });
}

export async function eliminarServicio(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    if (!id) return fail('Servicio no válido.');
    const { count } = await sb.from('appointments').select('id', { count: 'exact', head: true }).eq('session_type_id', id);
    if (count) return fail('Este servicio ya tiene citas registradas. Desactívalo en lugar de eliminarlo.');
    must(await sb.from('session_types').delete().eq('id', id).select('id').single());
    refresh();
    return ok('Servicio eliminado.');
  });
}

// Horario ---------------------------------------------------------------------
export async function agregarFranja(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const weekday = int(fd, 'dia');
    const start = str(fd, 'inicio', 5);
    const end = str(fd, 'fin', 5);
    const modality = str(fd, 'modalidad', 12);
    const e: Record<string, string> = {};
    if (!inRange(weekday, 0, 6)) e.dia = 'Elige el día.';
    if (!/^\d{2}:\d{2}$/.test(start)) e.inicio = 'Hora no válida.';
    if (!/^\d{2}:\d{2}$/.test(end)) e.fin = 'Hora no válida.';
    if (!e.inicio && !e.fin && end <= start) e.fin = 'Debe ser después del inicio.';
    if (Object.keys(e).length) return fail('Revisa la franja.', e);
    must(
      await sb
        .from('availability_rules')
        .insert({ weekday, start_time: start, end_time: end, modality: ['en_linea', 'presencial'].includes(modality) ? modality : null })
        .select('id')
        .single(),
    );
    refresh();
    return ok('Franja agregada.');
  });
}

export async function eliminarFranja(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    if (!id) return fail('Franja no válida.');
    must(await sb.from('availability_rules').delete().eq('id', id).select('id').single());
    refresh();
    return ok('Franja eliminada. Las citas ya agendadas no cambian.');
  });
}

export async function agregarBloqueo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const fromDay = str(fd, 'desde', 10);
    const toDay = str(fd, 'hasta', 10) || fromDay;
    const allDay = fd.get('todo_el_dia') === 'on';
    const fromTime = allDay ? '00:00' : str(fd, 'hora_desde', 5) || '00:00';
    const toTime = allDay ? '00:00' : str(fd, 'hora_hasta', 5) || '23:59';
    if (!isDateKey(fromDay) || !isDateKey(toDay)) return fail('Revisa las fechas.', { desde: 'Fecha no válida.' });
    const starts = zonedToDate(fromDay, fromTime);
    const ends = allDay ? zonedToDate(new Date(Date.parse(toDay + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10), '00:00') : zonedToDate(toDay, toTime);
    if (ends <= starts) return fail('El final debe ser posterior al inicio.', { hasta: 'Revisa el final.' });
    must(
      await sb
        .from('time_off')
        .insert({ starts_at: starts.toISOString(), ends_at: ends.toISOString(), reason: optStr(fd, 'motivo', 200) })
        .select('id')
        .single(),
    );
    const { count } = await sb
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pendiente', 'confirmada'])
      .lt('starts_at', ends.toISOString())
      .gt('ends_at', starts.toISOString());
    refresh();
    return ok(
      count
        ? `Bloqueo guardado. Ojo: ya hay ${count} ${count === 1 ? 'cita' : 'citas'} en ese periodo; revísalas en la agenda.`
        : 'Bloqueo guardado. Esos horarios ya no se ofrecen en la página.',
      { resetForm: true },
    );
  });
}

export async function eliminarBloqueo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    if (!id) return fail('Bloqueo no válido.');
    must(await sb.from('time_off').delete().eq('id', id).select('id').single());
    refresh();
    return ok('Bloqueo eliminado.');
  });
}

// Documentos legales -----------------------------------------------------------
export async function publicarDocumento(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const kind = str(fd, 'tipo', 30);
    const title = str(fd, 'titulo', 140);
    const body = String(fd.get('contenido') ?? '')
      .trim()
      .slice(0, 60000);
    const e: Record<string, string> = {};
    if (!['aviso_privacidad', 'consentimiento_informado'].includes(kind)) e.tipo = 'Tipo no válido.';
    if (title.length < 3) e.titulo = 'Escribe un título.';
    if (body.length < 50) e.contenido = 'El texto es demasiado corto (mínimo 50 caracteres).';
    if (Object.keys(e).length) return fail('Revisa los campos marcados.', e);
    must(await sb.rpc('admin_publish_legal_document', { p_kind: kind, p_title: title, p_body: body }));
    refresh();
    return ok(kind === 'aviso_privacidad' ? 'Nueva versión publicada. Las solicitudes nuevas usarán este aviso.' : 'Nueva versión publicada.');
  });
}

// Seguridad --------------------------------------------------------------------
export async function cambiarContrasena(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getAdminContext();
  if (ctx.status !== 'ok') return { ok: false, message: 'Tu sesión expiró.', redirectTo: '/admin/ingresar' };
  const current = String(fd.get('actual') ?? '');
  const next = String(fd.get('nueva') ?? '');
  const problems = passwordProblems(next);
  if (problems) return fail(problems, { nueva: problems });
  if (next !== String(fd.get('confirmar') ?? '')) return fail('Las contraseñas no coinciden.', { confirmar: 'No coincide.' });
  // Verifica la contraseña actual antes de cambiarla.
  const { error: reauth } = await ctx.supabase.auth.signInWithPassword({ email: ctx.user.email!, password: current });
  if (reauth) return fail('La contraseña actual no es correcta.', { actual: 'Revisa la contraseña actual.' });
  const { error } = await ctx.supabase.auth.updateUser({ password: next });
  if (error) return fail('No se pudo cambiar la contraseña. Si tienes verificación en dos pasos, vuelve a verificar e inténtalo de nuevo.');
  await ctx.supabase.auth.signOut({ scope: 'others' });
  return ok('Contraseña actualizada. Se cerraron tus otras sesiones.', { resetForm: true, redirectTo: ctx.mfaEnabled ? '/admin/verificar' : undefined });
}

export async function cerrarOtrasSesiones(_: ActionResult): Promise<ActionResult> {
  const ctx = await getAdminContext();
  if (ctx.status !== 'ok') return { ok: false, message: 'Tu sesión expiró.', redirectTo: '/admin/ingresar' };
  await ctx.supabase.auth.signOut({ scope: 'others' });
  return ok('Se cerraron las sesiones abiertas en otros dispositivos.');
}

export async function iniciarDosPasos(): Promise<{ factorId?: string; qr?: string; secret?: string; error?: string }> {
  const ctx = await getAdminContext();
  if (ctx.status !== 'ok') return { error: 'Tu sesión expiró.' };
  // Limpia intentos previos sin verificar.
  const { data: list } = await ctx.supabase.auth.mfa.listFactors();
  for (const f of list?.all ?? []) if (f.status !== 'verified') await ctx.supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await ctx.supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Panel ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { error: 'No se pudo iniciar la configuración. Inténtalo de nuevo.' };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmarDosPasos(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getAdminContext();
  if (ctx.status !== 'ok') return { ok: false, message: 'Tu sesión expiró.', redirectTo: '/admin/ingresar' };
  const factorId = str(fd, 'factor', 60);
  const code = str(fd, 'codigo', 8).replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return fail('Escribe los 6 dígitos.', { codigo: 'Deben ser 6 dígitos.' });
  const { error } = await ctx.supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return fail('El código no coincide. Revisa que la hora de tu teléfono esté bien y usa el código actual.');
  return ok('Verificación en dos pasos activada. A partir de ahora se pedirá al iniciar sesión.', { redirectTo: '/admin/configuracion?seccion=seguridad' });
}

export async function desactivarDosPasos(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getAdminContext();
  if (ctx.status !== 'ok') return { ok: false, message: 'Tu sesión expiró.', redirectTo: '/admin/ingresar' };
  const factorId = str(fd, 'factor', 60);
  const { error } = await ctx.supabase.auth.mfa.unenroll({ factorId });
  if (error) return fail('No se pudo desactivar. Vuelve a verificar tu código e inténtalo de nuevo.');
  await ctx.supabase.auth.refreshSession();
  return ok('Verificación en dos pasos desactivada.', { redirectTo: '/admin/configuracion?seccion=seguridad' });
}
