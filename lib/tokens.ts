import 'server-only';
import crypto from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Enlace privado de gestión de cita.
 * token = HMAC-SHA256(secreto, "cita:" + id). En la base de datos solo se
 * guarda sha256(token), de modo que una copia de la base no permite gestionar
 * citas, y el servidor puede volver a generar el enlace para los correos.
 */
export function manageToken(appointmentId: string): string {
  return crypto.createHmac('sha256', env.manageLinkSecret).update(`cita:${appointmentId}`).digest('base64url');
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function manageTokenHash(appointmentId: string): string {
  return sha256Hex(manageToken(appointmentId));
}

export function manageUrl(appointmentId: string): string {
  return `${env.siteUrl}/cita/${manageToken(appointmentId)}`;
}

/** Formato válido de un token recibido por URL (43 caracteres base64url). */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/**
 * Identificador anónimo del origen de una petición, para el límite de
 * intentos. No se guarda la IP: solo un HMAC que no se puede revertir.
 */
export function clientKey(ip: string): string {
  return crypto.createHmac('sha256', env.clientKeySecret).update(`ip:${ip}`).digest('hex');
}

export function newId(): string {
  return crypto.randomUUID();
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
