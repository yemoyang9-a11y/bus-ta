import assert from "node:assert/strict";
import test from "node:test";
import { createRealtimeClientSecret } from "./create-realtime-session.service.js";

const now = () => "2026-07-30T12:00:00.000Z";

test("returns REALTIME_SESSION_FAILED when OpenAI API key is missing", async () => {
  const result = await createRealtimeClientSecret({
    apiKey: "",
    model: "gpt-realtime-mini",
    now,
  });

  assert.equal(result.httpStatus, 502);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "REALTIME_SESSION_FAILED",
    message: "Realtime 세션 키 발급에 실패했습니다.",
    timestamp: "2026-07-30T12:00:00.000Z",
  });
});

test("returns a client secret from OpenAI response", async () => {
  const result = await createRealtimeClientSecret({
    apiKey: "sk-test",
    model: "gpt-realtime-mini",
    now,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          client_secret: {
            value: "ek_test",
            expires_at: 1785413100,
          },
        }),
        { status: 200 },
      ),
  });

  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body, {
    success: true,
    clientSecret: "ek_test",
    model: "gpt-realtime-mini",
    expiresAt: "2026-07-30T12:05:00.000Z",
    message: "Realtime 세션 키를 발급했습니다.",
    timestamp: "2026-07-30T12:00:00.000Z",
  });
});

test("returns REALTIME_SESSION_FAILED when OpenAI request fails", async () => {
  const result = await createRealtimeClientSecret({
    apiKey: "sk-test",
    model: "gpt-realtime-mini",
    now,
    fetchImpl: async () => new Response("{}", { status: 502 }),
  });

  assert.equal(result.httpStatus, 502);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "REALTIME_SESSION_FAILED",
    message: "Realtime 세션 키 발급에 실패했습니다.",
    timestamp: "2026-07-30T12:00:00.000Z",
  });
});
