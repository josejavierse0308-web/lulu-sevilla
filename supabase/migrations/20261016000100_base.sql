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
