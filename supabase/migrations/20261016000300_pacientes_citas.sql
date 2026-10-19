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
