import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const verifierUrl = new URL("./verify-supabase-security.mjs", import.meta.url);

async function loadVerifier() {
  try {
    return await import(verifierUrl.href);
  } catch (error) {
    assert.fail(`Supabase security verifier should load: ${String(error)}`);
  }
}

test("reports public RPC definitions that drop invoker and search_path hardening", async () => {
  const { inspectMigrationSql } = await loadVerifier();
  const issues = inspectMigrationSql(`
    create or replace function public.example_rpc()
    returns void
    language plpgsql
    as $$
    begin
      null;
    end;
    $$;
  `);

  assert.deepEqual(issues, [
    "public.example_rpc: SECURITY INVOKER is required",
    "public.example_rpc: SET search_path = '' is required",
  ]);
});

test("accepts a public RPC definition that keeps both hardening properties", async () => {
  const { inspectMigrationSql } = await loadVerifier();
  const issues = inspectMigrationSql(`
    create or replace function public.example_rpc()
    returns void
    language plpgsql
    security invoker
    set search_path = ''
    as $$
    begin
      null;
    end;
    $$;
  `);

  assert.deepEqual(issues, []);
});

test("requires fail-closed default privileges for future Data API objects", async () => {
  const { inspectDefaultPrivilegePosture } = await loadVerifier();
  const issues = inspectDefaultPrivilegePosture([
    {
      name: "20260804112643_secure_data_api_access.sql",
      sql: "revoke select on table public.trips from anon;",
    },
  ]);

  assert.deepEqual(issues, [
    "missing default table privilege revocation for anon, authenticated, service_role",
    "missing default function EXECUTE revocation for anon, authenticated, service_role",
    "missing default sequence privilege revocation for anon, authenticated, service_role",
    "missing default function EXECUTE revocation for PUBLIC",
    "missing full privilege revocation on existing server-only tables for public, anon, authenticated",
    "missing service_role non-DML privilege revocation on existing server-only tables",
    "missing explicit CRUD grant for service_role on existing server-only tables",
  ]);
});

test("recognizes security statements that follow SQL comments", async () => {
  const { inspectDefaultPrivilegePosture } = await loadVerifier();
  const issues = inspectDefaultPrivilegePosture([
    {
      name: "20260804142432_restrict_future_data_api_access.sql",
      sql: `
        -- Default privileges are fail-closed.
        alter default privileges for role postgres in schema public
          revoke all privileges on tables from public, anon, authenticated, service_role;
        alter default privileges for role postgres in schema public
          revoke all privileges on functions from public, anon, authenticated, service_role;
        alter default privileges for role postgres in schema public
          revoke all privileges on sequences from public, anon, authenticated, service_role;

        -- Existing tables are server-only.
        revoke all privileges
          on table public.trips, public.trip_status, public.location_logs,
            public.bell_logs, public.bus_beacons
          from public, anon, authenticated;
        revoke all privileges
          on table public.trips, public.trip_status, public.location_logs,
            public.bell_logs, public.bus_beacons
          from service_role;
        grant select, insert, update, delete
          on table public.trips, public.trip_status, public.location_logs,
            public.bell_logs, public.bus_beacons
          to service_role;
      `,
    },
  ]);

  assert.deepEqual(issues, []);
});

test("reports later migrations that reopen server-only Data API access", async () => {
  const { inspectDefaultPrivilegePosture } = await loadVerifier();
  const issues = inspectDefaultPrivilegePosture([
    {
      name: "20260804142432_restrict_future_data_api_access.sql",
      sql: `
        alter default privileges for role postgres in schema public
          revoke all privileges on tables from public, anon, authenticated, service_role;
        alter default privileges for role postgres in schema public
          revoke all privileges on functions from public, anon, authenticated, service_role;
        alter default privileges for role postgres in schema public
          revoke all privileges on sequences from public, anon, authenticated, service_role;
        revoke all privileges
          on table public.trips, public.trip_status, public.location_logs,
            public.bell_logs, public.bus_beacons
          from public, anon, authenticated;
        revoke all privileges
          on table public.trips, public.trip_status, public.location_logs,
            public.bell_logs, public.bus_beacons
          from service_role;
        grant select, insert, update, delete
          on table public.trips, public.trip_status, public.location_logs,
            public.bell_logs, public.bus_beacons
          to service_role;
      `,
    },
    {
      name: "20260805_reopen_access.sql",
      sql: `
        alter default privileges for role postgres in schema public
          grant select on tables to anon;
        grant select on table public.trips to anon;
      `,
    },
  ]);

  assert.deepEqual(issues, [
    "missing default table privilege revocation for anon, authenticated, service_role",
    "missing full privilege revocation on existing server-only tables for public, anon, authenticated",
  ]);
});

test("reports missing service_role non-DML revocation on existing server-only tables", async () => {
  const { inspectDefaultPrivilegePosture } = await loadVerifier();
  const issues = inspectDefaultPrivilegePosture([
    {
      name: "20260804142432_restrict_future_data_api_access.sql",
      sql: `
        alter default privileges for role postgres in schema public
          revoke all privileges on tables from public, anon, authenticated, service_role;
        alter default privileges for role postgres in schema public
          revoke all privileges on functions from public, anon, authenticated, service_role;
        alter default privileges for role postgres in schema public
          revoke all privileges on sequences from public, anon, authenticated, service_role;
        revoke all privileges
          on table public.trips, public.trip_status, public.location_logs,
            public.bell_logs, public.bus_beacons
          from public, anon, authenticated;
        grant select, insert, update, delete
          on table public.trips, public.trip_status, public.location_logs,
            public.bell_logs, public.bus_beacons
          to service_role;
      `,
    },
  ]);

  assert.deepEqual(issues, [
    "missing service_role non-DML privilege revocation on existing server-only tables",
  ]);
});

test("the repository migration set satisfies the Supabase security contract", async () => {
  const { validateMigrationDirectory } = await loadVerifier();
  const migrationDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../supabase/migrations",
  );

  assert.deepEqual(await validateMigrationDirectory(migrationDirectory), []);
});
