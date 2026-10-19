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
