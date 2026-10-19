-- ============================================================================
-- Lulu Sevilla · todas las migraciones en orden (para el SQL Editor de Supabase).
-- Ejecutar UNA sola vez en un proyecto nuevo. Generado desde supabase/migrations.
-- ============================================================================

-- >>> 20261016000100_base.sql
-- ============================================================================
-- 0100 · Base: esquemas, tipos, utilidades y cuenta administradora única
-- ============================================================================

-- Esquema privado: no se expone por la API de Supabase (PostgREST solo publica
-- "public"). Aquí viven las funciones auxiliares de seguridad.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- Tipos -----------------------------------------------------------------------
create type public.modality as enum ('en_linea', 'presencial');
create type public.contact_pref as enum ('whatsapp', 'telefono', 'correo');
create type public.patient_status as enum ('activo', 'en_pausa', 'alta', 'archivado');
create type public.appointment_status as enum (
  'pendiente',      -- solicitud recibida, falta que Lulu la confirme
  'confirmada',
  'completada',     -- la sesión se realizó
  'cancelada',
  'no_asistio',
  'reprogramada'    -- fue sustituida por otra cita (ver rescheduled_to)
);
create type public.appointment_source as enum ('publica', 'panel');
create type public.entry_kind as enum ('nota_sesion', 'observacion', 'objetivo', 'evolucion');
create type public.goal_status as enum ('activo', 'logrado', 'pausado');
create type public.legal_kind as enum ('aviso_privacidad', 'consentimiento_informado');
create type public.consent_method as enum ('formulario_web', 'firma_fisica', 'firma_digital', 'verbal_registrado');
create type public.document_kind as enum ('consentimiento_firmado', 'documento');
create type public.charge_status as enum ('activo', 'cancelado');
create type public.payment_status as enum ('confirmado', 'por_confirmar', 'anulado');
create type public.payment_method as enum ('efectivo', 'transferencia', 'tarjeta_terminal', 'deposito', 'otro');

-- Utilidades ------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Detecta números de tarjeta (13–19 dígitos que pasan el algoritmo de Luhn)
-- para impedir que se guarden en referencias o notas de pago.
create or replace function private.looks_like_card(p text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  run text;
  digits text;
  s int;
  d int;
  i int;
  dbl boolean;
begin
  if p is null then return false; end if;
  for run in select (regexp_matches(p, '[0-9][0-9 -]{11,}[0-9]', 'g'))[1] loop
    digits := regexp_replace(run, '[^0-9]', '', 'g');
    if length(digits) between 13 and 19 then
      s := 0; dbl := false;
      for i in reverse length(digits)..1 loop
        d := substr(digits, i, 1)::int;
        if dbl then d := d * 2; if d > 9 then d := d - 9; end if; end if;
        s := s + d; dbl := not dbl;
      end loop;
      if s % 10 = 0 then return true; end if;
    end if;
  end loop;
  return false;
end $$;

create or replace function private.valid_email(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p is null or (char_length(p) <= 254 and p ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$')
$$;

create or replace function private.valid_phone(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p is null or p ~ '^\+?[0-9][0-9 ()-]{6,19}$'
$$;

-- Cuenta administradora -------------------------------------------------------
-- Solo puede existir UNA fila: la cuenta de la psicóloga. El índice único sobre
-- una expresión constante impide registrar una segunda cuenta.
create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index admin_users_single_account on public.admin_users ((true));

-- Es la cuenta administradora Y, si activó la verificación en dos pasos, la
-- sesión actual ya la superó (aal2). Así una contraseña robada no basta para
-- leer datos ni siquiera llamando a la API directamente.
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users where user_id = (select auth.uid())
  ) and (
    coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    )
  )
$$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated, service_role;

create or replace function private.require_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_admin() from public;
grant execute on function private.require_admin() to authenticated, service_role;

-- >>> 20261016000200_configuracion.sql
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

-- >>> 20261016000300_pacientes_citas.sql
-- ============================================================================
-- 0300 · Pacientes y citas
-- ============================================================================

create sequence public.patient_code_seq;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  internal_code text not null unique
    default ('LS-' || lpad(nextval('public.patient_code_seq')::text, 4, '0')),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  birth_date date check (birth_date >= date '1900-01-01'),
  email text check (private.valid_email(email)),
  phone text check (private.valid_phone(phone)),
  preferred_contact public.contact_pref,
  emergency_contact_name text check (char_length(emergency_contact_name) <= 120),
  emergency_contact_phone text check (private.valid_phone(emergency_contact_phone)),
  emergency_contact_relation text check (char_length(emergency_contact_relation) <= 60),
  status public.patient_status not null default 'activo',
  session_price_cents int check (session_price_cents between 0 and 10000000),  -- precio propio, opcional
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index patients_name on public.patients (lower(full_name));
create index patients_status on public.patients (status);

create or replace function private.patients_normalize()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.full_name := btrim(regexp_replace(new.full_name, '\s+', ' ', 'g'));
  new.email := nullif(lower(btrim(new.email)), '');
  new.phone := nullif(btrim(new.phone), '');
  if new.birth_date is not null and new.birth_date > current_date then
    raise exception 'fecha_nacimiento_invalida' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.internal_code is distinct from old.internal_code then
    raise exception 'identificador_inmutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger patients_normalize before insert or update on public.patients
  for each row execute function private.patients_normalize();
create trigger patients_updated before update on public.patients
  for each row execute function private.set_updated_at();

-- Citas ------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete restrict,
  session_type_id uuid not null references public.session_types(id) on delete restrict,
  modality public.modality not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_until timestamptz not null,           -- fin + margen entre sesiones
  status public.appointment_status not null default 'pendiente',
  source public.appointment_source not null,
  price_cents int check (price_cents between 0 and 10000000),

  -- Datos mínimos de quien solicita desde la página pública
  requester_name text check (char_length(btrim(requester_name)) between 2 and 120),
  requester_email text check (private.valid_email(requester_email)),
  requester_phone text check (private.valid_phone(requester_phone)),
  requester_contact_pref public.contact_pref,

  -- Enlace privado de gestión: solo se guarda el hash SHA-256 del token
  manage_token_hash text unique check (manage_token_hash ~ '^[0-9a-f]{64}$'),

  location_details text check (char_length(location_details) <= 300),   -- enlace de videollamada o dirección
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('paciente', 'psicologa')),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  rescheduled_from uuid references public.appointments(id) on delete set null,
  rescheduled_to uuid references public.appointments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (ends_at > starts_at),
  check (blocked_until >= ends_at),
  check (source <> 'publica' or (requester_name is not null and (requester_email is not null or requester_phone is not null))),
  check (patient_id is not null or source = 'publica'),

  -- Candado definitivo contra reservas duplicadas o encimadas: dos citas
  -- activas nunca pueden ocupar el mismo intervalo, aunque lleguen a la vez.
  constraint appointments_no_overlap exclude using gist (
    tstzrange(starts_at, blocked_until, '[)') with &&
  ) where (status in ('pendiente', 'confirmada'))
);
create index appointments_starts on public.appointments (starts_at);
create index appointments_patient on public.appointments (patient_id, starts_at desc);
create index appointments_status on public.appointments (status, starts_at);

