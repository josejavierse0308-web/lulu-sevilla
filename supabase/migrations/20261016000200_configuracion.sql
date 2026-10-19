-- ============================================================================
-- 0200 · Configuración de la práctica: ajustes, servicios, disponibilidad,
--        días no disponibles y documentos legales versionados
-- ============================================================================

-- Las plantillas de mensajes solo aceptan estas variables. Ninguna da acceso a
-- información clínica.
create or replace function private.template_ok(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p is null or (
    char_length(p) <= 1500
    and not exists (
      select 1
      from regexp_matches(p, '\{([^}]*)\}', 'g') as m(v)
      where m.v[1] not in ('nombre', 'fecha', 'hora', 'servicio', 'modalidad', 'lugar', 'enlace')
    )
  )
$$;

create table public.practice_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'America/Mexico_City',

  -- Reservas
  booking_enabled boolean not null default false,       -- cerrado hasta que Lulu configure todo
  slot_interval_min int not null default 60 check (slot_interval_min between 10 and 240),
  min_notice_hours int not null default 24 check (min_notice_hours between 0 and 720),
  max_days_ahead int not null default 45 check (max_days_ahead between 1 and 365),
  patient_change_min_hours int not null default 24 check (patient_change_min_hours between 0 and 720),
  max_pending_per_contact int not null default 2 check (max_pending_per_contact between 1 and 10),
  cancellation_policy text check (char_length(cancellation_policy) <= 2000),
  reschedule_policy text check (char_length(reschedule_policy) <= 2000),

  -- Datos públicos (si quedan vacíos, la página muestra sus marcadores)
  public_intro text check (char_length(public_intro) <= 600),
  public_education text check (char_length(public_education) <= 200),
  public_license text check (char_length(public_license) <= 60),
  public_approach text check (char_length(public_approach) <= 200),
  public_modality text check (char_length(public_modality) <= 200),
  show_prices_public boolean not null default false,

  -- Contacto
  contact_whatsapp text check (contact_whatsapp is null or contact_whatsapp ~ '^[0-9]{10,15}$'),
  contact_email text check (private.valid_email(contact_email)),
  contact_address text check (char_length(contact_address) <= 300),

  -- Notificaciones
  notify_patient_email boolean not null default true,
  reminders_enabled boolean not null default false,
  reminder_hours_before int not null default 24 check (reminder_hours_before between 1 and 168),
  admin_alert_email text check (private.valid_email(admin_alert_email)),
  admin_alert_on_request boolean not null default true,

  -- Plantillas (variables permitidas: {nombre} {fecha} {hora} {servicio} {modalidad} {lugar} {enlace})
  tpl_request_received text not null default
    'Hola {nombre}. Recibí tu solicitud para el {fecha} a las {hora} ({servicio}, {modalidad}). Te escribiré para confirmarla. Puedes revisar o cancelar tu solicitud aquí: {enlace}',
  tpl_confirmed text not null default
    'Hola {nombre}. Tu sesión del {fecha} a las {hora} ({servicio}, {modalidad}) está confirmada. {lugar} Si necesitas cambiarla: {enlace}',
  tpl_reminder text not null default
    'Hola {nombre}. Te recuerdo tu sesión del {fecha} a las {hora} ({modalidad}). {lugar} Si necesitas cambiarla: {enlace}',
  tpl_cancelled text not null default
    'Hola {nombre}. Tu sesión del {fecha} a las {hora} quedó cancelada. Si quieres agendar otra fecha: {enlace}',

  updated_at timestamptz not null default now(),

  constraint templates_valid check (
    private.template_ok(tpl_request_received) and private.template_ok(tpl_confirmed)
    and private.template_ok(tpl_reminder) and private.template_ok(tpl_cancelled)
  )
);
insert into public.practice_settings default values;

create or replace function private.check_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform now() at time zone new.timezone;
  return new;
exception when others then
  raise exception 'zona_horaria_invalida' using errcode = '22023';
end $$;

create trigger practice_settings_tz before insert or update of timezone on public.practice_settings
  for each row execute function private.check_timezone();
create trigger practice_settings_updated before update on public.practice_settings
  for each row execute function private.set_updated_at();

-- Impide borrar la fila única de ajustes.
create or replace function private.forbid_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'operacion_no_permitida' using errcode = '42501';
end $$;
create trigger practice_settings_no_delete before delete on public.practice_settings
  for each row execute function private.forbid_delete();

-- Servicios / tipos de sesión --------------------------------------------------
create table public.session_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text check (char_length(description) <= 400),
  modality public.modality not null,
  duration_min int not null check (duration_min between 15 and 240),
  buffer_min int not null default 0 check (buffer_min between 0 and 120),
  price_cents int not null check (price_cents between 0 and 10000000),
  is_public boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger session_types_updated before update on public.session_types
  for each row execute function private.set_updated_at();

-- Horario semanal de atención --------------------------------------------------
-- Varias franjas por día representan los descansos (ej. 9–13 y 15–19).
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = domingo
  start_time time not null,
  end_time time not null,
  modality public.modality,                                     -- null = cualquier modalidad
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index availability_rules_weekday on public.availability_rules (weekday) where active;

create or replace function private.check_availability_overlap()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.active and exists (
    select 1 from public.availability_rules r
    where r.id <> new.id and r.active and r.weekday = new.weekday
      and r.start_time < new.end_time and new.start_time < r.end_time
      and (r.modality is null or new.modality is null or r.modality = new.modality)
  ) then
    raise exception 'franja_encimada' using errcode = '23P01';
  end if;
  return new;
end $$;
create trigger availability_rules_overlap before insert or update on public.availability_rules
  for each row execute function private.check_availability_overlap();

-- Días u horas no disponibles (vacaciones, congresos, pendientes personales) ----
create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (char_length(reason) <= 200),               -- privado, nunca se publica
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index time_off_range on public.time_off using gist (tstzrange(starts_at, ends_at, '[)'));

-- Documentos legales versionados (aviso de privacidad, consentimiento informado)
-- Una versión publicada no se puede modificar: se publica una nueva versión.
create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind public.legal_kind not null,
  version int not null check (version > 0),
  title text not null check (char_length(btrim(title)) between 3 and 140),
  body text not null check (char_length(btrim(body)) between 50 and 60000),
  is_current boolean not null default false,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (kind, version)
);
create unique index legal_documents_one_current on public.legal_documents (kind) where is_current;

create or replace function private.legal_documents_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'documento_legal_inmutable' using errcode = '42501';
  end if;
  if new.kind is distinct from old.kind or new.version is distinct from old.version
     or new.title is distinct from old.title or new.body is distinct from old.body
     or new.published_at is distinct from old.published_at then
    raise exception 'documento_legal_inmutable' using errcode = '42501';
  end if;
  return new;  -- solo puede cambiar is_current
end $$;
create trigger legal_documents_immutable before update or delete on public.legal_documents
  for each row execute function private.legal_documents_immutable();

-- Publica una nueva versión y la vuelve vigente en una sola transacción.
create or replace function public.admin_publish_legal_document(p_kind public.legal_kind, p_title text, p_body text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_version int;
begin
  perform private.require_admin();
  select coalesce(max(version), 0) + 1 into v_version from public.legal_documents where kind = p_kind;
  update public.legal_documents set is_current = false where kind = p_kind and is_current;
  insert into public.legal_documents (kind, version, title, body, is_current)
  values (p_kind, v_version, btrim(p_title), btrim(p_body), true)
  returning id into v_id;
  return v_id;
end $$;
