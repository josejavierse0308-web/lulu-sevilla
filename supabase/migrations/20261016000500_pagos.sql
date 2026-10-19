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
