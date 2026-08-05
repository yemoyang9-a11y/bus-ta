import assert from "node:assert/strict";
import test from "node:test";
import { getSupabaseConnectionStatus } from "./supabase.js";

test("returns NOT_CONFIGURED when Supabase environment variables are missing", async () => {
  const status = await getSupabaseConnectionStatus({}, async () => {
    throw new Error("fetch should not be called without Supabase config");
  });

  assert.deepEqual(status, {
    dbStatus: "NOT_CONFIGURED",
    message: "Supabase is not configured",
  });
});

test("returns UP when the Supabase REST endpoint responds successfully", async () => {
  const status = await getSupabaseConnectionStatus(
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    async () =>
      new Response(null, {
        status: 200,
      }),
  );

  assert.deepEqual(status, {
    dbStatus: "UP",
    message: "Supabase connection is healthy",
  });
});

test("returns NOT_CONFIGURED and does not call Supabase when only the anon key is available", async () => {
  const status = await getSupabaseConnectionStatus(
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
    },
    async () => {
      throw new Error("fetch should not be called with only the anon key");
    },
  );

  assert.deepEqual(status, {
    dbStatus: "NOT_CONFIGURED",
    message: "Supabase is not configured",
  });
});

test("returns DOWN when the Supabase REST endpoint cannot be reached with the service-role key", async () => {
  const status = await getSupabaseConnectionStatus(
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    async () =>
      new Response(null, {
        status: 503,
      }),
  );

  assert.deepEqual(status, {
    dbStatus: "DOWN",
    message: "Supabase connection failed",
  });
});
