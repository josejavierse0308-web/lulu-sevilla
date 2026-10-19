'use server';

import { revalidatePath } from 'next/cache';
import { adminAction, must, optStr, str, uuid } from '@/lib/admin';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { isDateKey, parseMoneyToCents, todayKey } from '@/lib/format';

const METHODS = ['efectivo', 'transferencia', 'tarjeta_terminal', 'deposito', 'otro'];

// Mismo criterio que la base de datos: 13–19 dígitos que pasan Luhn = tarjeta.
function looksLikeCard(s: string | null) {
  if (!s) return false;
  for (const m of s.matchAll(/\d[\d -]{11,}\d/g)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length < 13 || d.length > 19) continue;
    let sum = 0;
    let dbl = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = Number(d[i]);
      if (dbl) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      dbl = !dbl;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

function refresh(patientId: string) {
  revalidatePath(`/admin/pacientes/${patientId}`);
  revalidatePath('/admin/pagos');
  revalidatePath('/admin');
}

export async function registrarPago(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const patientId = uuid(fd, 'paciente');
    if (!patientId) return fail('Expediente no válido.');
    const errors: Record<string, string> = {};
    const amount = parseMoneyToCents(str(fd, 'monto', 14));
    if (!amount || amount <= 0) errors.monto = 'Escribe el monto recibido, por ejemplo 800.';
    const date = str(fd, 'fecha', 10);
    if (!isDateKey(date) || date > todayKey()) errors.fecha = 'La fecha no puede ser futura.';
    const method = str(fd, 'metodo', 20);
    if (!METHODS.includes(method)) errors.metodo = 'Elige el método.';
    const reference = optStr(fd, 'referencia', 80);
    const notes = optStr(fd, 'notas', 300);
    if (looksLikeCard(reference)) errors.referencia = 'No escribas números de tarjeta. Usa el folio o los últimos 4 dígitos.';
    if (looksLikeCard(notes)) errors.notas = 'No escribas números de tarjeta.';
    const chargeRaw = str(fd, 'cargo', 40);
    const chargeId = chargeRaw ? uuid(fd, 'cargo') : null;
    if (chargeRaw && !chargeId) errors.cargo = 'Cargo no válido.';
    const status = str(fd, 'estado', 20) === 'por_confirmar' ? 'por_confirmar' : 'confirmado';
    if (Object.keys(errors).length) return fail('Revisa los campos marcados.', errors);
    must(
      await sb
        .from('payments')
        .insert({ patient_id: patientId, charge_id: chargeId, amount_cents: amount, paid_on: date, method, reference, notes, status })
        .select('id')
        .single(),
    );
    refresh(patientId);
    return ok(status === 'confirmado' ? 'Pago registrado.' : 'Pago registrado como “por confirmar”. No cuenta como ingreso hasta que lo confirmes.', {
      resetForm: true,
    });
  });
}

export async function confirmarPago(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    const patientId = uuid(fd, 'paciente');
    if (!id || !patientId) return fail('Pago no válido.');
    must(
      await sb.from('payments').update({ status: 'confirmado' }).eq('id', id).eq('patient_id', patientId).eq('status', 'por_confirmar').select('id').single(),
    );
    refresh(patientId);
    return ok('Pago confirmado. Ya cuenta como ingreso.');
  });
}

export async function anularPago(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    const patientId = uuid(fd, 'paciente');
    const reason = str(fd, 'motivo', 300);
    if (!id || !patientId) return fail('Pago no válido.');
    if (reason.length < 3) return fail('Indica el motivo de la anulación.', { motivo: 'Escribe el motivo.' });
    must(await sb.from('payments').update({ status: 'anulado', void_reason: reason }).eq('id', id).eq('patient_id', patientId).select('id').single());
    refresh(patientId);
    return ok('Pago anulado. El saldo se recalculó.');
  });
}

export async function crearCargo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const patientId = uuid(fd, 'paciente');
    if (!patientId) return fail('Expediente no válido.');
    const errors: Record<string, string> = {};
    const description = str(fd, 'concepto', 140);
    if (description.length < 2) errors.concepto = 'Escribe el concepto.';
    const amount = parseMoneyToCents(str(fd, 'monto', 14));
    if (!amount || amount <= 0) errors.monto = 'Escribe un monto válido.';
    const date = str(fd, 'fecha', 10);
    if (!isDateKey(date)) errors.fecha = 'Revisa la fecha.';
    if (Object.keys(errors).length) return fail('Revisa los campos marcados.', errors);
    must(await sb.from('charges').insert({ patient_id: patientId, description, amount_cents: amount, charged_on: date }).select('id').single());
    refresh(patientId);
    return ok('Cargo registrado.', { resetForm: true });
  });
}

export async function cancelarCargo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return adminAction(async (sb) => {
    const id = uuid(fd, 'id');
    const patientId = uuid(fd, 'paciente');
    const reason = str(fd, 'motivo', 300);
    if (!id || !patientId) return fail('Cargo no válido.');
    if (reason.length < 3) return fail('Indica el motivo.', { motivo: 'Escribe el motivo.' });
    must(await sb.from('charges').update({ status: 'cancelado', cancel_reason: reason }).eq('id', id).eq('patient_id', patientId).select('id').single());
    refresh(patientId);
    return ok('Cargo cancelado. Si tenía pagos, quedan como saldo a favor.');
  });
}
