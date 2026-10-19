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
