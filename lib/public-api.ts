import 'server-only';
import { createPublicClient } from '@/lib/supabase/server';
import { clientKey, manageTokenHash, newId } from '@/lib/tokens';
import { clientIp } from '@/lib/http';

export type PublicInfo = {
  booking_open: boolean;
  timezone: string;
  min_notice_hours: number;
  max_days_ahead: number;
  patient_change_min_hours: number;
  cancellation_policy: string | null;
  reschedule_policy: string | null;
  profile: { intro: string | null; education: string | null; license: string | null; approach: string | null; modality: string | null };
  contact: { whatsapp: string | null; email: string | null; address: string | null };
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    modality: 'en_linea' | 'presencial';
    duration_min: number;
    price_cents: number | null;
  }>;
  privacy: { id: string; version: number; title: string; body: string; published_at: string } | null;
};

export type BookingView = {
  appointment_id: string;
  first_name: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
  service: string;
  session_type_id: string;
  service_bookable: boolean;
  modality: 'en_linea' | 'presencial';
  location_details: string | null;
  rescheduled_to: string | null;
  can_change: boolean;
  change_deadline: string;
  patient_change_min_hours: number;
  cancellation_policy: string | null;
  reschedule_policy: string | null;
  timezone: string;
  contact_whatsapp: string | null;
};

type RpcResult<T> = { data: T; error: null } | { data: null; error: string };

function errCode(e: { message?: string } | null): string {
  return (e?.message ?? 'error').split(':')[0]!.trim();
}

export async function getPublicInfo(): Promise<PublicInfo | null> {
  const { data, error } = await createPublicClient().rpc('get_public_info');
  if (error) return null;
  return data as PublicInfo;
}

export async function getSlots(serviceId: string, from: string, to: string): Promise<RpcResult<string[]>> {
  const { data, error } = await createPublicClient().rpc('get_available_slots', {
    p_session_type_id: serviceId,
    p_from: from,
    p_to: to,
  });
  if (error) return { data: null, error: errCode(error) };
  return { data: (data as string[]).map((s) => new Date(s).toISOString()), error: null };
}

export type BookingInput = {
  serviceId: string;
  startsAt: string;
  name: string;
  email: string | null;
  phone: string | null;
  contactPref: 'whatsapp' | 'telefono' | 'correo';
  privacyId: string;
  acceptsPrivacy: boolean;
  forMinor: boolean;
};

export async function requestBooking(input: BookingInput, headers: Headers) {
  const id = newId();
  const { data, error } = await createPublicClient().rpc('request_booking', {
    p_id: id,
    p_token_hash: manageTokenHash(id),
    p_session_type_id: input.serviceId,
    p_starts_at: input.startsAt,
    p_name: input.name,
    p_email: input.email,
    p_phone: input.phone,
    p_contact_pref: input.contactPref,
    p_privacy_document_id: input.privacyId,
    p_accepts_privacy: input.acceptsPrivacy,
    p_for_minor: input.forMinor,
    p_client_key: clientKey(clientIp(headers)),
  });
  if (error) return { error: errCode(error) } as const;
  const r = data as { error?: string; appointment_id?: string; starts_at?: string; ends_at?: string; status?: string };
  if (r.error) return { error: r.error } as const;
  return { id: r.appointment_id!, startsAt: r.starts_at!, endsAt: r.ends_at!, status: r.status! } as const;
}

export async function bookingByToken(tokenHash: string, headers: Headers) {
  const { data, error } = await createPublicClient().rpc('get_booking_by_token', {
    p_token_hash: tokenHash,
    p_client_key: clientKey(clientIp(headers)),
  });
  if (error) return { error: errCode(error) } as const;
  const r = data as BookingView & { error?: string };
  if (r.error) return { error: r.error } as const;
  return { booking: r } as const;
}

export async function cancelByToken(tokenHash: string, headers: Headers) {
  const { data, error } = await createPublicClient().rpc('cancel_booking_by_token', {
    p_token_hash: tokenHash,
    p_client_key: clientKey(clientIp(headers)),
  });
  if (error) return { error: errCode(error) } as const;
  const r = data as { error?: string };
  return r.error ? ({ error: r.error } as const) : ({ ok: true } as const);
}

export async function rescheduleByToken(tokenHash: string, newStartsAt: string, headers: Headers) {
  const id = newId();
  const { data, error } = await createPublicClient().rpc('reschedule_booking_by_token', {
    p_token_hash: tokenHash,
    p_new_id: id,
    p_new_token_hash: manageTokenHash(id),
    p_new_starts_at: newStartsAt,
    p_client_key: clientKey(clientIp(headers)),
  });
  if (error) return { error: errCode(error) } as const;
  const r = data as { error?: string; appointment_id?: string };
  return r.error ? ({ error: r.error } as const) : ({ id: r.appointment_id! } as const);
}