create or replace function private.appointments_before_insert()
returns trigger language plpgsql set search_path = '' as $$
declare
  st public.session_types;
begin
  select * into st from public.session_types where id = new.session_type_id;
  if not found then
    raise exception 'servicio_inexistente' using errcode = '23503';
  end if;
  new.modality := coalesce(new.modality, st.modality);
  new.ends_at := new.starts_at + make_interval(mins => st.duration_min);
  new.blocked_until := new.ends_at + make_interval(mins => st.buffer_min);
  new.price_cents := coalesce(new.price_cents, st.price_cents);
  new.requester_email := nullif(lower(btrim(new.requester_email)), '');
  new.requester_phone := nullif(btrim(new.requester_phone), '');
  new.requester_name := nullif(btrim(new.requester_name), '');
  if new.status = 'confirmada' then
    if new.patient_id is null then
      raise exception 'confirmar_requiere_paciente' using errcode = '23514';
    end if;
    new.confirmed_at := coalesce(new.confirmed_at, now());
  elsif new.status not in ('pendiente') then
    raise exception 'estado_inicial_invalido' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger appointments_before_insert before insert on public.appointments
  for each row execute function private.appointments_before_insert();

create or replace function private.appointments_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- El horario y el servicio no se editan: para cambiarlos se reprograma,
  -- lo que conserva el historial.
  if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
     or new.blocked_until is distinct from old.blocked_until
     or new.session_type_id is distinct from old.session_type_id
     or new.source is distinct from old.source
     or new.created_at is distinct from old.created_at then
    raise exception 'usa_reprogramar' using errcode = '42501';
  end if;

  if new.patient_id is distinct from old.patient_id
     and old.status not in ('pendiente', 'confirmada') then
    raise exception 'paciente_no_editable' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'pendiente'  and new.status in ('confirmada', 'cancelada', 'reprogramada')) or
      (old.status = 'confirmada' and new.status in ('completada', 'cancelada', 'no_asistio', 'reprogramada')) or
      (old.status = 'completada' and new.status in ('no_asistio')) or
      (old.status = 'no_asistio' and new.status in ('completada'))
    ) then
      raise exception 'transicion_invalida:%->%', old.status, new.status using errcode = '23514';
    end if;

    if new.status = 'confirmada' then
      if new.patient_id is null then
        raise exception 'confirmar_requiere_paciente' using errcode = '23514';
      end if;
      new.confirmed_at := now();
    elsif new.status in ('completada', 'no_asistio') then
      if old.starts_at > now() then
        raise exception 'sesion_aun_no_ocurre' using errcode = '23514';
      end if;
      new.completed_at := case when new.status = 'completada' then now() else null end;
    elsif new.status = 'cancelada' then
      new.cancelled_at := now();
      new.cancelled_by := coalesce(new.cancelled_by, 'psicologa');
    end if;
  end if;
  return new;
end $$;
create trigger appointments_before_update before update on public.appointments
  for each row execute function private.appointments_before_update();
create trigger appointments_updated before update on public.appointments
  for each row execute function private.set_updated_at();

-- >>> 20261016000400_expediente.sql
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

-- >>> 20261016000500_pagos.sql
-- ============================================================================
-- 0500 · Control de pagos (administrativo: no procesa cobros bancarios)
--   cargos  = lo que el paciente debe (una sesión realizada, por ejemplo)
--   pagos   = dinero efectivamente recibido
--   saldo   = cargos activos − pagos confirmados (se calcula, no se captura)
-- ============================================================================

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  appointment_id uuid unique references public.appointments(id) on delete set null,
  description text not null check (char_length(btrim(description)) between 2 and 140),
  amount_cents int not null check (amount_cents between 1 and 10000000),
  charged_on date not null default current_date,
  status public.charge_status not null default 'activo',
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'cancelado') = (cancelled_at is not null))
);
create index charges_patient on public.charges (patient_id, charged_on desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  charge_id uuid references public.charges(id) on delete restrict,   -- null = anticipo / saldo a favor
  amount_cents int not null check (amount_cents between 1 and 10000000),
  paid_on date not null,
  method public.payment_method not null,
  reference text check (char_length(reference) <= 80 and not private.looks_like_card(reference)),
  notes text check (char_length(notes) <= 300 and not private.looks_like_card(notes)),
  status public.payment_status not null default 'confirmado',
  confirmed_at timestamptz,
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'confirmado') = (confirmed_at is not null)),
  check ((status = 'anulado') = (voided_at is not null))
);
create index payments_patient on public.payments (patient_id, paid_on desc);
create index payments_charge on public.payments (charge_id);
create index payments_paid_on on public.payments (paid_on) where status = 'confirmado';

create or replace function private.charges_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.patient_id is distinct from old.patient_id then
      raise exception 'campo_inmutable' using errcode = '42501';
    end if;
    if old.status = 'cancelado' and new.status = 'activo' then
      raise exception 'cargo_cancelado' using errcode = '42501';
    end if;
  end if;
  if new.status = 'cancelado' and (tg_op = 'INSERT' or old.status = 'activo') then
    new.cancelled_at := now();
  end if;
  if new.appointment_id is not null and not exists (
    select 1 from public.appointments a where a.id = new.appointment_id and a.patient_id = new.patient_id
  ) then
    raise exception 'cita_de_otro_paciente' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger charges_guard before insert or update on public.charges
  for each row execute function private.charges_guard();
create trigger charges_updated before update on public.charges
  for each row execute function private.set_updated_at();

create or replace function private.payments_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  c public.charges;
begin
  if tg_op = 'UPDATE' then
    if new.patient_id is distinct from old.patient_id or new.amount_cents is distinct from old.amount_cents
       or new.charge_id is distinct from old.charge_id or new.paid_on is distinct from old.paid_on then
      -- Un pago registrado no se reescribe: se anula y se registra de nuevo.
      raise exception 'pago_inmutable' using errcode = '42501';
    end if;
    if old.status = 'anulado' then
      raise exception 'pago_anulado' using errcode = '42501';
    end if;
    if old.status = 'confirmado' and new.status = 'por_confirmar' then
      raise exception 'transicion_invalida' using errcode = '23514';
    end if;
  end if;

  if new.paid_on > (now() at time zone (select timezone from public.practice_settings))::date then
    raise exception 'fecha_pago_futura' using errcode = '23514';
  end if;

  if new.charge_id is not null then
    select * into c from public.charges where id = new.charge_id;
    if c.patient_id <> new.patient_id then
      raise exception 'cargo_de_otro_paciente' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' and c.status = 'cancelado' then
      raise exception 'cargo_cancelado' using errcode = '23514';
    end if;
  end if;

  if new.status = 'confirmado' and (tg_op = 'INSERT' or old.status <> 'confirmado') then
    new.confirmed_at := now();
  end if;
  if new.status = 'anulado' then
    if tg_op = 'INSERT' then
      raise exception 'estado_inicial_invalido' using errcode = '23514';
    end if;
    new.voided_at := now();
    new.confirmed_at := null;
  end if;
  return new;
