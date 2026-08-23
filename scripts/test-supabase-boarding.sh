#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
export PGHOST PGPORT PGUSER PGPASSWORD

psql -d postgres -v ON_ERROR_STOP=1 -q -c \
  'do $$ begin create role anon nologin; exception when duplicate_object then null; end $$; do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$; do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;'

for migration in supabase/migrations/*.sql; do
  psql -d postgres -v ON_ERROR_STOP=1 -q -f "$migration"
done

psql -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/boarding_confirmation_race.sql

preflight_db="boarding_confirmation_legacy_preflight"
dropdb --if-exists "$preflight_db"
createdb "$preflight_db"

target_migration="supabase/migrations/20260822074826_add_boarding_confirmation.sql"
for migration in supabase/migrations/*.sql; do
  if [[ "$migration" == "$target_migration" ]]; then
    break
  fi
  psql -d "$preflight_db" -v ON_ERROR_STOP=1 -q -f "$migration"
done

psql -d "$preflight_db" -v ON_ERROR_STOP=1 -q \
  -f supabase/tests/boarding_confirmation_legacy_preflight.sql

failure_log="$(mktemp)"
trap 'rm -f "$failure_log"' EXIT

if psql -d "$preflight_db" -v ON_ERROR_STOP=1 -q -f "$target_migration" \
  >"$failure_log" 2>&1; then
  echo "Expected the boarding migration to reject active legacy trips" >&2
  exit 1
fi

grep -q "active legacy trip_status rows must be drained or cancelled first" "$failure_log"
echo "Supabase boarding SQL tests passed."
