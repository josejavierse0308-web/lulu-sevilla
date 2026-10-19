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
