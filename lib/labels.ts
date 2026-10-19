export type Tone = 'ocre' | 'lavanda' | 'salvia' | 'rosa' | 'pizarra' | 'neutro';

export const APPOINTMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pendiente: { label: 'Por confirmar', tone: 'ocre' },
  confirmada: { label: 'Confirmada', tone: 'lavanda' },
  completada: { label: 'Realizada', tone: 'salvia' },
  cancelada: { label: 'Cancelada', tone: 'rosa' },
  no_asistio: { label: 'No asistió', tone: 'pizarra' },
  reprogramada: { label: 'Reprogramada', tone: 'neutro' },
};

export const PATIENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  activo: { label: 'Activo', tone: 'salvia' },
  en_pausa: { label: 'En pausa', tone: 'ocre' },
  alta: { label: 'Alta', tone: 'lavanda' },
  archivado: { label: 'Archivado', tone: 'neutro' },
};

export const CHARGE_STATE: Record<string, { label: string; tone: Tone }> = {
  pendiente: { label: 'Pendiente', tone: 'ocre' },
  parcial: { label: 'Pago parcial', tone: 'lavanda' },
  pagado: { label: 'Pagado', tone: 'salvia' },
  cancelado: { label: 'Cancelado', tone: 'neutro' },
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  confirmado: { label: 'Recibido', tone: 'salvia' },
  por_confirmar: { label: 'Por confirmar', tone: 'ocre' },
  anulado: { label: 'Anulado', tone: 'neutro' },
};

export const PAYMENT_METHOD: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta_terminal: 'Tarjeta (terminal)',
  deposito: 'Depósito',
  otro: 'Otro',
};

export const ENTRY_KIND: Record<string, string> = {
  nota_sesion: 'Nota de sesión',
  observacion: 'Observación profesional',
  objetivo: 'Objetivo de seguimiento',
  evolucion: 'Evolución',
};

export const GOAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  activo: { label: 'En curso', tone: 'lavanda' },
  logrado: { label: 'Logrado', tone: 'salvia' },
  pausado: { label: 'En pausa', tone: 'neutro' },
};

export const CONTACT_PREF: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telefono: 'Llamada',
  correo: 'Correo',
};

export const CONSENT_METHOD: Record<string, string> = {
  formulario_web: 'Formulario web',
  firma_fisica: 'Firma en papel',
  firma_digital: 'Firma digital',
  verbal_registrado: 'Verbal (registrado)',
};

export const LEGAL_KIND: Record<string, string> = {
  aviso_privacidad: 'Aviso de privacidad',
  consentimiento_informado: 'Consentimiento informado',
};

export const NOTIFICATION_KIND: Record<string, string> = {
  solicitud_recibida: 'Acuse de solicitud',
  solicitud_admin: 'Aviso para ti',
  cita_confirmada: 'Confirmación',
  recordatorio: 'Recordatorio',
  cita_cancelada: 'Aviso de cancelación',
};

export const NOTIFICATION_STATUS: Record<string, string> = {
  pendiente: 'Programado',
  enviando: 'Enviando',
  enviado: 'Enviado',
  omitido: 'No se envió',
  error: 'Error',
};
