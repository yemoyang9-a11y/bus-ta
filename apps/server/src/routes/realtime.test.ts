import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import { API_PATHS, RealtimeSessionResponseSchema } from "@bus-ta/shared";
import {
  createRealtimeSessionService,
  type RealtimeSessionServiceResult,
} from "../services/realtime/realtime-session.service.js";
import {
  REALTIME_CLIENT_SECRETS_URL,
  createRealtimeClientSecretAdapter,
} from "../adapters/realtime/openai-realtime.adapter.js";
import { createRealtimeRouter } from "./realtime.js";

const sharedSecret = "test-shared-secret";
const openAiApiKey = "sk-test-key";
const timestamp = "2026-08-04T12:00:00.000Z";

async function listen(app: express.Express) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

function assertError(
  result: RealtimeSessionServiceResult,
  httpStatus: 401 | 502,
  errorCode: "UNAUTHORIZED" | "REALTIME_SESSION_FAILED",
) {
  assert.equal(result.httpStatus, httpStatus);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, errorCode);
  assert.equal(result.body.timestamp, timestamp);
  assert.equal(typeof result.body.message, "string");
  assert.equal("clientSecret" in result.body, false);
}

test("exposes the exact Realtime session API path and response contract", () => {
  assert.equal(API_PATHS.realtime.session, "/api/realtime/session");

  const parsed = RealtimeSessionResponseSchema.parse({
    success: true,
    clientSecret: "ek_test_secret",
    model: "gpt-realtime-mini",
    expiresAt: "2026-08-04T12:10:00.000Z",
    message: "Realtime 세션 단기 키를 발급했습니다.",
    timestamp,
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.model, "gpt-realtime-mini");
});

test("rejects a missing shared-secret header before contacting OpenAI", async () => {
  let calls = 0;
  const result = await createRealtimeSessionService(
    { configuredSharedSecret: sharedSecret },
    {
      now: () => timestamp,
      fetch: async () => {
        calls += 1;
        throw new Error("must not call upstream");
      },
    },
  );

  assertError(result, 401, "UNAUTHORIZED");
  assert.equal(calls, 0);
});

test("rejects a mismatched shared-secret header before contacting OpenAI", async () => {
  let calls = 0;
  const result = await createRealtimeSessionService(
    {
      providedSharedSecret: "wrong-secret",
      configuredSharedSecret: sharedSecret,
    },
    {
      now: () => timestamp,
      fetch: async () => {
        calls += 1;
        throw new Error("must not call upstream");
      },
    },
  );

  assertError(result, 401, "UNAUTHORIZED");
  assert.equal(calls, 0);
});

test("rejects when the server shared secret is not configured", async () => {
  let calls = 0;
  const result = await createRealtimeSessionService(
    { providedSharedSecret: sharedSecret },
    {
      now: () => timestamp,
      fetch: async () => {
        calls += 1;
        throw new Error("must not call upstream");
      },
    },
  );

  assertError(result, 401, "UNAUTHORIZED");
  assert.equal(calls, 0);
});

test("issues a client secret with the exact OpenAI request and converts expiry epoch seconds", async () => {
  const expiresAtEpochSeconds = Math.floor(Date.parse("2026-08-04T12:10:00.000Z") / 1000);
  let request: { url: string; init: RequestInit } | undefined;

  const result = await createRealtimeSessionService(
    {
      providedSharedSecret: sharedSecret,
      configuredSharedSecret: sharedSecret,
      openAiApiKey,
    },
    {
      now: () => timestamp,
      fetch: async (url, init) => {
        request = { url: String(url), init: init ?? {} };
        return new Response(
          JSON.stringify({ value: "ek_test_secret", expires_at: expiresAtEpochSeconds }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.deepEqual(result.body, {
    success: true,
    clientSecret: "ek_test_secret",
    model: "gpt-realtime-mini",
    expiresAt: "2026-08-04T12:10:00.000Z",
    message: "Realtime 세션 단기 키를 발급했습니다.",
    timestamp,
  });
  assert.ok(request);
  assert.equal(request.url, REALTIME_CLIENT_SECRETS_URL);
  assert.equal(request.init.method, "POST");
  assert.deepEqual(request.init.headers, {
    Authorization: `Bearer ${openAiApiKey}`,
    "Content-Type": "application/json",
  });
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    session: { type: "realtime", model: "gpt-realtime-mini" },
    expires_after: { anchor: "created_at", seconds: 600 },
  });
  assert.equal(String(request.init.body).includes("instructions"), false);
  assert.equal(String(request.init.body).includes("tools"), false);

  assert.deepEqual(RealtimeSessionResponseSchema.parse(result.body), result.body);
});

test("rejects authentication even when the OpenAI key is missing", async () => {
  const result = await createRealtimeSessionService(
    { providedSharedSecret: sharedSecret, configuredSharedSecret: sharedSecret },
    { now: () => timestamp },
  );

  assertError(result, 502, "REALTIME_SESSION_FAILED");
});

test("returns a failed response when OPENAI_API_KEY is not configured", async () => {
  const result = await createRealtimeSessionService(
    {
      providedSharedSecret: sharedSecret,
      configuredSharedSecret: sharedSecret,
    },
    { now: () => timestamp },
  );

  assertError(result, 502, "REALTIME_SESSION_FAILED");
});

test("maps a non-2xx OpenAI response to REALTIME_SESSION_FAILED", async () => {
  const result = await createRealtimeSessionService(
    {
      providedSharedSecret: sharedSecret,
      configuredSharedSecret: sharedSecret,
      openAiApiKey,
    },
    {
      now: () => timestamp,
      fetch: async () => new Response("upstream failed", { status: 500 }),
    },
  );

  assertError(result, 502, "REALTIME_SESSION_FAILED");
});

test("maps an OpenAI network rejection to REALTIME_SESSION_FAILED", async () => {
  const result = await createRealtimeSessionService(
    {
      providedSharedSecret: sharedSecret,
      configuredSharedSecret: sharedSecret,
      openAiApiKey,
    },
    {
      now: () => timestamp,
      fetch: async () => {
        throw new Error("network down");
      },
    },
  );

  assertError(result, 502, "REALTIME_SESSION_FAILED");
});

test("maps a missing or malformed upstream secret and expiry to REALTIME_SESSION_FAILED", async () => {
  for (const payload of [
    { expires_at: 1_000 },
    { value: "ek_test_secret" },
    { value: "", expires_at: 1_000 },
    { value: "ek_test_secret", expires_at: "1000" },
    { value: "ek_test_secret", expires_at: 0 },
    { value: "ek_test_secret", expires_at: Number.NaN },
  ]) {
    const result = await createRealtimeSessionService(
      {
        providedSharedSecret: sharedSecret,
        configuredSharedSecret: sharedSecret,
        openAiApiKey,
      },
      {
        now: () => timestamp,
        fetch: async () => new Response(JSON.stringify(payload), { status: 200 }),
      },
    );

    assertError(result, 502, "REALTIME_SESSION_FAILED");
  }
});

test("adapter forwards only the contract fields to OpenAI", async () => {
  let request: { url: string; init: RequestInit } | undefined;
  const adapter = createRealtimeClientSecretAdapter(async (url, init) => {
    request = { url: String(url), init: init ?? {} };
    return new Response(JSON.stringify({ value: "ek_test_secret", expires_at: 1_800_000_000 }), {
      status: 200,
    });
  });

  await adapter.createClientSecret(openAiApiKey);

  assert.ok(request);
  assert.equal(request.url, REALTIME_CLIENT_SECRETS_URL);
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    session: { type: "realtime", model: "gpt-realtime-mini" },
    expires_after: { anchor: "created_at", seconds: 600 },
  });
});

test("mounts POST /api/realtime/session and ignores the request body", async () => {
  let openAiCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(
    API_PATHS.realtime.session,
    createRealtimeRouter({
      getConfig: () => ({
        configuredSharedSecret: sharedSecret,
        openAiApiKey,
      }),
      now: () => timestamp,
      fetch: async () => {
        openAiCalls += 1;
        return new Response(
          JSON.stringify({ value: "ek_test_secret", expires_at: 1_800_000_000 }),
          { status: 200 },
        );
      },
    }),
  );

  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}${API_PATHS.realtime.session}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-shared-secret": sharedSecret,
      },
      body: JSON.stringify({ instructions: "ignored", tools: ["ignored"] }),
    });
    const body: unknown = await response.json();

    assert.equal(response.status, 200);
    assert.equal(openAiCalls, 1);
    assert.deepEqual(body, {
      success: true,
      clientSecret: "ek_test_secret",
      model: "gpt-realtime-mini",
      expiresAt: "2027-01-15T08:00:00.000Z",
      message: "Realtime 세션 단기 키를 발급했습니다.",
      timestamp,
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
