import { describe, expect, it } from 'vitest';
import { renderTemplate, templateIsValid } from '@/lib/templates';
import { addDays, dateKey, parseMoneyToCents, startOfWeek, zonedToDate, fmtTime } from '@/lib/format';
import { clientKey, isWellFormedToken, manageToken, manageTokenHash, sha256Hex } from '@/lib/tokens';
import { composeMessage } from '@/lib/notifications';
import { friendlyError } from '@/lib/errors';
import { passwordProblems } from '@/lib/passwords';

describe('plantillas', () => {
  it('solo aceptan variables de la cita', () => {
    expect(templateIsValid('Hola {nombre}, {fecha} a las {hora}. {enlace}')).toBe(true);
    expect(templateIsValid('Tu diagnóstico: {diagnostico}')).toBe(false);
    expect(templateIsValid('{notas}')).toBe(false);
  });
  it('rellenan variables y limpian espacios', () => {
    expect(renderTemplate('Hola {nombre}. {lugar} Fin', { nombre: 'Ana', lugar: '' })).toBe('Hola Ana. Fin');
  });
});

describe('fechas en Ciudad de México', () => {
  it('convierte hora local a instante', () => {
    expect(zonedToDate('2026-10-19', '09:00').toISOString()).toBe('2026-10-19T15:00:00.000Z');
  });
  it('día local de una fecha nocturna', () => {
    expect(dateKey('2026-10-20T03:30:00Z')).toBe('2026-10-19');
    expect(fmtTime('2026-10-20T03:30:00Z')).toBe('21:30');
  });
  it('lunes de la semana y suma de días', () => {
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('montos a centavos', () => {
    expect(parseMoneyToCents('1,250.50')).toBe(125050);
    expect(parseMoneyToCents('800')).toBe(80000);
    expect(parseMoneyToCents('8.999')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
  });
});

describe('enlace privado', () => {
  it('es determinista por cita, distinto entre citas y solo se guarda su hash', () => {
    const a = manageToken('11111111-1111-1111-1111-111111111111');
    expect(a).toBe(manageToken('11111111-1111-1111-1111-111111111111'));
    expect(a).not.toBe(manageToken('22222222-2222-2222-2222-222222222222'));
    expect(isWellFormedToken(a)).toBe(true);
    expect(manageTokenHash('11111111-1111-1111-1111-111111111111')).toBe(sha256Hex(a));
    expect(manageTokenHash('11111111-1111-1111-1111-111111111111')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('el origen se anonimiza', () => {
    const k = clientKey('203.0.113.7');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).not.toContain('203');
  });
});

describe('mensajes automáticos', () => {
  const base = {
    id: 'x',
    appointment_id: '11111111-1111-1111-1111-111111111111',
    recipient: 'p@ejemplo.test',
    person_name: 'Ana',
    starts_at: '2026-10-19T15:00:00Z',
    ends_at: '2026-10-19T15:50:00Z',
    service_name: 'Sesión individual',
    modality: 'en_linea' as const,
    location_details: 'https://sala.ejemplo.test',
    timezone: 'America/Mexico_City',
    template: 'Hola {nombre}. {fecha} {hora} ({servicio}, {modalidad}). {lugar} {enlace}',
  };
  it('confirmación con datos de la cita y enlace de gestión', () => {
    const m = composeMessage({ ...base, kind: 'cita_confirmada' });
    expect(m.text).toContain('Hola Ana');
    expect(m.text).toContain('09:00');
    expect(m.text).toContain('lunes, 19 de octubre');
    expect(m.text).toContain('https://lulu.ejemplo.test/cita/');
  });
  it('el aviso para Lulu no incluye datos del paciente', () => {
    const m = composeMessage({ ...base, kind: 'solicitud_admin', person_name: null });
    expect(m.text).not.toContain('Ana');
    expect(m.link).toBe('https://lulu.ejemplo.test/admin/agenda/11111111-1111-1111-1111-111111111111');
  });
});

describe('mensajes de error y contraseñas', () => {
  it('traduce códigos de la base de datos', () => {
    expect(friendlyError({ message: 'horario_no_disponible' })).toMatch(/horario/);
    expect(friendlyError({ message: 'conflicting key value violates exclusion constraint "appointments_no_overlap"' })).toMatch(/encima/);
    expect(friendlyError({ message: 'algo raro' })).toMatch(/No se pudo completar/);
  });
  it('exige contraseñas robustas', () => {
    expect(passwordProblems('corta')).not.toBeNull();
    expect(passwordProblems('solominusculaslarga')).not.toBeNull();
    expect(passwordProblems('Una-Clave-Larga-2026')).toBeNull();
  });
});