end $$;
create trigger payments_guard before insert or update on public.payments
  for each row execute function private.payments_guard();
create trigger payments_updated before update on public.payments
  for each row execute function private.set_updated_at();
create trigger payments_no_delete before delete on public.payments
  for each row execute function private.forbid_delete();
create trigger charges_no_delete before delete on public.charges
  for each row execute function private.forbid_delete();

-- Al marcar una sesión como completada se genera su cargo automáticamente con
-- el precio del paciente (si tiene uno propio) o el de la cita.
create or replace function private.appointments_auto_charge()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_amount int;
  v_name text;
  v_tz text;
begin
  if new.status = 'completada' and old.status is distinct from 'completada'
     and new.patient_id is not null
     and not exists (select 1 from public.charges where appointment_id = new.id) then
    select coalesce(p.session_price_cents, new.price_cents) into v_amount
      from public.patients p where p.id = new.patient_id;
    if coalesce(v_amount, 0) > 0 then
      select name into v_name from public.session_types where id = new.session_type_id;
      select timezone into v_tz from public.practice_settings;
      insert into public.charges (patient_id, appointment_id, description, amount_cents, charged_on)
      values (
        new.patient_id, new.id,
        left(v_name || ' · ' || to_char(new.starts_at at time zone v_tz, 'DD/MM/YYYY'), 140),
        v_amount,
        (new.starts_at at time zone v_tz)::date
      );
    end if;
  end if;
  return null;
end $$;
create trigger appointments_auto_charge after update of status on public.appointments
  for each row execute function private.appointments_auto_charge();

-- Vistas de saldos (security_invoker: respetan las políticas RLS de quien consulta)
create view public.charge_balances with (security_invoker = true) as
select
  c.id, c.patient_id, c.appointment_id, c.description, c.amount_cents, c.charged_on, c.status,
  coalesce(sum(p.amount_cents) filter (where p.status = 'confirmado'), 0)::int as paid_cents,
  greatest(c.amount_cents - coalesce(sum(p.amount_cents) filter (where p.status = 'confirmado'), 0), 0)::int as pending_cents,
  case
    when c.status = 'cancelado' then 'cancelado'
    when coalesce(sum(p.amount_cents) filter (where p.status = 'confirmado'), 0) >= c.amount_cents then 'pagado'
    when coalesce(sum(p.amount_cents) filter (where p.status = 'confirmado'), 0) > 0 then 'parcial'
    else 'pendiente'
  end as payment_state
from public.charges c
left join public.payments p on p.charge_id = c.id
group by c.id;

create view public.patient_balances with (security_invoker = true) as
select
  pt.id as patient_id,
  coalesce((select sum(amount_cents) from public.charges c where c.patient_id = pt.id and c.status = 'activo'), 0)::bigint as charged_cents,
  coalesce((select sum(amount_cents) from public.payments p where p.patient_id = pt.id and p.status = 'confirmado'), 0)::bigint as paid_cents,
  (coalesce((select sum(amount_cents) from public.charges c where c.patient_id = pt.id and c.status = 'activo'), 0)
   - coalesce((select sum(amount_cents) from public.payments p where p.patient_id = pt.id and p.status = 'confirmado'), 0))::bigint as balance_cents,
  coalesce((select sum(amount_cents) from public.payments p where p.patient_id = pt.id and p.status = 'por_confirmar'), 0)::bigint as unconfirmed_cents
from public.patients pt;

-- Resumen por periodo: ingresos = solo pagos confirmados, por fecha de pago.
create or replace function public.admin_finance_summary(p_from date, p_to date)
returns table (
  income_cents bigint,
  payments_count bigint,
  unconfirmed_cents bigint,
  charged_cents bigint,
  outstanding_cents bigint
) language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.require_admin();
  if p_to < p_from or p_to - p_from > 1100 then
    raise exception 'periodo_invalido' using errcode = '22023';
  end if;
  return query
  select
    coalesce((select sum(amount_cents) from public.payments where status = 'confirmado' and paid_on between p_from and p_to), 0)::bigint,
    (select count(*) from public.payments where status = 'confirmado' and paid_on between p_from and p_to),
    coalesce((select sum(amount_cents) from public.payments where status = 'por_confirmar' and paid_on between p_from and p_to), 0)::bigint,
    coalesce((select sum(amount_cents) from public.charges where status = 'activo' and charged_on between p_from and p_to), 0)::bigint,
    coalesce((select sum(greatest(balance_cents, 0)) from public.patient_balances), 0)::bigint;
end $$;

-- >>> 20261016000600_auditoria.sql
-- ============================================================================
-- 0600 · Bitácora de auditoría
-- Registra quién hizo qué y cuándo, y QUÉ CAMPOS cambiaron, pero nunca copia
-- su contenido (ni notas clínicas, ni datos de contacto). Es de solo escritura:
-- nadie puede editarla ni borrarla desde la aplicación.
-- ============================================================================

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  action text not null check (action in ('insert', 'update', 'delete', 'view', 'login', 'logout', 'export', 'download')),
  entity text not null check (char_length(entity) <= 60),
  entity_id uuid,
  changed_fields text[],
  context jsonb check (context is null or pg_column_size(context) < 2000)
);
create index audit_log_occurred on public.audit_log (occurred_at desc);
create index audit_log_entity on public.audit_log (entity, entity_id, occurred_at desc);

create or replace function private.current_actor_role()
returns text language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_user::text)
$$;

-- Disparador genérico. Para algunas tablas añade contexto NO sensible
-- (por ejemplo, el cambio de estado de una cita).
create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_fields text[];
  v_ctx jsonb := null;
  v_id uuid;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  else
    v_old := to_jsonb(old);
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_fields
    from jsonb_object_keys(v_new) as k
    where k not in ('updated_at', 'version')
      and (v_new -> k) is distinct from (v_old -> k);
    if v_fields is null then
      return null;   -- nada relevante cambió
    end if;
  end if;

  if tg_table_name in ('appointments') and tg_op = 'UPDATE' and v_old ->> 'status' is distinct from v_new ->> 'status' then
    v_ctx := jsonb_build_object('status_from', v_old ->> 'status', 'status_to', v_new ->> 'status');
  elsif tg_table_name in ('payments') and tg_op = 'UPDATE' and v_old ->> 'status' is distinct from v_new ->> 'status' then
    v_ctx := jsonb_build_object('status_from', v_old ->> 'status', 'status_to', v_new ->> 'status');
  end if;

  select case when x ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then x::uuid end
    into v_id
    from (select coalesce(v_new ->> 'user_id', v_old ->> 'user_id', v_new ->> 'id', v_old ->> 'id') as x) s;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, changed_fields, context)
  values (auth.uid(), private.current_actor_role(), lower(tg_op), tg_table_name, v_id, v_fields, v_ctx);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'admin_users', 'practice_settings', 'session_types', 'availability_rules', 'time_off', 'legal_documents',
    'patients', 'appointments', 'clinical_entries', 'consents', 'patient_documents', 'charges', 'payments'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row()',
      t || '_audit', t);
  end loop;
