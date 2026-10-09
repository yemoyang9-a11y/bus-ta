import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseTripRepository } from "../../repositories/supabase/trip.repository.js";
import { recordBellResult } from "./bell-result.service.js";

const body = {
  bellRequestId: "bell-atomic-test",
  command: "STOP_REQUEST",
  result: "FAIL",
  isMock: false,
  timestamp: "2026-09-22T09:00:00.000Z",
};

test("returns the atomic winner and terminal trip status without a stale pre-read", async () => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const repository = new SupabaseTripRepository(
    { url: "https://supabase.example", apiKey: "test-service-key" },
    async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({
        outcome: "ALREADY_RECORDED", tripId: "trip-atomic-test",
        bellRequestId: "bell-atomic-test", bellStatus: "SUCCESS", tripStatus: "CANCELLED",
      });
    },
  );
  const result = await recordBellResult("trip-atomic-test", body, {
    saveBellResult: (data) => repository.saveBellResult(data),
    now: () => "2026-09-22T09:00:01.000Z",
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.success && result.body.bellStatus, "SUCCESS");
  assert.equal(result.body.success && result.body.tripStatus, "CANCELLED");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://supabase.example/rest/v1/rpc/record_bell_result");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    p_trip_id: "trip-atomic-test", p_bell_request_id: "bell-atomic-test", p_result: "FAIL",
    p_message: null, p_is_mock: false, p_completed_at: "2026-09-22T09:00:01.000Z",
  });
});

for (const [outcome, expectedStatus] of [["BELL_REQUEST_NOT_FOUND", 404], ["INVALID_BELL_STATE", 409]] as const) {
  test(`preserves public ${expectedStatus} for RPC ${outcome}`, async () => {
    const repository = new SupabaseTripRepository(
      { url: "https://supabase.example", apiKey: "test-service-key" },
      async () => Response.json({ outcome }),
    );
    const result = await recordBellResult("trip-atomic-test", body, repository);
    assert.equal(result.httpStatus, expectedStatus);
    assert.equal(!result.body.success && result.body.errorCode, outcome);
  });
}

test("a failed RPC returns DB_ERROR without attempting a fallback PATCH", async () => {
  let calls = 0;
  const repository = new SupabaseTripRepository(
    { url: "https://supabase.example", apiKey: "test-service-key" },
    async () => { calls++; return new Response("internal database failure", { status: 500 }); },
  );
  const result = await recordBellResult("trip-atomic-test", body, repository);
  assert.equal(result.httpStatus, 500);
  assert.equal(!result.body.success && result.body.errorCode, "DB_ERROR");
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result.body), /internal database failure/);
});

for (const invalid of [null, [], {}, "SAVED", { outcome: "SAVED" },
  { outcome: "SAVED", tripId: "trip-atomic-test", bellRequestId: "bell-atomic-test", bellStatus: "PENDING", tripStatus: "ON_BUS" },
  { outcome: "SAVED", tripId: "another-trip", bellRequestId: "bell-atomic-test", bellStatus: "SUCCESS", tripStatus: "ON_BUS" },
  { outcome: "SAVED", tripId: "trip-atomic-test", bellRequestId: "another-bell", bellStatus: "SUCCESS", tripStatus: "ON_BUS" },
  { outcome: "SAVED", tripId: "trip-atomic-test", bellRequestId: "bell-atomic-test", bellStatus: "SUCCESS", tripStatus: "UNKNOWN" },
]) {
  test(`rejects malformed atomic RPC output ${JSON.stringify(invalid)}`, async () => {
    const repository = new SupabaseTripRepository(
      { url: "https://supabase.example", apiKey: "test-service-key" },
      async () => Response.json(invalid),
    );
    const result = await recordBellResult("trip-atomic-test", body, repository);
    assert.equal(result.httpStatus, 500);
    assert.equal(!result.body.success && result.body.errorCode, "DB_ERROR");
  });
}
