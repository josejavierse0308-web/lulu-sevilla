// Tipos y utilidades del panel que también pueden usar los componentes.

export type ApptRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  modality: 'en_linea' | 'presencial';
  source: 'publica' | 'panel';
  requester_name: string | null;
  patient: { id: string; full_name: string; internal_code: string } | null;
  service: { name: string } | null;
};

export const APPT_SELECT =
  'id,starts_at,ends_at,status,modality,source,requester_name,patient:patients(id,full_name,internal_code),service:session_types(name)';

export function apptName(a: Pick<ApptRow, 'patient' | 'requester_name'>) {
  return a.patient?.full_name ?? a.requester_name ?? 'Sin nombre';
}

export type Patient = {
  id: string;
  internal_code: string;
  full_name: string;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  preferred_contact: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  status: string;
  session_price_cents: number | null;
  created_at: string;
  updated_at: string;
  last_session_at: string | null;
  next_appointment_at: string | null;
  balance_cents: number;
};