end $$;

-- Las filas de la bitácora no se modifican. Para depurar registros antiguos
-- conforme a la política de conservación, un operador con acceso directo a la
-- base de datos debe activar explícitamente: set local app.allow_audit_purge = 'on';
create or replace function private.audit_log_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.allow_audit_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'bitacora_inmutable' using errcode = '42501';
end $$;
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

-- Registro de consultas (ej. "se abrió el expediente X"). Solo la cuenta
-- administradora puede llamarla.
create or replace function public.log_access(p_action text, p_entity text, p_entity_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_action not in ('view', 'login', 'logout', 'export', 'download') then
    raise exception 'accion_invalida' using errcode = '22023';
  end if;
  if p_entity !~ '^[a-z_]{2,60}$' then
    raise exception 'entidad_invalida' using errcode = '22023';
  end if;
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id)
  values (auth.uid(), 'authenticated', p_action, p_entity, p_entity_id);
end $$;

-- >>> 20261016000700_notificaciones.sql
-- ============================================================================
-- 0700 · Notificaciones (cola de salida) y límites de uso
-- Los mensajes solo contienen datos de la cita (fecha, hora, servicio,
-- modalidad, lugar, enlace de gestión). Nunca información clínica.
-- ============================================================================

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  kind text not null check (kind in (
    'solicitud_recibida', 'solicitud_admin', 'cita_confirmada', 'recordatorio', 'cita_cancelada'
  )),
  send_after timestamptz not null default now(),
  status text not null default 'pendiente' check (status in ('pendiente', 'enviando', 'enviado', 'omitido', 'error')),
  attempts int not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now()
);
create index notification_outbox_due on public.notification_outbox (send_after) where status in ('pendiente', 'enviando');
create index notification_outbox_appointment on public.notification_outbox (appointment_id);

create or replace function private.appointments_enqueue_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  s public.practice_settings;
  v_when timestamptz;
begin
  select * into s from public.practice_settings;

  if tg_op = 'INSERT' then
    if new.source = 'publica' and new.status = 'pendiente' then
      insert into public.notification_outbox (appointment_id, kind) values (new.id, 'solicitud_recibida');
      if s.admin_alert_on_request and s.admin_alert_email is not null then
        insert into public.notification_outbox (appointment_id, kind) values (new.id, 'solicitud_admin');
      end if;
    end if;
    if new.status = 'confirmada' then
      insert into public.notification_outbox (appointment_id, kind) values (new.id, 'cita_confirmada');
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'confirmada' then
      insert into public.notification_outbox (appointment_id, kind) values (new.id, 'cita_confirmada');
    elsif new.status in ('cancelada', 'reprogramada', 'completada', 'no_asistio') then
      update public.notification_outbox set status = 'omitido'
      where appointment_id = new.id and status = 'pendiente';
      if new.status = 'cancelada' then
        insert into public.notification_outbox (appointment_id, kind) values (new.id, 'cita_cancelada');
      end if;
    end if;
  end if;

  -- Recordatorio para citas confirmadas
  if new.status = 'confirmada' and (tg_op = 'INSERT' or old.status is distinct from 'confirmada') and s.reminders_enabled then
    v_when := new.starts_at - make_interval(hours => s.reminder_hours_before);
    if v_when > now() then
      insert into public.notification_outbox (appointment_id, kind, send_after) values (new.id, 'recordatorio', v_when);
    end if;
  end if;
  return null;
end $$;
create trigger appointments_enqueue_notifications after insert or update of status on public.appointments
  for each row execute function private.appointments_enqueue_notifications();

-- El procesador (función programada en Netlify, con la clave de servicio en el
-- servidor) reclama lotes de mensajes pendientes. Solo service_role puede
-- ejecutar estas dos funciones.
create or replace function public.claim_notifications(p_limit int default 20)
returns table (
  id uuid,
  kind text,
  appointment_id uuid,
  recipient text,
  person_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  service_name text,
  modality public.modality,
  location_details text,
  timezone text,
  template text
) language plpgsql security definer set search_path = '' as $$
begin
  -- Descarta lo que ya no aplica (cita cambiada o sin destinatario).
  update public.notification_outbox o set status = 'omitido'
  from public.appointments a
  where o.appointment_id = a.id and o.status = 'pendiente' and o.send_after <= now()
    and (
      (o.kind = 'recordatorio' and (a.status <> 'confirmada' or a.starts_at <= now())) or
      (o.kind = 'cita_confirmada' and a.status <> 'confirmada') or
      (o.kind = 'solicitud_recibida' and a.status <> 'pendiente')
    );

  return query
  with due as (
    select o.id from public.notification_outbox o
    where (o.status = 'pendiente' and o.send_after <= now())
       or (o.status = 'enviando' and o.claimed_at < now() - interval '10 minutes')
    order by o.send_after
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  ), claimed as (
    update public.notification_outbox o
    set status = 'enviando', claimed_at = now(), attempts = o.attempts + 1
    from due where o.id = due.id
    returning o.*
  )
  select
    c.id, c.kind, c.appointment_id,
    case when c.kind = 'solicitud_admin' then s.admin_alert_email
         when s.notify_patient_email then coalesce(p.email, a.requester_email)
         else null end,
    case when c.kind = 'solicitud_admin' then null
         else split_part(coalesce(p.full_name, a.requester_name), ' ', 1) end,
    a.starts_at, a.ends_at, st.name, a.modality,
    case when a.status = 'confirmada' then a.location_details else null end,
    s.timezone,
    case c.kind
      when 'solicitud_recibida' then s.tpl_request_received
      when 'cita_confirmada' then s.tpl_confirmed
      when 'recordatorio' then s.tpl_reminder
      when 'cita_cancelada' then s.tpl_cancelled
      else null end
  from claimed c
  join public.appointments a on a.id = c.appointment_id
  join public.session_types st on st.id = a.session_type_id
  left join public.patients p on p.id = a.patient_id
  cross join public.practice_settings s;
end $$;

