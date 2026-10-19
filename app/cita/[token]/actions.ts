'use server';

import { headers } from 'next/headers';
import { after } from 'next/server';
import { z } from 'zod';
import { cancelByToken, rescheduleByToken } from '@/lib/public-api';
import { isWellFormedToken, manageToken, sha256Hex } from '@/lib/tokens';
import { friendlyError } from '@/lib/errors';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { processOutbox } from '@/lib/notifications';

function tokenFrom(fd: FormData) {
  const t = String(fd.get('token') ?? '');
  return isWellFormedToken(t) ? t : null;
}

function kick() {
  after(async () => {
    try {
      await processOutbox(10);
    } catch {
      /* la función programada lo reintentará */
    }
  });
}

export async function cancelarCita(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const token = tokenFrom(fd);
  if (!token) return fail(friendlyError('enlace_invalido'));
  const r = await cancelByToken(sha256Hex(token), await headers());
  if ('error' in r) return fail(friendlyError(r.error ?? 'error'));
  kick();
  return ok('Tu cita quedó cancelada. Gracias por avisar con tiempo.');
}

export async function reprogramarCita(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const token = tokenFrom(fd);
  if (!token) return fail(friendlyError('enlace_invalido'));
  const start = z.iso.datetime({ offset: true }).safeParse(String(fd.get('inicio') ?? ''));
  if (!start.success) return fail('Elige un nuevo horario.');
  const r = await rescheduleByToken(sha256Hex(token), start.data, await headers());
  if ('error' in r) return fail(friendlyError(r.error ?? 'error'));
  kick();
  return ok('Listo. Tu nueva solicitud quedó registrada y está pendiente de confirmación.', { redirectTo: `/cita/${manageToken(r.id)}` });
}
