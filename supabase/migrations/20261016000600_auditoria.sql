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