create or replace function public.complete_notification(p_id uuid, p_result text, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_result not in ('enviado', 'omitido', 'error') then
    raise exception 'resultado_invalido' using errcode = '22023';
  end if;
  update public.notification_outbox
  set status = case
        when p_result = 'error' and attempts < 5 then 'pendiente'
        else p_result end,
      send_after = case when p_result = 'error' then now() + make_interval(mins => 5 * attempts) else send_after end,
      sent_at = case when p_result = 'enviado' then now() else sent_at end,
      last_error = left(p_error, 300)
  where id = p_id and status = 'enviando';
end $$;

-- Límites de uso para las funciones públicas --------------------------------
create table private.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

create or replace function private.rate_limit_ok(p_bucket text, p_max int, p_window interval)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := date_bin(p_window, now(), timestamptz '2000-01-01');
  v_hits int;
begin
  insert into private.rate_limits as r (bucket, window_start, hits)
  values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  if random() < 0.02 then
    delete from private.rate_limits where window_start < now() - interval '2 days';
  end if;
  return v_hits <= p_max;
end $$;

-- >>> 20261016000800_reservas.sql
-- ============================================================================
-- 0800 · Disponibilidad y reservas
-- La página pública NUNCA consulta tablas: solo estas funciones, que devuelven
-- horarios libres (sin datos de nadie) y registran solicitudes con validación.
-- ============================================================================

-- Horarios candidatos para un servicio en un intervalo. Excluye pasado,
-- días no disponibles y citas activas (incluido el margen entre sesiones).
create or replace function private.slot_candidates(
  p_session_type_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_exclude_appointment uuid default null,
  p_apply_public_limits boolean default true
) returns setof timestamptz
language sql stable security definer set search_path = '' as $$
  with s as (
    select * from public.practice_settings
  ), st as (
    select * from public.session_types where id = p_session_type_id and active
  ), bounds as (
    select
      greatest(p_from, case when p_apply_public_limits then now() + make_interval(hours => s.min_notice_hours) else now() end) as lo,
      least(p_to, case when p_apply_public_limits then now() + make_interval(days => s.max_days_ahead) else p_to end) as hi,
      s.timezone as tz, s.slot_interval_min as step
    from s
  ), days as (
    select d::date as d
    from bounds b, generate_series((b.lo at time zone b.tz)::date, (b.hi at time zone b.tz)::date, interval '1 day') d
    where b.hi > b.lo
  ), windows as (
    select ((days.d + r.start_time) at time zone b.tz) as w_start,
           ((days.d + r.end_time) at time zone b.tz) as w_end
    from days
    cross join bounds b
    join public.availability_rules r on r.active and r.weekday = extract(dow from days.d)::int
    join st on (r.modality is null or r.modality = st.modality)
  ), slots as (
    select generate_series(w.w_start, w.w_end - make_interval(mins => st.duration_min), make_interval(mins => b.step)) as start_at
    from windows w cross join st cross join bounds b
    where w.w_end - w.w_start >= make_interval(mins => st.duration_min)
  )
  select distinct sl.start_at
  from slots sl cross join st cross join bounds b
  where sl.start_at >= b.lo and sl.start_at < b.hi
    and not exists (
      select 1 from public.time_off t
      where tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(sl.start_at, sl.start_at + make_interval(mins => st.duration_min), '[)')
    )
    and not exists (
      select 1 from public.appointments a
      where a.status in ('pendiente', 'confirmada')
        and a.id is distinct from p_exclude_appointment
        and tstzrange(a.starts_at, a.blocked_until, '[)')
            && tstzrange(sl.start_at, sl.start_at + make_interval(mins => st.duration_min + st.buffer_min), '[)')
    )
  order by 1
$$;
revoke all on function private.slot_candidates(uuid, timestamptz, timestamptz, uuid, boolean) from public;
grant execute on function private.slot_candidates(uuid, timestamptz, timestamptz, uuid, boolean) to authenticated, service_role;

create or replace function private.booking_open()
returns boolean language sql stable security definer set search_path = '' as $$
  select s.booking_enabled
     and exists (select 1 from public.legal_documents where kind = 'aviso_privacidad' and is_current)
     and exists (select 1 from public.session_types where active and is_public)
     and exists (select 1 from public.availability_rules where active)
  from public.practice_settings s
$$;

-- Información pública: perfil, servicios, políticas y aviso de privacidad vigente.
create or replace function public.get_public_info()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'booking_open', private.booking_open(),
    'timezone', s.timezone,
    'min_notice_hours', s.min_notice_hours,
    'max_days_ahead', s.max_days_ahead,
    'patient_change_min_hours', s.patient_change_min_hours,
    'cancellation_policy', s.cancellation_policy,
    'reschedule_policy', s.reschedule_policy,
    'profile', jsonb_build_object(
      'intro', s.public_intro, 'education', s.public_education, 'license', s.public_license,
      'approach', s.public_approach, 'modality', s.public_modality
    ),
    'contact', jsonb_build_object('whatsapp', s.contact_whatsapp, 'email', s.contact_email, 'address', s.contact_address),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', st.id, 'name', st.name, 'description', st.description, 'modality', st.modality,
        'duration_min', st.duration_min,
        'price_cents', case when s.show_prices_public then st.price_cents end
      ) order by st.sort_order, st.name)
      from public.session_types st where st.active and st.is_public
    ), '[]'::jsonb),
    'privacy', (
      select jsonb_build_object('id', d.id, 'version', d.version, 'title', d.title, 'body', d.body, 'published_at', d.published_at)
      from public.legal_documents d where d.kind = 'aviso_privacidad' and d.is_current
    )
  )
  from public.practice_settings s
$$;

create or replace function public.get_available_slots(p_session_type_id uuid, p_from date, p_to date)
returns setof timestamptz language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
begin
  if not private.booking_open() then
    raise exception 'reservas_cerradas' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.session_types where id = p_session_type_id and active and is_public) then
    raise exception 'servicio_no_disponible' using errcode = 'P0001';
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'rango_invalido' using errcode = 'P0001';
  end if;
  select timezone into v_tz from public.practice_settings;
  return query
    select * from private.slot_candidates(
      p_session_type_id,
      (p_from::timestamp at time zone v_tz),
      ((p_to + 1)::timestamp at time zone v_tz),
      null, true);
end $$;

create or replace function private.validate_requester(p_name text, p_email text, p_phone text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_name is null or char_length(btrim(p_name)) not between 2 and 120 then
    raise exception 'nombre_invalido' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_email), '') is null and nullif(btrim(p_phone), '') is null then
    raise exception 'contacto_requerido' using errcode = 'P0001';
  end if;
  if not private.valid_email(nullif(btrim(p_email), '')) then
    raise exception 'correo_invalido' using errcode = 'P0001';
  end if;
  if not private.valid_phone(nullif(btrim(p_phone), '')) then
    raise exception 'telefono_invalido' using errcode = 'P0001';
  end if;
