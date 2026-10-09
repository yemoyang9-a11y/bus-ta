import assert from "node:assert/strict";
import test from "node:test";
import * as shared from "../packages/shared/src/index.js";
import { HANEUM_REALTIME_MODEL as mobileModel } from "../apps/mobile/src/realtime/guide.js";
import { HANEUM_REALTIME_MODEL as serverModel, REALTIME_CLIENT_SECRET_TTL_SECONDS } from "../apps/server/src/services/realtime/config.js";
import { apiClient } from "../apps/mobile/src/api/client.js";

test("Realtime consumers retain the shared model and TTL contract", () => {
  assert.equal(shared.HANEUM_REALTIME_MODEL, "gpt-realtime-mini");
  assert.equal(mobileModel, shared.HANEUM_REALTIME_MODEL);
  assert.equal(serverModel, shared.HANEUM_REALTIME_MODEL);
  assert.equal(REALTIME_CLIENT_SECRET_TTL_SECONDS, 600);
});

test("mobile sends the shared authentication header and omits it without a secret", async (t) => {
  assert.equal(shared.REALTIME_SHARED_SECRET_HEADER, "x-realtime-shared-secret");
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls.push(init);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });
  await apiClient.realtime.createSession("test-only-secret");
  await apiClient.realtime.createSession();
  assert.equal(new Headers(calls[0]?.headers).get(shared.REALTIME_SHARED_SECRET_HEADER), "test-only-secret");
  assert.equal(new Headers(calls[1]?.headers).get(shared.REALTIME_SHARED_SECRET_HEADER), null);
});
