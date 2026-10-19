'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminAction, must, optStr, str, uuid } from '@/lib/admin';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { isDateKey, parseMoneyToCents, todayKey } from '@/lib/format';
import { newId } from '@/lib/tokens';
import { getAdminContext } from '@/lib/auth';

const PHONE = /^\+?[0-9][0-9 ()-]{6,19}$/;

function patientFields(fd: FormData) {
  const errors: Record<string, string> = {};
  const full_name = str(fd, 'nombre', 120).replace(/\s+/g, ' ');
  if (full_name.length < 2) errors.nombre = 'Escribe el nombre completo.';
  const email = optStr(fd, 'correo', 254)?.toLowerCase() ?? null;
  if (email && !z.email().safeParse(email).success) errors.correo = 'Revisa el correo.';
  const phone = optStr(fd, 'telefono', 20);
  if (phone && !PHONE.test(phone)) errors.telefono = 'Revisa el teléfono.';
  const birth = optStr(fd, 'nacimiento', 10);
  if (birth && (!isDateKey(birth) || birth > todayKey() || birth < '1900-01-01')) errors.nacimiento = 'Revisa la fecha.';
  const ePhone = optStr(fd, 'emergencia_telefono', 20);
  if (ePhone && !PHONE.test(ePhone)) errors.emergencia_telefono = 'Revisa el teléfono.';
  const pref = str(fd, 'preferencia', 10);
  const priceRaw = str(fd, 'precio', 12);
  const price = priceRaw ? parseMoneyToCents(priceRaw) : null;
  if (priceRaw && price === null) errors.precio = 'Escribe un monto válido, por ejemplo 800 o 750.50.';
  return {
    errors,
    row: {
      full_name,
      email,
      phone,
      birth_date: birth,
      preferred_contact: ['whatsapp', 'telefono', 'correo'].includes(pref) ? pref : null,
      emergency_contact_name: optStr(fd, 'emergencia_nombre', 120),
      emergency_contact_phone: ePhone,
      emergency_contact_relation: optStr(fd, 'emergencia_relacion', 60),
      session_price_cents: price,
    },
  };
}

export async function crearPaciente(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const { errors, row } = patientFields(fd);
    if (Object.keys(errors).length) return fail('Revisa los campos marcados.', errors);
    const created = must(await sb.from('patients').insert(row).select('id').single());
    revalidatePath('/admin', 'layout');
    return ok('Expediente creado.', { redirectTo: `/admin/pacientes/${created!.id}` });
  });
}

export async function actualizarPaciente(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    if (!id) return fail('Expediente no válido.');
    const { errors, row } = patientFields(fd);
    const status = str(fd, 'estado', 12);
    if (!['activo', 'en_pausa', 'alta', 'archivado'].includes(status)) errors.estado = 'Elige un estado.';
    if (Object.keys(errors).length) return fail('Revisa los campos marcados.', errors);
    must(
      await sb
        .from('patients')
        .update({ ...row, status })
        .eq('id', id)
        .select('id')
        .single(),
    );
    revalidatePath('/admin', 'layout');
    return ok('Datos guardados.', { redirectTo: `/admin/pacientes/${id}` });
  });
}

// Registros clínicos ------------------------------------------------------------
const KINDS = ['nota_sesion', 'observacion', 'objetivo', 'evolucion'] as const;

function entryFields(fd: FormData) {
  const errors: Record<string, string> = {};
  const kind = str(fd, 'tipo', 20);
  if (!(KINDS as readonly string[]).includes(kind)) errors.tipo = 'Elige el tipo de registro.';
  const body = String(fd.get('contenido') ?? '')
    .trim()
    .slice(0, 20000);
  if (!body) errors.contenido = 'Escribe el contenido del registro.';
  const date = str(fd, 'fecha', 10);
  if (!isDateKey(date) || date > todayKey()) errors.fecha = 'Revisa la fecha (no puede ser futura).';
  const goal = str(fd, 'estado_objetivo', 10);
  const goal_status = kind === 'objetivo' ? (['activo', 'logrado', 'pausado'].includes(goal) ? goal : 'activo') : null;
  return { errors, row: { kind, body, entry_date: date, title: optStr(fd, 'titulo', 140), goal_status } };
}

export async function crearRegistro(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const patientId = uuid(fd, 'paciente');
    if (!patientId) return fail('Expediente no válido.');
    const { errors, row } = entryFields(fd);
    if (Object.keys(errors).length) return fail('Revisa los campos marcados.', errors);
    const appointment = uuid(fd, 'cita');
    if (appointment) {
      const a = must(await sb.from('appointments').select('patient_id').eq('id', appointment).maybeSingle());
      if (!a || a.patient_id !== patientId) return fail('La sesión elegida no pertenece a este expediente.');
    }
    must(
      await sb
        .from('clinical_entries')
        .insert({ ...row, patient_id: patientId, appointment_id: appointment })
        .select('id')
        .single(),
    );
    revalidatePath(`/admin/pacientes/${patientId}`);
    return ok('Registro guardado.', { redirectTo: `/admin/pacientes/${patientId}?seccion=registros` });
  });
}

export async function editarRegistro(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    const patientId = uuid(fd, 'paciente');
    if (!id || !patientId) return fail('Registro no válido.');
    const { errors, row } = entryFields(fd);
    if (Object.keys(errors).length) return fail('Revisa los campos marcados.', errors);
    must(await sb.from('clinical_entries').update(row).eq('id', id).eq('patient_id', patientId).select('id').single());
    revalidatePath(`/admin/pacientes/${patientId}`);
    return ok('Cambios guardados. La versión anterior quedó en el historial.');
  });
}

