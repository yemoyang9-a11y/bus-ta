import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { realtimeRouter } from "./realtime.js";

type JsonObject = Record<string, unknown>;
type RequestHeaders = Record<string, string>;

const REALTIME_SESSION_PATH = "/api/realtime/session";

async function postRealtimeSession(headers?: RequestHeaders, path: string = REALTIME_SESSION_PATH) {
  const app = express();
  app.use(express.json());
  app.use("/api/realtime", realtimeRouter);

  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  try {
    const address = server.address();
    assert(address && typeof address === "object");

    return await requestJson({
      port: address.port,
      path,
      ...(headers ? { headers } : {}),
    });
  } finally {
    await closeServer(server);
  }
}

function requestJson({ port, path, headers }: { port: number; path: string; headers?: RequestHeaders }) {
  return new Promise<{ status: number; body: JsonObject }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers,
      },
      (res) => {
        let body = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(body) as JsonObject,
          });
        });
      },
    );

    req.on("error", reject);
    req.end();
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

// openAiApiKey 에 null 을 넘기면 OPENAI_API_KEY 를 지운다.
// (undefined 를 쓰면 기본값이 적용되어 값이 지워지지 않는다.)
function setRealtimeEnv(sharedSecret: string | undefined, openAiApiKey: string | null = "sk-test") {
  const previousSharedSecret = process.env["REALTIME_SHARED_SECRET"];
  const previousOpenAiApiKey = process.env["OPENAI_API_KEY"];

  if (sharedSecret === undefined) {
    delete process.env["REALTIME_SHARED_SECRET"];
  } else {
    process.env["REALTIME_SHARED_SECRET"] = sharedSecret;
  }

  if (openAiApiKey === null) {
    delete process.env["OPENAI_API_KEY"];
  } else {
    process.env["OPENAI_API_KEY"] = openAiApiKey;
  }

  return () => {
    if (previousSharedSecret === undefined) {
      delete process.env["REALTIME_SHARED_SECRET"];
    } else {
      process.env["REALTIME_SHARED_SECRET"] = previousSharedSecret;
    }

    if (previousOpenAiApiKey === undefined) {
      delete process.env["OPENAI_API_KEY"];
    } else {
      process.env["OPENAI_API_KEY"] = previousOpenAiApiKey;
    }
  };
}

