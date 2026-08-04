import assert from "node:assert/strict";
import test from "node:test";
import { HealthResponseSchema } from "@bus-ta/shared";
import { buildHealthResponse } from "./health.js";

function assertSharedHealthResponse(body: unknown) {
  assert.deepEqual(HealthResponseSchema.parse(body), body);
}

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
  assertSharedHealthResponse(response.body);
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
  assertSharedHealthResponse(response.body);
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
  assertSharedHealthResponse(response.body);
});

test("accepts the three valid health response combinations", () => {
  const validResponses = [
    {
      success: true,
      serverStatus: "UP",
      dbStatus: "UP",
      message: "Server is running",
      timestamp: "2026-07-01T14:30:00+09:00",
    },
    {
      success: true,
      serverStatus: "UP",
      dbStatus: "NOT_CONFIGURED",
      message: "Server is running",
      timestamp: "2026-07-01T14:30:00+09:00",
    },
    {
      success: false,
      serverStatus: "UP",
      dbStatus: "DOWN",
      errorCode: "DB_ERROR",
      message: "Supabase connection failed",
      timestamp: "2026-07-01T14:30:00+09:00",
    },
  ];

  for (const response of validResponses) {
    assert.deepEqual(HealthResponseSchema.parse(response), response);
  }
});

test("rejects contradictory health status and error combinations", () => {
  assert.throws(() =>
    HealthResponseSchema.parse({
      success: true,
      serverStatus: "UP",
      dbStatus: "DOWN",
      message: "Server is running",
      timestamp: "2026-07-01T14:30:00+09:00",
    }),
  );
  assert.throws(() =>
    HealthResponseSchema.parse({
      success: true,
      serverStatus: "UP",
      dbStatus: "UP",
      errorCode: "DB_ERROR",
      message: "Server is running",
      timestamp: "2026-07-01T14:30:00+09:00",
    }),
  );
  assert.throws(() =>
    HealthResponseSchema.parse({
      success: false,
      serverStatus: "UP",
      dbStatus: "UP",
      errorCode: "DB_ERROR",
      message: "Supabase connection failed",
      timestamp: "2026-07-01T14:30:00+09:00",
    }),
  );
  assert.throws(() =>
    HealthResponseSchema.parse({
      success: false,
      serverStatus: "UP",
      dbStatus: "DOWN",
      message: "Supabase connection failed",
      timestamp: "2026-07-01T14:30:00+09:00",
    }),
  );
});

test("rejects invalid health timestamps", () => {
  assert.throws(() =>
    HealthResponseSchema.parse({
      success: true,
      serverStatus: "UP",
      dbStatus: "UP",
      message: "Server is running",
      timestamp: "not-an-iso-timestamp",
    }),
  );
  assert.throws(() =>
    HealthResponseSchema.parse({
      success: false,
      serverStatus: "UP",
      dbStatus: "DOWN",
      errorCode: "DB_ERROR",
      message: "Supabase connection failed",
      timestamp: "2026/07/01 14:30:00",
    }),
  );
});
