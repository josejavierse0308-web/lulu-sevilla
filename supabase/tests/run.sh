#!/usr/bin/env bash
# Recrea una base de pruebas, aplica el shim de Supabase, las migraciones y las pruebas.
set -euo pipefail
PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-54322} -U postgres -v ON_ERROR_STOP=1 -q"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
$PSQL -d postgres -c "drop database if exists lulu_test" -c "create database lulu_test"
$PSQL -d lulu_test -f "$DIR/tests/00_supabase_shim.sql"
for f in "$DIR"/migrations/*.sql; do
  echo "→ $(basename "$f")"
  $PSQL -d lulu_test -f "$f"
done
for f in "$DIR"/tests/[1-9]*.sql; do
  [ -e "$f" ] || continue
  echo "▶ $(basename "$f")"
  $PSQL -d lulu_test -f "$f"
done
echo "OK"