end $$;

-- Solicitud pública de cita. Queda "pendiente" hasta que Lulu la confirme.
-- (La versión pública con límite de intentos está al final del archivo.)
create or replace function private.request_booking_impl(
  p_id uuid,
  p_token_hash text,
  p_session_type_id uuid,
  p_starts_at timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_contact_pref public.contact_pref,
  p_privacy_document_id uuid,
  p_accepts_privacy boolean,
  p_for_minor boolean
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.practice_settings;
  v_email text := nullif(lower(btrim(p_email)), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_row public.appointments;
begin
  if not private.booking_open() then
    raise exception 'reservas_cerradas' using errcode = 'P0001';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_id is null then
    raise exception 'solicitud_invalida' using errcode = 'P0001';
  end if;
  if not coalesce(p_accepts_privacy, false) then
    raise exception 'consentimiento_requerido' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.legal_documents where id = p_privacy_document_id and kind = 'aviso_privacidad' and is_current) then
    raise exception 'aviso_desactualizado' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.session_types where id = p_session_type_id and active and is_public) then
    raise exception 'servicio_no_disponible' using errcode = 'P0001';
  end if;
  perform private.validate_requester(p_name, v_email, v_phone);
  if p_contact_pref = 'correo' and v_email is null then
    raise exception 'correo_requerido' using errcode = 'P0001';
  end if;
  if p_contact_pref in ('whatsapp', 'telefono') and v_phone is null then
    raise exception 'telefono_requerido' using errcode = 'P0001';
  end if;

  select * into s from public.practice_settings;
  if (select count(*) from public.appointments a
      where a.status = 'pendiente' and a.starts_at > now()
        and ((v_email is not null and a.requester_email = v_email) or (v_phone is not null and a.requester_phone = v_phone))
     ) >= s.max_pending_per_contact then
    raise exception 'limite_solicitudes' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from private.slot_candidates(p_session_type_id, p_starts_at, p_starts_at + interval '1 second', null, true) c
    where c = p_starts_at
  ) then
    raise exception 'horario_no_disponible' using errcode = 'P0001';
  end if;

  begin
    insert into public.appointments (
      id, session_type_id, starts_at, status, source,
      requester_name, requester_email, requester_phone, requester_contact_pref, manage_token_hash
    ) values (
      p_id, p_session_type_id, p_starts_at, 'pendiente', 'publica',
      btrim(p_name), v_email, v_phone, p_contact_pref, p_token_hash
    ) returning * into v_row;
  exception
    when exclusion_violation then
      raise exception 'horario_no_disponible' using errcode = 'P0001';
    when unique_violation then
      raise exception 'solicitud_duplicada' using errcode = 'P0001';
  end;

  insert into public.consents (appointment_id, legal_document_id, method, accepted_by_name, on_behalf_of_minor)
  values (v_row.id, p_privacy_document_id, 'formulario_web', btrim(p_name), coalesce(p_for_minor, false));

  return jsonb_build_object(
    'appointment_id', v_row.id, 'status', v_row.status,
    'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at
  );
end $$;

-- Gestión de la cita con el enlace privado -------------------------------------
create or replace function private.appointment_by_token(p_token_hash text)
returns public.appointments language plpgsql security definer set search_path = '' as $$
declare
  v_row public.appointments;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'enlace_invalido' using errcode = 'P0001';
  end if;
  select * into v_row from public.appointments where manage_token_hash = p_token_hash;
  if not found then
    raise exception 'enlace_invalido' using errcode = 'P0001';
  end if;
  return v_row;
end $$;

