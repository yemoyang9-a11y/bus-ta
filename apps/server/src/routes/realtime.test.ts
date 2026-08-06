import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { realtimeRouter } from "./realtime.js";

type JsonObject = Record<string, unknown>;
type RequestHeaders = Record<string, string>;

async function postRealtimeSession(headers?: RequestHeaders) {
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
      path: "/api/realtime/session",
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

function setRealtimeEnv(sharedSecret: string | undefined) {
  const previousSharedSecret = process.env["REALTIME_SHARED_SECRET"];
  const previousOpenAiApiKey = process.env["OPENAI_API_KEY"];

  if (sharedSecret === undefined) {
    delete process.env["REALTIME_SHARED_SECRET"];
  } else {
    process.env["REALTIME_SHARED_SECRET"] = sharedSecret;
  }
  process.env["OPENAI_API_KEY"] = "sk-test";

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

test("rejects realtime session when REALTIME_SHARED_SECRET is missing", async (t) => {
  t.after(setRealtimeEnv(undefined));

  const response = await postRealtimeSession();

  assert.equal(response.status, 500);
  assert.equal(response.body["success"], false);
  assert.equal(response.body["errorCode"], "SERVER_CONFIG_ERROR");
});

test("rejects realtime session when shared secret does not match", async (t) => {
  t.after(setRealtimeEnv("server-secret"));

  const response = await postRealtimeSession({
    "x-realtime-shared-secret": "wrong-secret",
  });

  assert.equal(response.status, 401);
  assert.equal(response.body["success"], false);
  assert.equal(response.body["errorCode"], "UNAUTHORIZED");
});

test("returns realtime session when shared secret matches", async (t) => {
  const restoreEnv = setRealtimeEnv("server-secret");
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        client_secret: {
          value: "ek_test",
          expires_at: 1785413100,
        },
      }),
      { status: 200 },
    );

  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv();
  });

  const response = await postRealtimeSession({
    "x-realtime-shared-secret": "server-secret",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body["success"], true);
  assert.equal(response.body["clientSecret"], "ek_test");
  assert.equal(response.body["model"], "gpt-realtime-mini");
});
