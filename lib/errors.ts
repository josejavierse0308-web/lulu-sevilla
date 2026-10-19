// Mensajes claros para los códigos que devuelve la base de datos.

const MESSAGES: Record<string, string> = {
  // Página pública y enlace privado
  reservas_cerradas: 'Por ahora la agenda en línea no está disponible. Puedes escribir directamente para agendar.',
  servicio_no_disponible: 'Ese tipo de sesión ya no está disponible. Elige otra opción.',
  horario_no_disponible: 'Ese horario acaba de ocuparse o ya no está disponible. Elige otro, por favor.',
  consentimiento_requerido: 'Para continuar necesitas leer y aceptar el aviso de privacidad.',
  aviso_desactualizado: 'El aviso de privacidad se actualizó. Recarga la página para leer la versión vigente.',
  nombre_invalido: 'Escribe tu nombre (entre 2 y 120 caracteres).',
  contacto_requerido: 'Necesitamos un correo o un teléfono para confirmar tu cita.',
  correo_invalido: 'Revisa tu correo electrónico; parece incompleto.',
  telefono_invalido: 'Revisa tu número de teléfono (solo dígitos, espacios o guiones).',
  correo_requerido: 'Si prefieres que te contacten por correo, escribe tu correo electrónico.',
  telefono_requerido: 'Si prefieres WhatsApp o llamada, escribe tu número de teléfono.',
  limite_solicitudes: 'Ya tienes solicitudes pendientes. Espera la confirmación o cancela alguna desde su enlace.',
  demasiados_intentos: 'Hiciste muchos intentos en poco tiempo. Espera unos minutos y vuelve a intentarlo.',
  solicitud_invalida: 'La solicitud no es válida. Recarga la página e inténtalo de nuevo.',
  solicitud_duplicada: 'Esta solicitud ya se registró.',
  rango_invalido: 'El rango de fechas no es válido.',
  enlace_invalido: 'Este enlace no es válido o ya no está activo.',
  cita_no_modificable: 'Esta cita ya no se puede modificar desde aquí.',
  fuera_de_plazo: 'El plazo para cambiar o cancelar en línea ya pasó. Escribe directamente para resolverlo.',

  // Panel
  no_autorizado: 'Tu sesión no tiene permiso para esta acción.',
  confirmar_requiere_paciente: 'Para confirmar, vincula la cita a un expediente.',
  cita_no_pendiente: 'Esta cita ya no está pendiente.',
  cita_inexistente: 'La cita no existe.',
  horario_pasado: 'Elige una fecha y hora futuras.',
  usa_reprogramar: 'Para cambiar el horario usa “Reprogramar”, así se conserva el historial.',
  sesion_aun_no_ocurre: 'Solo puedes registrar como realizada una sesión que ya ocurrió.',
  paciente_no_editable: 'El expediente de esta cita ya no se puede cambiar.',
  franja_encimada: 'Esa franja se encima con otra del mismo día.',
  identificador_inmutable: 'El identificador interno no se puede cambiar.',
  fecha_nacimiento_invalida: 'La fecha de nacimiento no puede ser futura.',
  documento_legal_inmutable: 'Un documento publicado no se modifica; publica una nueva versión.',
  registro_anulado: 'Este registro está anulado y ya no se puede editar.',
  campo_inmutable: 'Ese dato no se puede cambiar.',
  pago_inmutable: 'Un pago registrado no se edita. Anúlalo y regístralo de nuevo.',
  pago_anulado: 'Este pago ya está anulado.',
  cargo_cancelado: 'Ese cargo está cancelado.',
  cargo_de_otro_paciente: 'Ese cargo pertenece a otro paciente.',
  cita_de_otro_paciente: 'Esa cita pertenece a otro paciente.',
  fecha_pago_futura: 'La fecha del pago no puede ser futura.',
  estado_inicial_invalido: 'Estado inicial no válido.',
  periodo_invalido: 'El periodo no es válido.',
  zona_horaria_invalida: 'Zona horaria no válida.',
  consentimiento_inmutable: 'Un consentimiento registrado no se modifica; solo se puede revocar.',
  operacion_no_permitida: 'Esta operación no está permitida.',
};

const CONSTRAINTS: Array<[RegExp, string]> = [
  [/appointments_no_overlap/, 'Ese horario se encima con otra cita activa.'],
  [/templates_valid/, 'Las plantillas solo pueden usar {nombre}, {fecha}, {hora}, {servicio}, {modalidad}, {lugar} y {enlace}.'],
  [/payments_(reference|notes)_check/, 'No escribas números de tarjeta ni datos bancarios en la referencia o las notas.'],
  [/patients_email_check|valid_email/, 'Revisa el correo electrónico.'],
  [/phone_check|valid_phone/, 'Revisa el número de teléfono.'],
  [/legal_documents_body_check/, 'El documento es demasiado corto.'],
  [/violates foreign key constraint/, 'No se puede eliminar porque tiene información relacionada.'],
  [/duplicate key value/, 'Ese registro ya existe.'],
  [/row-level security|permission denied/, 'Tu sesión no tiene permiso para esta acción.'],
];

export function friendlyError(raw: unknown): string {
  const msg = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && 'message' in raw ? String((raw as { message: unknown }).message) : '';
  const code = msg.split(':')[0]?.trim() ?? '';
  if (MESSAGES[code]) return MESSAGES[code];
  if (code.startsWith('transicion_invalida')) return 'Ese cambio de estado no es posible.';
  for (const [re, text] of CONSTRAINTS) if (re.test(msg)) return text;
  return 'No se pudo completar la acción. Inténtalo de nuevo; si persiste, revisa tu conexión.';
}

export function isKnownCode(code: string) {
  return code in MESSAGES;
}
