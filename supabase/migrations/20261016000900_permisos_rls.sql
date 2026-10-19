-- ============================================================================
-- 0900 · Permisos y Row Level Security
-- Principio: el rol anónimo no puede leer ni escribir NINGUNA tabla. Todo lo
-- público pasa por funciones controladas. El rol "authenticated" solo ve datos
-- si además es la cuenta registrada en admin_users (la psicóloga).
-- ============================================================================

-- 1. Retirar los privilegios amplios que Supabase concede por defecto ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema private from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- 2. Activar RLS en todas las tablas --------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'admin_users', 'practice_settings', 'session_types', 'availability_rules', 'time_off', 'legal_documents',
    'patients', 'appointments', 'clinical_entries', 'clinical_entry_revisions', 'consents',
    'patient_documents', 'charges', 'payments', 'audit_log', 'notification_outbox'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))',
      t || '_solo_psicologa', t);
  end loop;
end $$;

alter table private.rate_limits enable row level security;

-- 3. Privilegios mínimos por tabla para la cuenta autenticada -------------------
grant select on public.admin_users to authenticated;
grant select, update on public.practice_settings to authenticated;
grant select, insert, update, delete on public.session_types to authenticated;
grant select, insert, update, delete on public.availability_rules to authenticated;
grant select, insert, update, delete on public.time_off to authenticated;
grant select, insert, update on public.legal_documents to authenticated;
grant select, insert, update, delete on public.patients to authenticated;
grant select, insert, update on public.appointments to authenticated;           -- las citas no se borran
grant select, insert, update on public.clinical_entries to authenticated;       -- se anulan, no se borran
grant select on public.clinical_entry_revisions to authenticated;               -- solo el disparador escribe
grant select, insert, update on public.consents to authenticated;
grant select, insert, update, delete on public.patient_documents to authenticated;
grant select, insert, update on public.charges to authenticated;
grant select, insert, update on public.payments to authenticated;
grant select on public.audit_log to authenticated;                               -- solo lectura
grant select on public.notification_outbox to authenticated;
grant usage on sequence public.patient_code_seq to authenticated;

grant select on public.charge_balances, public.patient_balances, public.patient_overview to authenticated;

-- 4. Funciones -----------------------------------------------------------------
-- Públicas (página de Lulu y enlace privado del paciente)
grant execute on function public.get_public_info() to anon, authenticated;
grant execute on function public.get_available_slots(uuid, date, date) to anon, authenticated;
grant execute on function public.request_booking(uuid, text, uuid, timestamptz, text, text, text, public.contact_pref, uuid, boolean, boolean, text) to anon, authenticated;
grant execute on function public.get_booking_by_token(text, text) to anon, authenticated;
grant execute on function public.cancel_booking_by_token(text, text) to anon, authenticated;
grant execute on function public.reschedule_booking_by_token(text, uuid, text, timestamptz, text) to anon, authenticated;

-- Panel (además validan internamente que sea la cuenta administradora)
grant execute on function public.admin_publish_legal_document(public.legal_kind, text, text) to authenticated;
grant execute on function public.admin_finance_summary(date, date) to authenticated;
grant execute on function public.admin_available_slots(uuid, date, date, uuid) to authenticated;
grant execute on function public.admin_confirm_appointment(uuid, uuid, text) to authenticated;
grant execute on function public.admin_reschedule_appointment(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.log_access(text, text, uuid) to authenticated;

-- Procesador de notificaciones (solo en el servidor, con la clave de servicio)
revoke execute on function public.claim_notifications(int) from public, anon, authenticated;
revoke execute on function public.complete_notification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;
grant execute on function public.complete_notification(uuid, text, text) to service_role;

-- Auxiliares privadas que necesitan las restricciones y políticas
grant execute on function private.is_admin() to anon, authenticated, service_role;
grant execute on function private.require_admin() to authenticated, service_role;
grant execute on function private.slot_candidates(uuid, timestamptz, timestamptz, uuid, boolean) to authenticated, service_role;
grant execute on function private.valid_email(text) to authenticated, service_role;
grant execute on function private.valid_phone(text) to authenticated, service_role;
grant execute on function private.looks_like_card(text) to authenticated, service_role;
grant execute on function private.template_ok(text) to authenticated, service_role;
grant execute on function private.current_actor_role() to authenticated, service_role;
