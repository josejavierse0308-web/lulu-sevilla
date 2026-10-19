-- ============================================================================
-- Pruebas de base de datos (datos 100 % ficticios).
-- Cada bloque DO es una transacción; "set local role" simula quién llama:
--   anon           → la página pública
--   authenticated  → una sesión iniciada (Lulu o un intruso)
--   service_role   → el procesador de notificaciones en el servidor
-- ============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema test;
create table test.ids (k text primary key, v uuid);
create table test.tokens (k text primary key, v text);

create function test.ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if c is not true then raise exception 'FALLÓ: %', msg; end if;
  raise notice '  ✓ %', msg;
end $$;

create function test.throws(p_sql text, p_like text, msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike p_like then raise notice '  ✓ % (%)', msg, sqlerrm; return; end if;
    raise exception 'FALLÓ: % — error inesperado: % [%]', msg, sqlerrm, sqlstate;
  end;
  raise exception 'FALLÓ: % — debía fallar y no falló', msg;
end $$;

create function test.err(r jsonb, p_code text, msg text) returns void language plpgsql as $$
begin
  if r ->> 'error' is distinct from p_code then
    raise exception 'FALLÓ: % — se esperaba error %, se obtuvo %', msg, p_code, r;
  end if;
  raise notice '  ✓ % (%)', msg, p_code;
end $$;

create function test.id(p text) returns uuid language sql stable as $$ select v from test.ids where k = p $$;
create function test.tok(p text) returns text language sql stable as $$ select v from test.tokens where k = p $$;
create function test.hash(p text) returns text language sql immutable as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

create function test.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
end $$;
create function test.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function test.as_user_aal(p uuid, p_aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, true);
  set local role authenticated;
end $$;
create function test.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
end $$;

grant usage on schema test to anon, authenticated, service_role;
grant select, insert, update on all tables in schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- Fecha de referencia: dentro de 3 días (hora de Ciudad de México)
create function test.day(p_offset int default 3) returns date language sql stable as $$
  select (now() at time zone 'America/Mexico_City')::date + p_offset
$$;
create function test.at(p_offset int, p_time text) returns timestamptz language sql stable as $$
  select ((test.day(p_offset) + p_time::time)::timestamp at time zone 'America/Mexico_City')
$$;

-- ---------------------------------------------------------------------------
\echo '— Preparación: cuentas y configuración ficticia'
do $$
declare v_lulu uuid; v_intruso uuid; v_st uuid; v_st2 uuid;
begin
  insert into auth.users (email) values ('lulu@ejemplo.test') returning id into v_lulu;
  insert into auth.users (email) values ('intruso@ejemplo.test') returning id into v_intruso;
  insert into test.ids values ('lulu', v_lulu), ('intruso', v_intruso);
  insert into public.admin_users (user_id) values (v_lulu);
  perform test.throws($q$insert into public.admin_users (user_id) select id from auth.users where email = 'intruso@ejemplo.test'$q$,
    '%admin_users_single_account%', 'solo puede existir una cuenta administradora');
end $$;

do $$
declare v_st uuid; v_st2 uuid; d int;
begin
  perform test.as_user(test.id('lulu'));
  insert into public.session_types (name, modality, duration_min, buffer_min, price_cents)
    values ('Sesión individual (prueba)', 'en_linea', 50, 10, 80000) returning id into v_st;
  insert into public.session_types (name, modality, duration_min, price_cents, is_public)
    values ('Servicio privado (prueba)', 'presencial', 50, 90000, false) returning id into v_st2;
  insert into test.ids values ('st', v_st), ('st_privado', v_st2);
  for d in 0..6 loop
    insert into public.availability_rules (weekday, start_time, end_time) values (d, '09:00', '13:00'), (d, '15:00', '19:00');
  end loop;
  perform test.throws($q$insert into public.availability_rules (weekday, start_time, end_time) values (1, '12:00', '14:00')$q$,
    '%franja_encimada%', 'no se pueden encimar franjas de horario');
  perform test.ok(public.admin_publish_legal_document('aviso_privacidad', 'Aviso de privacidad (prueba)',
    repeat('Texto ficticio del aviso de privacidad para pruebas. ', 3)) is not null, 'publica aviso de privacidad v1');
  insert into test.ids select 'aviso1', id from public.legal_documents where kind = 'aviso_privacidad' and is_current;
end $$;

-- ---------------------------------------------------------------------------
\echo '— Página pública con reservas cerradas'
do $$
begin
  perform test.as_anon();
  perform test.ok((public.get_public_info() ->> 'booking_open')::boolean = false, 'las reservas empiezan cerradas');
  perform test.throws($q$select public.get_available_slots(test.id('st'), test.day(), test.day())$q$, '%reservas_cerradas%',
    'no se publican horarios mientras estén cerradas');
end $$;

do $$
begin
  perform test.as_user(test.id('lulu'));
  update public.practice_settings set booking_enabled = true, admin_alert_email = 'lulu@ejemplo.test';
end $$;

-- ---------------------------------------------------------------------------
\echo '— El rol anónimo no puede tocar ninguna tabla'
do $$
declare t text;
begin
  perform test.as_anon();
  foreach t in array array['patients','appointments','clinical_entries','clinical_entry_revisions','consents',
    'payments','charges','audit_log','practice_settings','session_types','availability_rules','time_off',
    'legal_documents','patient_documents','notification_outbox','admin_users','patient_overview','patient_balances','charge_balances'] loop
    perform test.throws(format('select count(*) from public.%I', t), '%permission denied%', 'anon no puede leer ' || t);
  end loop;
  perform test.throws($q$insert into public.appointments (session_type_id, starts_at, source, requester_name, requester_email)
    values (test.id('st'), now() + interval '5 days', 'publica', 'X', 'x@x.mx')$q$, '%permission denied%', 'anon no puede insertar citas directamente');
  perform test.throws($q$select public.admin_finance_summary(current_date, current_date)$q$, '%permission denied%', 'anon no puede ver finanzas');
  perform test.throws($q$select * from public.claim_notifications(5)$q$, '%permission denied%', 'anon no puede leer la cola de mensajes');
  perform test.throws($q$select private.slot_candidates(test.id('st'), now(), now() + interval '1 day')$q$, '%permission denied%', 'anon no puede llamar funciones privadas');
end $$;

-- ---------------------------------------------------------------------------
\echo '— Información pública y horarios'
do $$
declare info jsonb; n int; first_slot timestamptz;
begin
  perform test.as_anon();
  info := public.get_public_info();
  perform test.ok((info ->> 'booking_open')::boolean, 'reservas abiertas tras configurar');
  perform test.ok(jsonb_array_length(info -> 'services') = 1, 'solo se publican servicios públicos');
  perform test.ok((info -> 'services' -> 0 ->> 'price_cents') is null, 'el precio no se publica si no se autoriza');
  perform test.ok((info -> 'privacy' ->> 'id')::uuid = test.id('aviso1'), 'se publica el aviso vigente');
  perform test.ok(info::text not ilike '%prueba)%privado%', 'no expone servicios privados');

  select count(*), min(s) into n, first_slot from public.get_available_slots(test.id('st'), test.day(), test.day()) s;
  -- 09:00–13:00 → 9,10,11,12 (50 min caben antes de las 13) ; 15:00–19:00 → 15,16,17,18 = 8
  perform test.ok(n = 8, format('8 horarios libres en el día (hubo %s)', n));
  perform test.ok(first_slot = test.at(3, '09:00'), 'el primer horario es a las 09:00 hora local');
  perform test.throws($q$select public.get_available_slots(test.id('st_privado'), test.day(), test.day())$q$, '%servicio_no_disponible%',
    'no se puede reservar un servicio privado');
  perform test.throws($q$select public.get_available_slots(test.id('st'), test.day(), test.day(80))$q$, '%rango_invalido%', 'rango acotado');
  select count(*) into n from public.get_available_slots(test.id('st'), test.day(0), test.day(0)) s where s < now() + interval '24 hours';
  perform test.ok(n = 0, 'respeta la anticipación mínima de 24 h');
  select count(*) into n from public.get_available_slots(test.id('st'), test.day(50), test.day(52));
  perform test.ok(n = 0, 'no ofrece fechas más allá del límite (45 días)');
end $$;

-- ---------------------------------------------------------------------------
\echo '— Solicitudes públicas'
do $$
declare r jsonb; v_id uuid := gen_random_uuid();
begin
  perform test.as_anon();
  insert into test.tokens values ('a', 'token-cita-a-ficticio');
  r := public.request_booking(v_id, test.hash('token-cita-a-ficticio'), test.id('st'), test.at(3, '10:00'),
        'Ana Prueba Ficticia', 'ana@ejemplo.test', null, 'correo', test.id('aviso1'), true, false, test.hash('ip-1'));
  perform test.ok(r ->> 'status' = 'pendiente', 'la solicitud queda pendiente');
  insert into test.ids values ('cita_a', v_id);

  perform test.err(public.request_booking(gen_random_uuid(), test.hash('otro'), test.id('st'), test.at(3, '10:00'),
        'Bruno Ficticio', 'bruno@ejemplo.test', null, 'correo', test.id('aviso1'), true, false, test.hash('ip-2-1')), 'horario_no_disponible', 'no permite reservar un horario ocupado');
  perform test.err(public.request_booking(gen_random_uuid(), test.hash('otro2'), test.id('st'), test.at(3, '10:30'),
        'Bruno Ficticio', 'bruno@ejemplo.test', null, 'correo', test.id('aviso1'), true, false, test.hash('ip-2-2')), 'horario_no_disponible', 'no permite horarios fuera de la cuadrícula ni encimados');
  perform test.err(public.request_booking(gen_random_uuid(), test.hash('otro3'), test.id('st'), test.at(3, '11:00'),
        'Bruno Ficticio', 'bruno@ejemplo.test', null, 'correo', test.id('aviso1'), false, false, test.hash('ip-2-3')), 'consentimiento_requerido', 'exige aceptar el aviso de privacidad');
  perform test.err(public.request_booking(gen_random_uuid(), test.hash('otro4'), test.id('st'), test.at(3, '11:00'),
        'Bruno Ficticio', 'bruno@ejemplo.test', null, 'correo', gen_random_uuid(), true, false, test.hash('ip-2-4')), 'aviso_desactualizado', 'exige la versión vigente del aviso');
  perform test.err(public.request_booking(gen_random_uuid(), test.hash('otro5'), test.id('st'), test.at(3, '11:00'),
        'Bruno Ficticio', null, null, 'correo', test.id('aviso1'), true, false, test.hash('ip-2-5')), 'contacto_requerido', 'exige un medio de contacto');
  perform test.err(public.request_booking(gen_random_uuid(), test.hash('otro6'), test.id('st'), test.at(3, '11:00'),
        'Bruno Ficticio', 'no-es-correo', null, 'correo', test.id('aviso1'), true, false, test.hash('ip-2-6')), 'correo_invalido', 'valida el correo');
  perform test.err(public.request_booking(gen_random_uuid(), test.hash('otro7'), test.id('st'), test.at(3, '11:00'),
        'Bruno Ficticio', 'bruno@ejemplo.test', null, 'whatsapp', test.id('aviso1'), true, false, test.hash('ip-2-7')), 'telefono_requerido', 'si prefiere WhatsApp, pide teléfono');
end $$;

do $$
declare r jsonb; n int;
begin
  perform test.as_anon();
  -- Límite de solicitudes pendientes por contacto (2)
  r := public.request_booking(gen_random_uuid(), test.hash('ana-2'), test.id('st'), test.at(4, '09:00'),
        'Ana Prueba Ficticia', 'ANA@ejemplo.test', null, 'correo', test.id('aviso1'), true, false, test.hash('ip-1'));
  perform test.err(public.request_booking(gen_random_uuid(), test.hash('ana-3'), test.id('st'), test.at(4, '10:00'),
        'Ana Prueba Ficticia', 'ana@ejemplo.test', null, 'correo', test.id('aviso1'), true, false, test.hash('ip-3')), 'limite_solicitudes', 'limita solicitudes pendientes por persona');
  select count(*) into n from public.get_available_slots(test.id('st'), test.day(), test.day());
  perform test.ok(n = 7, 'el horario reservado desaparece de la disponibilidad');
end $$;

do $$
declare i int;
begin
  perform test.as_anon();
  -- Límite por origen: 5 intentos por hora (ip-9)
  for i in 1..5 loop
    begin
      perform public.request_booking(gen_random_uuid(), test.hash('spam' || i), test.id('st'), test.at(5, '09:00'),
        'Spam', 'spam' || i || '@ejemplo.test', null, 'correo', test.id('aviso1'), true, false, test.hash('ip-9'));
    exception when others then null;
    end;
  end loop;
  perform test.err(public.request_booking(gen_random_uuid(), test.hash('spam6'), test.id('st'), test.at(5, '16:00'),
        'Spam', 'spam6@ejemplo.test', null, 'correo', test.id('aviso1'), true, false, test.hash('ip-9')), 'demasiados_intentos', 'limita intentos repetidos desde el mismo origen');
end $$;

-- ---------------------------------------------------------------------------
\echo '— Enlace privado del paciente'
do $$
declare r jsonb; v_new uuid := gen_random_uuid(); n int;
begin
  perform test.as_anon();
  r := public.get_booking_by_token(test.hash(test.tok('a')), test.hash('ip-1'));
  perform test.ok(r ->> 'status' = 'pendiente' and r ->> 'first_name' = 'Ana', 'consulta su cita con el enlace');
  perform test.ok(r::text not ilike '%ana@ejemplo%', 'el enlace no devuelve datos de contacto');
  perform test.ok((r ->> 'can_change')::boolean, 'puede cambiarla con anticipación');
  perform test.err(public.get_booking_by_token(test.hash('inventado'), test.hash('ip-1')), 'enlace_invalido', 'rechaza enlaces inválidos');

  r := public.reschedule_booking_by_token(test.hash(test.tok('a')), v_new, test.hash('token-cita-a2'), test.at(3, '16:00'), test.hash('ip-1'));
  perform test.ok(r ->> 'status' = 'pendiente', 'reprograma: la nueva cita queda pendiente de confirmar');
  insert into test.ids values ('cita_a2', v_new);
  insert into test.tokens values ('a2', 'token-cita-a2');
  r := public.get_booking_by_token(test.hash(test.tok('a')), test.hash('ip-1'));
  perform test.ok(r ->> 'status' = 'reprogramada' and (r ->> 'rescheduled_to')::uuid = v_new, 'la cita original apunta a la nueva');
  select count(*) into n from public.get_available_slots(test.id('st'), test.day(), test.day()) s where s = test.at(3, '10:00');
  perform test.ok(n = 1, 'el horario anterior vuelve a quedar libre');
  perform test.err(public.cancel_booking_by_token(test.hash(test.tok('a')), test.hash('ip-1')), 'cita_no_modificable', 'una cita reprogramada ya no se cancela');
end $$;

-- ---------------------------------------------------------------------------
\echo '— Una sesión que no es la de Lulu no ve nada'
do $$
declare n int;
begin
  perform test.as_user(test.id('intruso'));
  select count(*) into n from public.appointments; perform test.ok(n = 0, 'intruso ve 0 citas');
  select count(*) into n from public.patients; perform test.ok(n = 0, 'intruso ve 0 pacientes');
  select count(*) into n from public.audit_log; perform test.ok(n = 0, 'intruso no ve la bitácora');
  perform test.throws($q$insert into public.patients (full_name) values ('Intruso')$q$, '%row-level security%', 'intruso no puede crear pacientes');
  update public.practice_settings set booking_enabled = false;
  get diagnostics n = row_count;
  perform test.ok(n = 0, 'intruso no puede cambiar ajustes (0 filas afectadas)');
  update public.appointments set status = 'cancelada';
  get diagnostics n = row_count;
  perform test.ok(n = 0, 'intruso no puede cancelar citas (0 filas afectadas)');
  perform test.throws($q$select public.admin_finance_summary(current_date, current_date)$q$, '%no_autorizado%', 'intruso no ve finanzas');
  perform test.throws($q$select public.admin_confirm_appointment(test.id('cita_a2'))$q$, '%no_autorizado%', 'intruso no confirma citas');
  perform test.throws($q$select public.log_access('view', 'patients', gen_random_uuid())$q$, '%no_autorizado%', 'intruso no escribe en la bitácora');
  perform test.throws($q$insert into storage.objects (bucket_id, name) values ('expedientes', 'patients/' || gen_random_uuid() || '/' || gen_random_uuid() || '.pdf')$q$,
    '%row-level security%', 'intruso no sube archivos');
end $$;

do $$
declare n int;
begin
  perform test.as_user(test.id('lulu'));
  select count(*) into n from public.practice_settings where booking_enabled;
  perform test.ok(n = 1, 'los ajustes siguen intactos tras el intento del intruso');
end $$;

-- ---------------------------------------------------------------------------
\echo '— Panel: confirmar solicitud y vincular expediente'
do $$
declare v_patient uuid; p public.patients; n int;
begin
  perform test.as_user(test.id('lulu'));
  v_patient := public.admin_confirm_appointment(test.id('cita_a2'), null, 'https://videollamada.ejemplo.test/sala');
  insert into test.ids values ('ana', v_patient);
  select * into p from public.patients where id = v_patient;
  perform test.ok(p.full_name = 'Ana Prueba Ficticia' and p.email = 'ana@ejemplo.test', 'crea el expediente con los datos mínimos');
  perform test.ok(p.internal_code ~ '^LS-\d{4}$', 'asigna identificador interno ' || p.internal_code);
  perform test.ok((select status from public.appointments where id = test.id('cita_a2')) = 'confirmada', 'la cita queda confirmada');
  select count(*) into n from public.consents where patient_id = v_patient;
  perform test.ok(n = 1, 'el consentimiento de la solicitud pasa al expediente');
  select count(*) into n from public.notification_outbox where appointment_id = test.id('cita_a2') and kind = 'cita_confirmada';
  perform test.ok(n = 1, 'se encola la confirmación para el paciente');
  perform test.throws($q$update public.appointments set starts_at = starts_at + interval '1 hour' where id = test.id('cita_a2')$q$,
    '%usa_reprogramar%', 'el horario no se edita directamente, se reprograma');
  perform test.throws($q$update public.appointments set status = 'completada' where id = test.id('cita_a2')$q$,
    '%sesion_aun_no_ocurre%', 'no se completa una sesión futura');
  perform test.throws($q$update public.patients set internal_code = 'LS-9999' where id = test.id('ana')$q$,
    '%identificador_inmutable%', 'el identificador interno no cambia');
end $$;

do $$
declare v_new uuid := gen_random_uuid(); n int;
begin
  perform test.as_user(test.id('lulu'));
  perform test.throws(format($q$insert into public.appointments (patient_id, session_type_id, starts_at, status, source)
      values (%L, %L, %L, 'confirmada', 'panel')$q$, test.id('ana'), test.id('st'), test.at(3, '16:20')),
    '%appointments_no_overlap%', 'la base de datos impide citas encimadas aunque las cree el panel');
  perform public.admin_reschedule_appointment(test.id('cita_a2'), v_new, test.hash('token-a3'), test.at(6, '20:00'));
  perform test.ok((select status from public.appointments where id = v_new) = 'confirmada',
    'reprogramar desde el panel conserva la confirmación (incluso fuera de horario publicado)');
  perform test.ok((select rescheduled_to from public.appointments where id = test.id('cita_a2')) = v_new, 'conserva el historial');
  insert into test.ids values ('cita_a3', v_new);
end $$;

-- ---------------------------------------------------------------------------
\echo '— Sesión realizada, cargo automático y pagos'
do $$
declare v_past uuid; c record; n int; s record;
begin
  perform test.as_user(test.id('lulu'));
  insert into public.appointments (patient_id, session_type_id, starts_at, status, source)
    values (test.id('ana'), test.id('st'), now() - interval '3 days', 'confirmada', 'panel') returning id into v_past;
  insert into test.ids values ('cita_pasada', v_past);
  update public.appointments set status = 'completada' where id = v_past;
  select * into c from public.charge_balances where appointment_id = v_past;
  perform test.ok(c.amount_cents = 80000 and c.payment_state = 'pendiente', 'completar genera el cargo de la sesión (pendiente)');
  insert into test.ids values ('cargo', c.id);

  insert into public.payments (patient_id, charge_id, amount_cents, paid_on, method, reference)
    values (test.id('ana'), c.id, 30000, current_date - 1, 'transferencia', 'SPEI FOLIO 4471');
  select * into c from public.charge_balances where id = test.id('cargo');
  perform test.ok(c.payment_state = 'parcial' and c.pending_cents = 50000, 'pago parcial: quedan $500.00');

  insert into public.payments (patient_id, charge_id, amount_cents, paid_on, method, status)
    values (test.id('ana'), test.id('cargo'), 50000, current_date, 'transferencia', 'por_confirmar');
  select * into c from public.charge_balances where id = test.id('cargo');
  perform test.ok(c.payment_state = 'parcial', 'un pago por confirmar no cuenta como pagado');
  select * into s from public.admin_finance_summary(current_date - 30, current_date);
  perform test.ok(s.income_cents = 30000 and s.unconfirmed_cents = 50000, 'ingresos solo con pagos confirmados');

  update public.payments set status = 'confirmado' where charge_id = test.id('cargo') and status = 'por_confirmar';
  select * into c from public.charge_balances where id = test.id('cargo');
  perform test.ok(c.payment_state = 'pagado' and c.pending_cents = 0, 'al confirmarlo queda pagado');
  perform test.ok((select balance_cents from public.patient_balances where patient_id = test.id('ana')) = 0, 'saldo del paciente en cero');

  perform test.throws(format($q$insert into public.payments (patient_id, amount_cents, paid_on, method, reference)
    values (%L, 1000, current_date, 'tarjeta_terminal', '4111 1111 1111 1111')$q$, test.id('ana')),
    '%payments_reference_check%', 'rechaza números de tarjeta en la referencia');
  perform test.throws(format($q$insert into public.payments (patient_id, amount_cents, paid_on, method)
    values (%L, 1000, current_date + 2, 'efectivo')$q$, test.id('ana')), '%fecha_pago_futura%', 'no registra pagos con fecha futura');
  perform test.throws($q$update public.payments set amount_cents = 1 where charge_id = test.id('cargo')$q$, '%pago_inmutable%', 'un pago no se reescribe');
  perform test.throws($q$delete from public.payments where charge_id = test.id('cargo')$q$, '%permission denied%', 'un pago no se borra');
  perform test.throws(format($q$insert into public.payments (patient_id, amount_cents, paid_on, method, status)
    values (%L, 1000, current_date, 'efectivo', 'anulado')$q$, test.id('ana')), '%estado_inicial_invalido%', 'no se crea un pago ya anulado');

  update public.payments set status = 'anulado', void_reason = 'Registro duplicado (prueba)'
    where charge_id = test.id('cargo') and amount_cents = 50000;
  select * into c from public.charge_balances where id = test.id('cargo');
  perform test.ok(c.payment_state = 'parcial', 'anular un pago recalcula el saldo');
  perform test.ok((select balance_cents from public.patient_balances where patient_id = test.id('ana')) = 50000, 'saldo pendiente $500.00');

  select count(*) into n from public.patient_overview where id = test.id('ana') and last_session_at is not null and next_appointment_at is not null;
  perform test.ok(n = 1, 'el expediente muestra última sesión y próxima cita');
end $$;

-- ---------------------------------------------------------------------------
\echo '— Registros clínicos e historial de cambios'
do $$
declare v_entry uuid; n int;
begin
  perform test.as_user(test.id('lulu'));
  insert into public.clinical_entries (patient_id, appointment_id, kind, title, body)
    values (test.id('ana'), test.id('cita_pasada'), 'nota_sesion', 'Nota ficticia', 'CONTENIDO-CLINICO-FICTICIO-1')
    returning id into v_entry;
  update public.clinical_entries set body = 'CONTENIDO-CLINICO-FICTICIO-2' where id = v_entry;
  perform test.ok((select version from public.clinical_entries where id = v_entry) = 2, 'editar sube la versión');
  perform test.ok((select body from public.clinical_entry_revisions where entry_id = v_entry and version = 1) = 'CONTENIDO-CLINICO-FICTICIO-1',
    'la versión anterior queda en el historial');
  perform test.throws(format('delete from public.clinical_entries where id = %L', v_entry), '%permission denied%', 'un registro clínico no se borra');
  perform test.throws(format($q$insert into public.clinical_entry_revisions (entry_id, version, kind, entry_date, body) values (%L, 9, 'nota_sesion', current_date, 'falso')$q$, v_entry),
    '%permission denied%', 'no se puede falsificar el historial');
  perform test.throws(format($q$insert into public.clinical_entries (patient_id, kind, body) values (%L, 'objetivo', 'x')$q$, test.id('ana')),
    '%check%', 'un objetivo requiere estado');

  update public.clinical_entries set voided_at = now(), void_reason = 'Capturado en expediente equivocado (prueba)' where id = v_entry;
  perform test.throws(format($q$update public.clinical_entries set body = 'cambio' where id = %L$q$, v_entry), '%registro_anulado%', 'un registro anulado ya no se edita');

  select count(*) into n from public.audit_log where entity = 'clinical_entries' and entity_id = v_entry;
  perform test.ok(n >= 3, 'la bitácora registra creación y ediciones');
  select count(*) into n from public.audit_log where (coalesce(changed_fields::text, '') || coalesce(context::text, '')) ilike '%CONTENIDO-CLINICO%';
  perform test.ok(n = 0, 'la bitácora NO copia contenido clínico');
  perform test.ok((select changed_fields from public.audit_log where entity = 'clinical_entries' and entity_id = v_entry and action = 'update' order by id limit 1) = array['body'],
    'la bitácora guarda solo el nombre del campo cambiado');
  perform public.log_access('view', 'patients', test.id('ana'));
  perform test.throws($q$update public.audit_log set action = 'view'$q$, '%permission denied%', 'la bitácora no se edita');
  perform test.throws($q$delete from public.audit_log$q$, '%permission denied%', 'la bitácora no se borra');
end $$;

do $$
begin
  -- Ni siquiera el dueño de la base puede borrarla sin activar el modo de depuración
  perform test.throws($q$delete from public.audit_log$q$, '%bitacora_inmutable%', 'bitácora protegida también para el operador');
end $$;

-- ---------------------------------------------------------------------------
\echo '— Documentos legales, plantillas y días no disponibles'
do $$
declare n int;
begin
  perform test.as_user(test.id('lulu'));
  perform test.throws($q$update public.legal_documents set body = body || ' cambio' where kind = 'aviso_privacidad'$q$,
    '%documento_legal_inmutable%', 'un aviso publicado no se modifica');
  perform public.admin_publish_legal_document('aviso_privacidad', 'Aviso de privacidad v2 (prueba)', repeat('Nueva versión ficticia del aviso. ', 4));
  perform test.ok((select version from public.legal_documents where kind = 'aviso_privacidad' and is_current) = 2, 'la nueva versión queda vigente');
  perform test.throws($q$update public.practice_settings set tpl_confirmed = 'Hola {nombre}, tu diagnóstico: {diagnostico}'$q$,
    '%templates_valid%', 'las plantillas no aceptan variables fuera de la lista');
  insert into public.time_off (starts_at, ends_at, reason) values (test.at(7, '00:00'), test.at(8, '00:00'), 'Congreso (prueba)');
end $$;

do $$
declare n int;
begin
  perform test.as_anon();
  perform test.err(public.request_booking(gen_random_uuid(), test.hash('old-aviso'), test.id('st'), test.at(9, '11:00'),
        'Carla Ficticia', 'carla@ejemplo.test', null, 'correo', test.id('aviso1'), true, false, test.hash('ip-4')), 'aviso_desactualizado', 'una solicitud con el aviso anterior se rechaza');
  select count(*) into n from public.get_available_slots(test.id('st'), test.day(7), test.day(7));
  perform test.ok(n = 0, 'un día bloqueado no ofrece horarios');
  perform test.ok(public.get_public_info()::text not ilike '%Congreso%', 'el motivo del bloqueo nunca se publica');
end $$;

-- ---------------------------------------------------------------------------
\echo '— Cancelación por el paciente y plazos'
do $$
declare v_soon uuid;
begin
  perform test.as_user(test.id('lulu'));
  insert into public.appointments (patient_id, session_type_id, starts_at, status, source, manage_token_hash)
    values (test.id('ana'), test.id('st'), now() + interval '5 hours', 'confirmada', 'panel', test.hash('token-pronto'));
end $$;

do $$
declare r jsonb;
begin
  perform test.as_anon();
  perform test.err(public.cancel_booking_by_token(test.hash('token-pronto'), test.hash('ip-5')), 'fuera_de_plazo', 'no cancela por enlace dentro del plazo mínimo');
  r := public.cancel_booking_by_token(test.hash('token-a3'), test.hash('ip-5'));
  perform test.ok(r ->> 'status' = 'cancelada', 'cancela con anticipación');
end $$;

do $$
declare n int;
begin
  perform test.as_user(test.id('lulu'));
  perform test.ok((select cancelled_by from public.appointments where id = test.id('cita_a3')) = 'paciente', 'registra quién canceló');
  select count(*) into n from public.notification_outbox where appointment_id = test.id('cita_a3') and kind = 'cita_cancelada';
  perform test.ok(n = 1, 'se encola el aviso de cancelación');
end $$;

-- ---------------------------------------------------------------------------
\echo '— Procesador de notificaciones (service_role)'
do $$
declare n int; r record; bad int;
begin
  perform test.as_service();
  select count(*), count(*) filter (where recipient is null) into n, bad from public.claim_notifications(50);
  perform test.ok(n >= 3, format('reclama %s mensajes pendientes', n));
  for r in select id from public.notification_outbox where status = 'enviando' loop
    perform public.complete_notification(r.id, 'enviado');
  end loop;
  select count(*) into n from public.notification_outbox where status = 'enviando';
  perform test.ok(n = 0, 'marca los mensajes como enviados');
  select count(*) into n from public.claim_notifications(50);
  perform test.ok(n = 0, 'no vuelve a enviar lo ya enviado');
end $$;

-- ---------------------------------------------------------------------------
\echo '— Verificación en dos pasos aplicada en la base de datos'
insert into auth.mfa_factors (user_id, status) select v, 'verified' from test.ids where k = 'lulu';
do $$
declare n int;
begin
  perform test.as_user_aal(test.id('lulu'), 'aal1');
  select count(*) into n from public.patients;
  perform test.ok(n = 0, 'con 2 pasos activos, una sesión solo con contraseña (aal1) no ve expedientes');
  perform test.throws($q$select public.admin_finance_summary(current_date, current_date)$q$, '%no_autorizado%', 'ni puede llamar funciones del panel');
end $$;
do $$
declare n int;
begin
  perform test.as_user_aal(test.id('lulu'), 'aal2');
  select count(*) into n from public.patients;
  perform test.ok(n > 0, 'tras verificar el segundo factor (aal2) ve sus expedientes');
end $$;
delete from auth.mfa_factors;

-- ---------------------------------------------------------------------------
\echo '— Depuración controlada de un expediente (ARCO / fin de conservación)'
do $$
declare v_p uuid; v_a uuid;
begin
  perform test.as_user(test.id('lulu'));
  insert into public.patients (full_name) values ('Persona a Depurar Ficticia') returning id into v_p;
  insert into public.appointments (patient_id, session_type_id, starts_at, status, source) values (v_p, test.id('st'), now() - interval '10 days', 'confirmada', 'panel') returning id into v_a;
  update public.appointments set status = 'completada' where id = v_a;
  insert into public.clinical_entries (patient_id, kind, body) values (v_p, 'nota_sesion', 'CONTENIDO-A-DEPURAR');
  update public.clinical_entries set body = 'CONTENIDO-A-DEPURAR-2' where patient_id = v_p;
  insert into public.payments (patient_id, amount_cents, paid_on, method) values (v_p, 1000, current_date, 'efectivo');
  insert into test.ids values ('depurar', v_p);
  perform test.throws(format($q$select private.purge_patient(%L, 'x', 'motivo suficiente')$q$, v_p), '%permission denied%', 'la app no puede ejecutar la depuración');
end $$;

do $$
declare r jsonb; v_code text; n int;
begin
  select internal_code into v_code from public.patients where id = test.id('depurar');
  perform test.throws(format($q$select private.purge_patient(%L, 'LS-0000', 'Solicitud ARCO de cancelación')$q$, test.id('depurar')), '%confirmacion_incorrecta%', 'exige confirmar con el identificador');
  perform test.throws(format($q$select private.purge_patient(%L, %L, 'Solicitud ARCO de cancelación')$q$, test.id('depurar'), v_code), '%archiva_primero%', 'exige archivar antes (bloqueo)');
  update public.patients set status = 'archivado' where id = test.id('depurar');
  perform test.throws(format($q$select private.purge_patient(%L, %L, 'Solicitud ARCO de cancelación')$q$, test.id('depurar'), v_code), '%en_plazo_de_conservacion%', 'respeta el plazo de conservación de 5 años');
  r := private.purge_patient(test.id('depurar'), v_code, 'Prueba automatizada: plazo cumplido (simulado)', true);
  perform test.ok(r ->> 'depurado' = v_code, 'depura el expediente cuando se cumplen las condiciones');
  select (select count(*) from public.patients where id = test.id('depurar')) + (select count(*) from public.clinical_entries where patient_id = test.id('depurar'))
       + (select count(*) from public.payments where patient_id = test.id('depurar')) + (select count(*) from public.clinical_entry_revisions where body like 'CONTENIDO-A-DEPURAR%') into n;
  perform test.ok(n = 0, 'no quedan datos del expediente depurado');
  perform test.ok(exists (select 1 from public.audit_log where entity = 'depuracion_expediente' and context ->> 'codigo' = v_code), 'queda constancia sin datos personales');
  perform test.throws($q$delete from public.clinical_entries$q$, '%operacion_no_permitida%', 'fuera de la depuración la protección sigue activa');
end $$;

\echo ''
\echo 'Todas las pruebas pasaron.'
