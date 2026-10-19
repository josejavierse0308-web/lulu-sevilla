#!/usr/bin/env bash
# 20 conexiones simultáneas intentan reservar exactamente el mismo horario.
# Debe ganar una sola. Ejecutar después de run.sh (usa la base lulu_test).
set -euo pipefail
PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-54322} -U postgres -d lulu_test -qtA"
ST=$($PSQL -c "select id from public.session_types where is_public limit 1")
DOC=$($PSQL -c "select id from public.legal_documents where kind='aviso_privacidad' and is_current")
SLOT=$($PSQL -c "set role anon; select s from public.get_available_slots('$ST', (now() at time zone 'America/Mexico_City')::date + 20, (now() at time zone 'America/Mexico_City')::date + 20) s limit 1")
echo "Horario disputado: $SLOT"
rm -f /tmp/race_*.out
for i in $(seq 1 20); do
  ( $PSQL -c "set role anon; select public.request_booking(gen_random_uuid(), encode(sha256('race-$i'::bytea),'hex'), '$ST', '$SLOT',
      'Persona $i', 'persona$i@ejemplo.test', null, 'correo', '$DOC', true, false, encode(sha256('race-ip-$i'::bytea),'hex'))" > /tmp/race_$i.out 2>&1 ) &
done
wait
OKS=$(grep -l '"status": "pendiente"' /tmp/race_*.out | wc -l)
TAKEN=$(grep -l 'horario_no_disponible' /tmp/race_*.out | wc -l)
DB=$($PSQL -c "select count(*) from public.appointments where starts_at = '$SLOT' and status in ('pendiente','confirmada')")
echo "Aceptadas: $OKS · Rechazadas por ocupado: $TAKEN · Citas en la base: $DB"
[ "$OKS" = "1" ] && [ "$DB" = "1" ] && [ "$TAKEN" = "19" ] && echo "✓ sin reservas duplicadas bajo concurrencia" || { echo "✗ FALLÓ"; cat /tmp/race_*.out | sort | uniq -c; exit 1; }