export async function anularRegistro(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    const patientId = uuid(fd, 'paciente');
    const reason = str(fd, 'motivo', 300);
    if (!id || !patientId) return fail('Registro no válido.');
    if (reason.length < 3) return fail('Indica brevemente por qué se anula.', { motivo: 'Escribe el motivo.' });
    must(
      await sb
        .from('clinical_entries')
        .update({ voided_at: new Date().toISOString(), void_reason: reason })
        .eq('id', id)
        .eq('patient_id', patientId)
        .select('id')
        .single(),
    );
    revalidatePath(`/admin/pacientes/${patientId}`);
    return ok('Registro anulado. Se conserva en el expediente como anulado.', { redirectTo: `/admin/pacientes/${patientId}?seccion=registros` });
  });
}

// Consentimientos --------------------------------------------------------------
export async function registrarConsentimiento(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const patientId = uuid(fd, 'paciente');
    const docId = uuid(fd, 'documento');
    const method = str(fd, 'metodo', 20);
    const name = str(fd, 'quien', 120);
    const errors: Record<string, string> = {};
    if (!docId) errors.documento = 'Elige el documento.';
    if (!['firma_fisica', 'firma_digital', 'verbal_registrado'].includes(method)) errors.metodo = 'Elige cómo se otorgó.';
    if (name.length < 2) errors.quien = 'Escribe quién lo otorgó.';
    if (!patientId) return fail('Expediente no válido.');
    if (Object.keys(errors).length) return fail('Revisa los campos marcados.', errors);
    must(
      await sb
        .from('consents')
        .insert({ patient_id: patientId, legal_document_id: docId, method, accepted_by_name: name, on_behalf_of_minor: fd.get('menor') === 'on' })
        .select('id')
        .single(),
    );
    revalidatePath(`/admin/pacientes/${patientId}`);
    return ok('Consentimiento registrado.', { resetForm: true });
  });
}

export async function revocarConsentimiento(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    const patientId = uuid(fd, 'paciente');
    if (!id || !patientId) return fail('Consentimiento no válido.');
    must(
      await sb
        .from('consents')
        .update({ revoked_at: new Date().toISOString(), revocation_note: optStr(fd, 'nota', 300) })
        .eq('id', id)
        .eq('patient_id', patientId)
        .select('id')
        .single(),
    );
    revalidatePath(`/admin/pacientes/${patientId}`);
    return ok('Revocación registrada.');
  });
}

// Documentos -------------------------------------------------------------------
const MIME_EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const BUCKET = 'expedientes';

/** Paso 1: crea una URL firmada de un solo uso para subir el archivo directo al almacenamiento privado. */
export async function prepararSubida(patientId: string, mime: string, size: number) {
  const ext = MIME_EXT[mime];
  if (!/^[0-9a-f-]{36}$/i.test(patientId)) return { error: 'Expediente no válido.' };
  if (!ext) return { error: 'Solo se aceptan PDF, JPG o PNG.' };
  if (!(size > 0 && size <= 10 * 1024 * 1024)) return { error: 'El archivo debe pesar como máximo 10 MB.' };
  const ctx = await getAdminContext();
  if (ctx.status !== 'ok') return { error: 'Tu sesión expiró.' };
  const path = `patients/${patientId}/${newId()}.${ext}`;
  const { data, error } = await ctx.supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: 'No se pudo preparar la subida. Inténtalo de nuevo.' };
  return { path: data.path, token: data.token };
}

/** Paso 2: comprueba que el archivo existe y lo registra en el expediente. */
export async function registrarDocumento(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const patientId = uuid(fd, 'paciente');
    const path = str(fd, 'ruta', 200);
    const title = str(fd, 'titulo', 140);
    const kind = str(fd, 'tipo', 30);
    const mime = str(fd, 'mime', 40);
    if (!patientId || !path.startsWith(`patients/${patientId}/`)) return fail('Archivo no válido.');
    if (title.length < 2) return fail('Escribe un nombre para el documento.', { titulo: 'Falta el nombre.' });
    if (!['consentimiento_firmado', 'documento'].includes(kind)) return fail('Elige el tipo de documento.');
    const name = path.split('/').pop()!;
    const { data: listed, error } = await sb.storage.from(BUCKET).list(`patients/${patientId}`, { search: name, limit: 1 });
    const obj = listed?.find((o) => o.name === name);
    if (error || !obj) return fail('No encontramos el archivo subido. Vuelve a intentarlo.');
    const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0);
    must(
      await sb
        .from('patient_documents')
        .insert({ patient_id: patientId, kind, title, storage_path: path, mime_type: mime, size_bytes: size > 0 ? size : 1 })
        .select('id')
        .single(),
    );
    revalidatePath(`/admin/pacientes/${patientId}`);
    return ok('Documento guardado en el expediente.', { resetForm: true });
  });
}

export async function eliminarDocumento(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    const patientId = uuid(fd, 'paciente');
    if (!id || !patientId) return fail('Documento no válido.');
    const doc = must(await sb.from('patient_documents').select('storage_path').eq('id', id).eq('patient_id', patientId).maybeSingle());
    if (!doc) return fail('El documento ya no existe.');
    const { error } = await sb.storage.from(BUCKET).remove([doc.storage_path]);
    if (error) return fail('No se pudo eliminar el archivo. Inténtalo de nuevo.');
    must(await sb.from('patient_documents').delete().eq('id', id).select('id').single());
    revalidatePath(`/admin/pacientes/${patientId}`);
    return ok('Documento eliminado.');
  });
}