// 테스트가 실제 OpenAI 를 호출하지 않도록 전역 fetch 를 항상 교체한다.
function stubGlobalFetch(handler: () => Promise<Response>) {
  const originalFetch = globalThis.fetch;
  const state = { calls: 0 };

  globalThis.fetch = (async () => {
    state.calls += 1;
    return handler();
  }) as typeof globalThis.fetch;

  return {
    state,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function upstreamMustNotBeCalled() {
  return stubGlobalFetch(async () => {
    throw new Error("must not call upstream");
  });
}

test("rejects realtime session when the shared-secret header is missing", async (t) => {
  const upstream = upstreamMustNotBeCalled();
  t.after(setRealtimeEnv("server-secret"));
  t.after(upstream.restore);

  const response = await postRealtimeSession();

  assert.equal(response.status, 401);
  assert.equal(response.body["success"], false);
  assert.equal(response.body["errorCode"], "UNAUTHORIZED");
  assert.equal(upstream.state.calls, 0);
});

test("rejects realtime session when REALTIME_SHARED_SECRET is missing", async (t) => {
  const upstream = upstreamMustNotBeCalled();
  t.after(setRealtimeEnv(undefined));
  t.after(upstream.restore);

  const response = await postRealtimeSession();

  assert.equal(response.status, 401);
  assert.equal(response.body["success"], false);
  assert.equal(response.body["errorCode"], "UNAUTHORIZED");
  assert.equal(upstream.state.calls, 0);
});

test("rejects realtime session when shared secret does not match", async (t) => {
  const upstream = upstreamMustNotBeCalled();
  t.after(setRealtimeEnv("server-secret"));
  t.after(upstream.restore);

  const response = await postRealtimeSession({
    "x-realtime-shared-secret": "wrong-secret",
  });

  assert.equal(response.status, 401);
  assert.equal(response.body["success"], false);
  assert.equal(response.body["errorCode"], "UNAUTHORIZED");
  assert.equal(upstream.state.calls, 0);
});

test("fails realtime session with 502 when OPENAI_API_KEY is missing", async (t) => {
  const upstream = upstreamMustNotBeCalled();
  t.after(setRealtimeEnv("server-secret", null));
  t.after(upstream.restore);

  const response = await postRealtimeSession({
    "x-realtime-shared-secret": "server-secret",
  });

  assert.equal(response.status, 502);
  assert.equal(response.body["success"], false);
  assert.equal(response.body["errorCode"], "REALTIME_SESSION_FAILED");
  assert.equal(upstream.state.calls, 0);
});

test("fails realtime session with 502 when OpenAI responds with a non-2xx status", async (t) => {
  const upstream = stubGlobalFetch(async () => new Response("upstream failed", { status: 500 }));
  t.after(setRealtimeEnv("server-secret"));
  t.after(upstream.restore);

  const response = await postRealtimeSession({
    "x-realtime-shared-secret": "server-secret",
  });

  assert.equal(response.status, 502);
  assert.equal(response.body["success"], false);
  assert.equal(response.body["errorCode"], "REALTIME_SESSION_FAILED");
  assert.equal(upstream.state.calls, 1);
});

test("fails realtime session with 502 when the OpenAI request rejects", async (t) => {
  const upstream = stubGlobalFetch(async () => {
    throw new Error("network down");
  });
  t.after(setRealtimeEnv("server-secret"));
  t.after(upstream.restore);

  const response = await postRealtimeSession({
    "x-realtime-shared-secret": "server-secret",
  });

  assert.equal(response.status, 502);
  assert.equal(response.body["success"], false);
  assert.equal(response.body["errorCode"], "REALTIME_SESSION_FAILED");
  assert.equal(upstream.state.calls, 1);
});

test("fails realtime session with 502 when the OpenAI response has no client secret", async (t) => {
  const upstream = stubGlobalFetch(
    async () =>
      new Response(JSON.stringify({ client_secret: { expires_at: 1785413100 } }), { status: 200 }),
  );
  t.after(setRealtimeEnv("server-secret"));
  t.after(upstream.restore);

  const response = await postRealtimeSession({
    "x-realtime-shared-secret": "server-secret",
  });

  assert.equal(response.status, 502);
  assert.equal(response.body["success"], false);
  assert.equal(response.body["errorCode"], "REALTIME_SESSION_FAILED");
  assert.equal(upstream.state.calls, 1);
});

test("returns realtime session when shared secret matches", async (t) => {
  const expiresAtIso = "2026-07-30T12:05:00.000Z";
  const upstream = stubGlobalFetch(
    async () =>
      new Response(
        JSON.stringify({
          client_secret: {
            value: "ek_test",
            expires_at: Math.floor(Date.parse(expiresAtIso) / 1000),
          },
        }),
        { status: 200 },
      ),
  );
  t.after(setRealtimeEnv("server-secret"));
  t.after(upstream.restore);

  const response = await postRealtimeSession({
    "x-realtime-shared-secret": "server-secret",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body["success"], true);
  assert.equal(response.body["clientSecret"], "ek_test");
  assert.equal(response.body["model"], "gpt-realtime-mini");
  // epoch 초 expires_at 이 ISO 문자열 expiresAt 으로 변환된다.
  assert.equal(response.body["expiresAt"], expiresAtIso);
});

test("serves the realtime session contract at POST /api/realtime/session", async (t) => {
  const upstream = stubGlobalFetch(
    async () =>
      new Response(
        JSON.stringify({ client_secret: { value: "ek_test", expires_at: 1785413100 } }),
        { status: 200 },
      ),
  );
  t.after(setRealtimeEnv("server-secret"));
  t.after(upstream.restore);

  assert.equal(REALTIME_SESSION_PATH, "/api/realtime/session");

  const response = await postRealtimeSession(
    { "x-realtime-shared-secret": "server-secret" },
    "/api/realtime/session",
  );

  assert.equal(response.status, 200);
  assert.equal(response.body["success"], true);
});
