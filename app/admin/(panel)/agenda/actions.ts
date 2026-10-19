'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { adminAction, must, optStr, str, uuid } from '@/lib/admin';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { manageTokenHash, newId } from '@/lib/tokens';
import { isDateKey, zonedToDate } from '@/lib/format';
import { processOutbox } from '@/lib/notifications';
import { getAdminContext } from '@/lib/auth';

function kickNotifications() {
  after(async () => {
    try {
      await processOutbox(10);
    } catch {
      /* la función programada reintenta */
    }
  });
}

function done(id: string, message: string, extra: Partial<NonNullable<ActionResult>> = {}) {
  revalidatePath('/admin', 'layout');
  return ok(message, extra);
}

/** Convierte inicio ISO o fecha+hora local del formulario en un instante. */
function readStart(fd: FormData): Date | null {
  const iso = str(fd, 'inicio', 40);
  if (iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const day = str(fd, 'fecha', 10);
  const time = str(fd, 'hora', 5);
  if (!isDateKey(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return zonedToDate(day, time);
}

export async function confirmarCita(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    if (!id) return fail('Cita no válida.');
    const choice = str(fd, 'paciente', 40);
    const patientId = choice === 'nuevo' || !choice ? null : uuid(fd, 'paciente');
    if (choice && choice !== 'nuevo' && !patientId) return fail('Elige un expediente válido.');
    must(await sb.rpc('admin_confirm_appointment', { p_appointment_id: id, p_patient_id: patientId, p_location_details: optStr(fd, 'lugar', 300) }));
    kickNotifications();
    return done(id, 'Cita confirmada. Se avisará al paciente si dejó correo.');
  });
}

export async function cancelarCita(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    if (!id) return fail('Cita no válida.');
    must(
      await sb
        .from('appointments')
        .update({ status: 'cancelada', cancelled_by: 'psicologa', cancel_reason: optStr(fd, 'motivo', 300) })
        .eq('id', id)
        .select('id')
        .single(),
    );
    kickNotifications();
    return done(id, 'Cita cancelada. El horario volvió a quedar libre.');
  });
}

export async function cambiarEstado(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    const status = str(fd, 'estado', 20);
    if (!id || !['completada', 'no_asistio'].includes(status)) return fail('Cambio no válido.');
    must(await sb.from('appointments').update({ status }).eq('id', id).select('id').single());
    return done(id, status === 'completada' ? 'Sesión registrada como realizada. Se generó su cargo.' : 'Registrado: el paciente no asistió.');
  });
}

export async function guardarLugar(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    if (!id) return fail('Cita no válida.');
    must(
      await sb
        .from('appointments')
        .update({ location_details: optStr(fd, 'lugar', 300) })
        .eq('id', id)
        .select('id')
        .single(),
    );
    return done(id, 'Guardado.');
  });
}

export async function reprogramarCita(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    const start = readStart(fd);
    if (!id) return fail('Cita no válida.');
    if (!start) return fail('Elige el nuevo día y horario.', { inicio: 'Falta el horario.' });
    const newIdv = newId();
    must(
      await sb.rpc('admin_reschedule_appointment', {
        p_appointment_id: id,
        p_new_id: newIdv,
        p_new_token_hash: manageTokenHash(newIdv),
        p_new_starts_at: start.toISOString(),
      }),
    );
    kickNotifications();
    return done(newIdv, 'Cita reprogramada.', { redirectTo: `/admin/agenda/${newIdv}` });
  });
}

export async function crearCita(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const patientId = uuid(fd, 'paciente');
    const serviceId = uuid(fd, 'servicio');
    const start = readStart(fd);
    const errors: Record<string, string> = {};
    if (!patientId) errors.paciente = 'Elige un paciente.';
    if (!serviceId) errors.servicio = 'Elige el tipo de sesión.';
    if (!start) errors.inicio = 'Elige el día y el horario.';
    if (Object.keys(errors).length) return fail('Revisa los campos marcados.', errors);
    const id = newId();
    must(
      await sb
        .from('appointments')
        .insert({
          id,
          patient_id: patientId,
          session_type_id: serviceId,
          starts_at: start!.toISOString(),
          status: 'confirmada',
          source: 'panel',
          location_details: optStr(fd, 'lugar', 300),
          manage_token_hash: manageTokenHash(id),
          // modalidad, hora de fin, margen y precio los completa la base de datos desde el servicio
        })
        .select('id')
        .single(),
    );
    kickNotifications();
    return done(id, 'Cita agendada.', { redirectTo: `/admin/agenda/${id}` });
  });
}

/** Horarios libres para el selector del panel (incluye los que la página no ofrece por anticipación mínima). */
export async function horariosLibres(serviceId: string, day: string, exclude?: string): Promise<{ slots: string[]; error?: string }> {
  const ctx = await getAdminContext();
  if (ctx.status !== 'ok') return { slots: [], error: 'Tu sesión expiró.' };
  if (!/^[0-9a-f-]{36}$/i.test(serviceId) || !isDateKey(day)) return { slots: [] };
  const { data, error } = await ctx.supabase.rpc('admin_available_slots', {
    p_session_type_id: serviceId,
    p_from: day,
    p_to: day,
    p_exclude_appointment: exclude && /^[0-9a-f-]{36}$/i.test(exclude) ? exclude : null,
  });
  if (error) return { slots: [], error: 'No se pudieron cargar los horarios.' };
  return { slots: (data as string[]).map((s) => new Date(s).toISOString()) };
}