create or replace function private.get_booking_impl(p_token_hash text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a public.appointments;
  s public.practice_settings;
  st public.session_types;
  v_first text;
begin
  a := private.appointment_by_token(p_token_hash);
  select * into s from public.practice_settings;
  select * into st from public.session_types where id = a.session_type_id;
  select split_part(coalesce(p.full_name, a.requester_name), ' ', 1) into v_first
    from (select 1) x left join public.patients p on p.id = a.patient_id;
  return jsonb_build_object(
    'appointment_id', a.id,
    'first_name', v_first,
    'status', a.status,
    'starts_at', a.starts_at,
    'ends_at', a.ends_at,
    'service', st.name,
    'session_type_id', st.id,
    'service_bookable', st.active and st.is_public,
    'modality', a.modality,
    'location_details', case when a.status = 'confirmada' then a.location_details end,
    'rescheduled_to', a.rescheduled_to,
    'can_change', a.status in ('pendiente', 'confirmada')
                  and a.starts_at - now() >= make_interval(hours => s.patient_change_min_hours),
    'change_deadline', a.starts_at - make_interval(hours => s.patient_change_min_hours),
    'patient_change_min_hours', s.patient_change_min_hours,
    'cancellation_policy', s.cancellation_policy,
    'reschedule_policy', s.reschedule_policy,
    'timezone', s.timezone,
    'contact_whatsapp', s.contact_whatsapp
  );
end $$;

create or replace function private.cancel_booking_impl(p_token_hash text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a public.appointments;
  s public.practice_settings;
begin
  a := private.appointment_by_token(p_token_hash);
  select * into s from public.practice_settings;
  if a.status not in ('pendiente', 'confirmada') then
    raise exception 'cita_no_modificable' using errcode = 'P0001';
  end if;
  if a.starts_at - now() < make_interval(hours => s.patient_change_min_hours) then
    raise exception 'fuera_de_plazo' using errcode = 'P0001';
  end if;
  update public.appointments
     set status = 'cancelada', cancelled_by = 'paciente'
   where id = a.id;
  return jsonb_build_object('appointment_id', a.id, 'status', 'cancelada');
end $$;

create or replace function private.reschedule_booking_impl(
  p_token_hash text,
  p_new_id uuid,
  p_new_token_hash text,
  p_new_starts_at timestamptz
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a public.appointments;
  s public.practice_settings;
  v_new public.appointments;
begin
  a := private.appointment_by_token(p_token_hash);
  select * into s from public.practice_settings;
  if not private.booking_open() then
    raise exception 'reservas_cerradas' using errcode = 'P0001';
  end if;
  if a.status not in ('pendiente', 'confirmada') then
    raise exception 'cita_no_modificable' using errcode = 'P0001';
  end if;
  if a.starts_at - now() < make_interval(hours => s.patient_change_min_hours) then
    raise exception 'fuera_de_plazo' using errcode = 'P0001';
  end if;
  if p_new_id is null or p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'solicitud_invalida' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.session_types where id = a.session_type_id and active and is_public) then
    raise exception 'servicio_no_disponible' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from private.slot_candidates(a.session_type_id, p_new_starts_at, p_new_starts_at + interval '1 second', a.id, true) c
    where c = p_new_starts_at
  ) then
    raise exception 'horario_no_disponible' using errcode = 'P0001';
  end if;

  update public.appointments set status = 'reprogramada', rescheduled_to = null where id = a.id;
  begin
    insert into public.appointments (
      id, patient_id, session_type_id, modality, starts_at, status, source, price_cents,
      requester_name, requester_email, requester_phone, requester_contact_pref,
      manage_token_hash, location_details, rescheduled_from
    ) values (
      p_new_id, a.patient_id, a.session_type_id, a.modality, p_new_starts_at, 'pendiente', a.source, a.price_cents,
      a.requester_name, a.requester_email, a.requester_phone, a.requester_contact_pref,
      p_new_token_hash, a.location_details, a.id
    ) returning * into v_new;
  exception
    when exclusion_violation then
      raise exception 'horario_no_disponible' using errcode = 'P0001';
    when unique_violation then
      raise exception 'solicitud_duplicada' using errcode = 'P0001';
  end;
  update public.appointments set rescheduled_to = v_new.id where id = a.id;
  update public.consents set appointment_id = v_new.id where appointment_id = a.id and patient_id is null;

  return jsonb_build_object(
    'appointment_id', v_new.id, 'status', v_new.status,
    'starts_at', v_new.starts_at, 'ends_at', v_new.ends_at
  );
end $$;

-- Funciones del panel (se ejecutan con los permisos de la cuenta administradora)
create or replace function public.admin_available_slots(
  p_session_type_id uuid, p_from date, p_to date, p_exclude_appointment uuid default null
) returns setof timestamptz language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tz text;
begin
  perform private.require_admin();
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'rango_invalido' using errcode = '22023';
  end if;
  select timezone into v_tz from public.practice_settings;
  return query select * from private.slot_candidates(
    p_session_type_id, (p_from::timestamp at time zone v_tz), ((p_to + 1)::timestamp at time zone v_tz),
    p_exclude_appointment, false);
end $$;

-- Confirma una cita. Si viene de la página pública y no está vinculada,
-- la vincula al expediente indicado o crea uno nuevo con los datos mínimos.
create or replace function public.admin_confirm_appointment(
  p_appointment_id uuid, p_patient_id uuid default null, p_location_details text default null
) returns uuid language plpgsql volatile security invoker set search_path = '' as $$
declare
  a public.appointments;
  v_patient uuid;
begin
  perform private.require_admin();
  select * into a from public.appointments where id = p_appointment_id for update;
  if not found then raise exception 'cita_inexistente' using errcode = 'P0002'; end if;
  if a.status <> 'pendiente' then raise exception 'cita_no_pendiente' using errcode = '23514'; end if;

  v_patient := coalesce(a.patient_id, p_patient_id);
  if v_patient is null then
    insert into public.patients (full_name, email, phone, preferred_contact)
    values (a.requester_name, a.requester_email, a.requester_phone, a.requester_contact_pref)
    returning id into v_patient;
  end if;

  update public.appointments
     set patient_id = v_patient,
         status = 'confirmada',
         location_details = coalesce(nullif(btrim(p_location_details), ''), location_details)
   where id = a.id;
  return v_patient;
end $$;

-- Reprograma conservando el historial: la cita original queda "reprogramada"
-- y apunta a la nueva. El panel puede usar cualquier horario libre (incluso
-- fuera del horario publicado), pero nunca uno ocupado.
create or replace function public.admin_reschedule_appointment(
  p_appointment_id uuid, p_new_id uuid, p_new_token_hash text, p_new_starts_at timestamptz
) returns uuid language plpgsql volatile security invoker set search_path = '' as $$
declare
  a public.appointments;
  v_new uuid;
begin
  perform private.require_admin();
  select * into a from public.appointments where id = p_appointment_id for update;
  if not found then raise exception 'cita_inexistente' using errcode = 'P0002'; end if;
  if a.status not in ('pendiente', 'confirmada') then raise exception 'cita_no_modificable' using errcode = '23514'; end if;
  if p_new_starts_at <= now() then raise exception 'horario_pasado' using errcode = '23514'; end if;
  if p_new_token_hash is not null and p_new_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'solicitud_invalida' using errcode = '22023';
  end if;

  update public.appointments set status = 'reprogramada' where id = a.id;
  begin
    insert into public.appointments (
      id, patient_id, session_type_id, modality, starts_at, status, source, price_cents,
      requester_name, requester_email, requester_phone, requester_contact_pref,
      manage_token_hash, location_details, rescheduled_from
    ) values (
      p_new_id, a.patient_id, a.session_type_id, a.modality, p_new_starts_at,
      case when a.patient_id is not null then 'confirmada'::public.appointment_status else 'pendiente' end,
      a.source, a.price_cents,
      a.requester_name, a.requester_email, a.requester_phone, a.requester_contact_pref,
      p_new_token_hash, a.location_details, a.id
    ) returning id into v_new;
  exception
    when exclusion_violation then
      raise exception 'horario_no_disponible' using errcode = '23P01';
  end;
  update public.appointments set rescheduled_to = v_new where id = a.id;
  update public.consents set appointment_id = v_new where appointment_id = a.id and patient_id is null;
  return v_new;
end $$;

-- Vista de expedientes con última sesión, próxima cita y saldo.
create view public.patient_overview with (security_invoker = true) as
select
  p.*,
  (select max(a.starts_at) from public.appointments a where a.patient_id = p.id and a.status = 'completada') as last_session_at,
  (select min(a.starts_at) from public.appointments a
    where a.patient_id = p.id and a.status in ('pendiente', 'confirmada') and a.starts_at > now()) as next_appointment_at,
  coalesce(b.balance_cents, 0) as balance_cents
from public.patients p
left join public.patient_balances b on b.patient_id = p.id;

-- ============================================================================
-- Funciones públicas (envoltorios)
-- Aplican el límite de intentos y devuelven los errores esperados como
-- {"error": "codigo"} en lugar de abortar. Así el contador de intentos se
-- conserva aunque la solicitud se rechace (un error abortaría la transacción
-- completa, incluido el contador).
-- ============================================================================
create or replace function private.client_allowed(p_client_key text, p_scope text, p_max int, p_window interval)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_client_key is null or p_client_key !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  return private.rate_limit_ok(p_scope || ':' || p_client_key, p_max, p_window);
end $$;

create or replace function public.request_booking(
  p_id uuid,
  p_token_hash text,
  p_session_type_id uuid,
  p_starts_at timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_contact_pref public.contact_pref,
  p_privacy_document_id uuid,
  p_accepts_privacy boolean,
  p_for_minor boolean,
  p_client_key text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.client_allowed(p_client_key, 'book', 5, interval '1 hour')
     or not private.rate_limit_ok('book:global', 120, interval '1 hour') then
    return jsonb_build_object('error', 'demasiados_intentos');
  end if;
  begin
    return private.request_booking_impl(p_id, p_token_hash, p_session_type_id, p_starts_at, p_name, p_email,
      p_phone, p_contact_pref, p_privacy_document_id, p_accepts_privacy, p_for_minor);
  exception when sqlstate 'P0001' then
    return jsonb_build_object('error', sqlerrm);
  end;
end $$;

create or replace function public.get_booking_by_token(p_token_hash text, p_client_key text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.client_allowed(p_client_key, 'token', 30, interval '10 minutes') then
    return jsonb_build_object('error', 'demasiados_intentos');
  end if;
  begin
    return private.get_booking_impl(p_token_hash);
  exception when sqlstate 'P0001' then
    return jsonb_build_object('error', sqlerrm);
  end;
end $$;

create or replace function public.cancel_booking_by_token(p_token_hash text, p_client_key text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.client_allowed(p_client_key, 'token', 30, interval '10 minutes') then
    return jsonb_build_object('error', 'demasiados_intentos');
  end if;
  begin
    return private.cancel_booking_impl(p_token_hash);
  exception when sqlstate 'P0001' then
    return jsonb_build_object('error', sqlerrm);
  end;
end $$;

create or replace function public.reschedule_booking_by_token(
  p_token_hash text,
  p_new_id uuid,
  p_new_token_hash text,
  p_new_starts_at timestamptz,
  p_client_key text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.client_allowed(p_client_key, 'token', 30, interval '10 minutes')
     or not private.rate_limit_ok('book:global', 120, interval '1 hour') then
    return jsonb_build_object('error', 'demasiados_intentos');
  end if;
  begin
    return private.reschedule_booking_impl(p_token_hash, p_new_id, p_new_token_hash, p_new_starts_at);
  exception when sqlstate 'P0001' then
    return jsonb_build_object('error', sqlerrm);
  end;
end $$;

-- >>> 20261016000900_permisos_rls.sql
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

-- >>> 20261016001000_storage.sql
-- ============================================================================
-- 1000 · Almacenamiento privado de documentos del expediente
-- Bucket privado: los archivos solo se descargan con URLs firmadas de corta
-- duración generadas para la cuenta administradora.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expedientes', 'expedientes', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy expedientes_select on storage.objects for select to authenticated
  using (bucket_id = 'expedientes' and (select private.is_admin()));
create policy expedientes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'expedientes' and (select private.is_admin()) and name ~ '^patients/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$');
create policy expedientes_update on storage.objects for update to authenticated
  using (bucket_id = 'expedientes' and (select private.is_admin()))
  with check (bucket_id = 'expedientes' and (select private.is_admin()));
create policy expedientes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'expedientes' and (select private.is_admin()));

-- >>> 20261016001100_depuracion.sql
-- ============================================================================
-- 1100 · Depuración de un expediente al terminar su plazo de conservación
-- (cancelación por derechos ARCO o política de conservación).
--
-- La aplicación NO puede borrar registros clínicos, consentimientos, pagos ni
-- la bitácora. Esta función es la única vía, y solo la puede ejecutar quien
-- tenga acceso directo a la base de datos (rol postgres, desde el editor SQL
-- de Supabase). Ver docs/OPERACION.md.
-- ============================================================================

-- Los disparadores de protección aceptan borrar solo dentro de una depuración.
create or replace function private.forbid_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.allow_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'operacion_no_permitida' using errcode = '42501';
end $$;

create or replace function private.revisions_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.allow_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'historial_inmutable' using errcode = '42501';
end $$;

create or replace function private.purge_patient(
  p_patient_id uuid,
  p_confirm_code text,
  p_reason text,
  p_ignore_retention boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.patients;
  v_last timestamptz;
  v_counts jsonb;
begin
  select * into p from public.patients where id = p_patient_id for update;
  if not found then
    raise exception 'expediente_inexistente';
  end if;
  if p_confirm_code is distinct from p.internal_code then
    raise exception 'confirmacion_incorrecta: escribe el identificador interno (%) para confirmar', p.internal_code;
  end if;
  if char_length(coalesce(p_reason, '')) < 10 then
    raise exception 'motivo_requerido: describe el fundamento (solicitud ARCO, fin del plazo de conservación, etc.)';
  end if;
  if p.status <> 'archivado' then
    raise exception 'archiva_primero: el expediente debe estar en estado "archivado" (bloqueo) antes de depurarse';
  end if;
  if exists (select 1 from public.patient_documents where patient_id = p_patient_id) then
    raise exception 'documentos_pendientes: elimina primero los documentos desde el panel para borrar también los archivos';
  end if;

  select greatest(
    (select max(starts_at) from public.appointments where patient_id = p_patient_id),
    (select max(created_at) from public.clinical_entries where patient_id = p_patient_id),
    p.updated_at
  ) into v_last;
  if not p_ignore_retention and v_last > now() - interval '5 years' then
    raise exception 'en_plazo_de_conservacion: el último registro es del %; la NOM-004-SSA3-2012 pide conservar al menos 5 años', to_char(v_last, 'DD/MM/YYYY');
  end if;

  v_counts := jsonb_build_object(
    'citas', (select count(*) from public.appointments where patient_id = p_patient_id),
    'registros', (select count(*) from public.clinical_entries where patient_id = p_patient_id),
    'pagos', (select count(*) from public.payments where patient_id = p_patient_id)
  );

  perform set_config('app.allow_purge', 'on', true);
  delete from public.clinical_entry_revisions r using public.clinical_entries e where r.entry_id = e.id and e.patient_id = p_patient_id;
  delete from public.clinical_entries where patient_id = p_patient_id;
  delete from public.payments where patient_id = p_patient_id;
  delete from public.charges where patient_id = p_patient_id;
  delete from public.consents where patient_id = p_patient_id
     or appointment_id in (select id from public.appointments where patient_id = p_patient_id);
  update public.appointments set rescheduled_from = null where rescheduled_from in (select id from public.appointments where patient_id = p_patient_id);
  update public.appointments set rescheduled_to = null where rescheduled_to in (select id from public.appointments where patient_id = p_patient_id);
  delete from public.appointments where patient_id = p_patient_id;
  delete from public.patients where id = p_patient_id;
  perform set_config('app.allow_purge', 'off', true);

  -- Constancia sin datos personales: solo el identificador interno y el motivo.
  insert into public.audit_log (actor_role, action, entity, entity_id, context)
  values ('operador', 'delete', 'depuracion_expediente', p_patient_id,
          jsonb_build_object('codigo', p.internal_code, 'motivo', left(p_reason, 300), 'conteos', v_counts));
  return jsonb_build_object('depurado', p.internal_code, 'conteos', v_counts);
end $$;

-- Nadie de la aplicación puede ejecutarla (ni anon, ni authenticated, ni service_role).
revoke all on function private.purge_patient(uuid, text, text, boolean) from public, anon, authenticated, service_role;
