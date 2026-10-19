#!/usr/bin/env bash
# Respaldo cifrado de la base de datos de Supabase.
# Uso:  DATABASE_URL='postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres' bash scripts/respaldo.sh
# Requiere pg_dump (PostgreSQL 16+) y gpg. El archivo sin cifrar nunca se escribe en disco.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Define DATABASE_URL con la cadena de conexión de Supabase (Project Settings → Database)." >&2
  exit 1
fi
command -v pg_dump >/dev/null || { echo "Falta pg_dump (instala PostgreSQL 16)." >&2; exit 1; }
command -v gpg >/dev/null || { echo "Falta gpg." >&2; exit 1; }

mkdir -p respaldos
chmod 700 respaldos
OUT="respaldos/lulu-$(date +%Y%m%d-%H%M).dump.gpg"

echo "Se pedirá una frase para cifrar el respaldo. Guárdala en un lugar distinto al archivo."
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges \
  --schema=public --schema=private --schema=auth \
  | gpg --symmetric --cipher-algo AES256 --output "$OUT"

chmod 600 "$OUT"
echo "Respaldo cifrado: $OUT"
echo "Recuerda respaldar también los documentos del bucket 'expedientes' (ver docs/OPERACION.md)."
