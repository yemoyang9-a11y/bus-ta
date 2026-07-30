import assert from "node:assert/strict";
import test from "node:test";
import { buildHealthResponse } from "./health.js";

test("builds a successful health response when Supabase is configured and reachable", () => {
  const response = buildHealthResponse(
    {
      dbStatus: "UP",
      message: "Supabase connection is healthy",
    },
    "2026-07-01T14:30:00+09:00",
  );

  assert.equal(response.httpStatus, 200);
  assert.deepEqual(response.body, {
    success: true,
    serverStatus: "UP",
    dbStatus: "UP",
    message: "Server is running",
    timestamp: "2026-07-01T14:30:00+09:00",
  });
});

test("keeps health successful when Supabase is not configured for local development", () => {
  const response = buildHealthResponse(
    {
      dbStatus: "NOT_CONFIGURED",
      message: "Supabase is not configured",
    },
    "2026-07-01T14:30:00+09:00",
  );

  assert.equal(response.httpStatus, 200);
  assert.deepEqual(response.body, {
    success: true,
    serverStatus: "UP",
    dbStatus: "NOT_CONFIGURED",
    message: "Server is running",
    timestamp: "2026-07-01T14:30:00+09:00",
  });
});

test("returns a failed health response when Supabase is configured but unreachable", () => {
  const response = buildHealthResponse(
    {
      dbStatus: "DOWN",
      message: "Supabase connection failed",
    },
    "2026-07-01T14:30:00+09:00",
  );

  assert.equal(response.httpStatus, 500);
  assert.deepEqual(response.body, {
    success: false,
    serverStatus: "UP",
    dbStatus: "DOWN",
    errorCode: "DB_ERROR",
    message: "Supabase connection failed",
    timestamp: "2026-07-01T14:30:00+09:00",
  });
});
