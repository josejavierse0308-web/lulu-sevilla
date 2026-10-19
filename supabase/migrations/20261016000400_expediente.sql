-- ============================================================================
-- 0400 · Expediente: registros clínicos con historial de cambios,
--        consentimientos y documentos privados
-- ============================================================================

-- Registros clínicos (notas de sesión, observaciones, objetivos, evolución).
-- Los escribe y valida exclusivamente la psicóloga. No se borran: se anulan
-- con un motivo, y cada edición guarda la versión anterior.
create table public.clinical_entries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete set null,
  kind public.entry_kind not null,
  entry_date date not null default current_date,
  title text check (char_length(title) <= 140),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  goal_status public.goal_status,
  version int not null default 1,
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'objetivo') = (goal_status is not null)),
  check ((voided_at is null) = (void_reason is null))
);
create index clinical_entries_patient on public.clinical_entries (patient_id, entry_date desc, created_at desc);

create table public.clinical_entry_revisions (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.clinical_entries(id) on delete restrict,
  version int not null,
  kind public.entry_kind not null,
  entry_date date not null,
  title text,
  body text not null,
  goal_status public.goal_status,
  replaced_at timestamptz not null default now(),
  replaced_by uuid default auth.uid(),
  unique (entry_id, version)
);

-- security definer: así la cuenta de la app no necesita permiso para escribir
-- directamente en el historial; solo el disparador puede hacerlo.
create or replace function private.clinical_entries_versioning()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.patient_id is distinct from old.patient_id or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'campo_inmutable' using errcode = '42501';
  end if;
  if old.voided_at is not null then
    raise exception 'registro_anulado' using errcode = '42501';
  end if;
  if new.body is distinct from old.body or new.title is distinct from old.title
     or new.kind is distinct from old.kind or new.entry_date is distinct from old.entry_date
     or new.goal_status is distinct from old.goal_status then
    insert into public.clinical_entry_revisions (entry_id, version, kind, entry_date, title, body, goal_status)
    values (old.id, old.version, old.kind, old.entry_date, old.title, old.body, old.goal_status);
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end $$;
create trigger clinical_entries_versioning before update on public.clinical_entries
  for each row execute function private.clinical_entries_versioning();
create trigger clinical_entries_updated before update on public.clinical_entries
  for each row execute function private.set_updated_at();
create trigger clinical_entries_no_delete before delete on public.clinical_entries
  for each row execute function private.forbid_delete();

create or replace function private.revisions_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'historial_inmutable' using errcode = '42501';
end $$;
create trigger clinical_entry_revisions_immutable before update or delete on public.clinical_entry_revisions
  for each row execute function private.revisions_append_only();

-- Consentimientos ---------------------------------------------------------------
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete set null,
  legal_document_id uuid not null references public.legal_documents(id) on delete restrict,
  method public.consent_method not null,
  accepted_by_name text not null check (char_length(btrim(accepted_by_name)) between 2 and 120),
  on_behalf_of_minor boolean not null default false,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_note text check (char_length(revocation_note) <= 300),
  created_at timestamptz not null default now(),
  check (patient_id is not null or appointment_id is not null)
);
create index consents_patient on public.consents (patient_id);
create index consents_appointment on public.consents (appointment_id);

create or replace function private.consents_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Un consentimiento no se reescribe: solo se puede vincular a un paciente
  -- (cuando venía de una solicitud pública) o revocar.
  if new.legal_document_id is distinct from old.legal_document_id
     or new.accepted_at is distinct from old.accepted_at
     or new.accepted_by_name is distinct from old.accepted_by_name
     or new.method is distinct from old.method
     or (old.patient_id is not null and new.patient_id is distinct from old.patient_id)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'consentimiento_inmutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger consents_guard before update on public.consents
  for each row execute function private.consents_guard();
create trigger consents_no_delete before delete on public.consents
  for each row execute function private.forbid_delete();

-- Cuando una solicitud pública se vincula a un paciente, sus consentimientos
-- pasan también al expediente.
create or replace function private.appointments_link_consents()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.patient_id is not null and old.patient_id is null then
    update public.consents set patient_id = new.patient_id
    where appointment_id = new.id and patient_id is null;
  end if;
  return null;
end $$;
create trigger appointments_link_consents after update of patient_id on public.appointments
  for each row execute function private.appointments_link_consents();

-- Documentos del expediente (archivos en el bucket privado "expedientes") -------
create table public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  kind public.document_kind not null,
  title text not null check (char_length(btrim(title)) between 2 and 140),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes int not null check (size_bytes between 1 and 10485760),
  consent_id uuid references public.consents(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  check (storage_path ~ ('^patients/' || patient_id::text || '/[0-9a-f-]{36}\.(pdf|jpg|png)$'))
);
create index patient_documents_patient on public.patient_documents (patient_id, uploaded_at desc);
