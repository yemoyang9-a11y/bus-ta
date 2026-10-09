import assert from "node:assert/strict";
import test from "node:test";
import { BELL_STATUS, TRIP_STATUS } from "@bus-ta/shared";
import { recordBellResult, type SaveBellResultResult } from "./bell-result.service.js";

const successBody = {
  bellRequestId: "bell-test-001", command: "STOP_REQUEST", result: "SUCCESS",
  isMock: false, timestamp: "2026-09-22T09:00:00.000Z",
};
const saved: SaveBellResultResult = {
  outcome: "SAVED", tripId: "trip-test-001", bellRequestId: "bell-test-001",
  bellStatus: BELL_STATUS.SUCCESS, tripStatus: TRIP_STATUS.NEAR_DESTINATION,
};
const timestamp = "2026-09-22T09:00:01.000Z";

for (const bellStatus of [BELL_STATUS.SUCCESS, BELL_STATUS.FAIL]) {
  test(`records ${bellStatus} with server time and preserves metadata`, async () => {
    let input: unknown;
    const result = await recordBellResult("trip-test-001", {
      ...successBody, result: bellStatus, resultMessage: "hardware outcome",
    }, {
      saveBellResult: async (data) => { input = data; return { ...saved, bellStatus }; },
      now: () => timestamp,
    });
    assert.equal(result.httpStatus, 200);
    assert.equal(result.body.success && result.body.bellStatus, bellStatus);
    assert.equal(result.body.success && result.body.tripStatus, TRIP_STATUS.NEAR_DESTINATION);
    assert.deepEqual(input, {
      tripId: "trip-test-001", bellRequestId: "bell-test-001", result: bellStatus,
      resultMessage: "hardware outcome", isMock: false, completedAt: timestamp,
    });
  });
}

test("returns the first committed result on conflicting replay, including after cancellation", async () => {
  const result = await recordBellResult("trip-test-001", { ...successBody, result: "FAIL" }, {
    saveBellResult: async () => ({ ...saved, outcome: "ALREADY_RECORDED", tripStatus: TRIP_STATUS.CANCELLED }),
    now: () => timestamp,
  });
  assert.deepEqual(result, {
    httpStatus: 200, body: {
      success: true, tripId: "trip-test-001", bellRequestId: "bell-test-001",
      bellStatus: "SUCCESS", tripStatus: "CANCELLED",
      message: "이미 처리된 하차벨 결과입니다.", timestamp,
    },
  });
});

for (const [outcome, httpStatus] of [["BELL_REQUEST_NOT_FOUND", 404], ["INVALID_BELL_STATE", 409]] as const) {
  test(`maps locked persistence outcome ${outcome} to ${httpStatus}`, async () => {
    const result = await recordBellResult("trip-test-001", successBody, {
      saveBellResult: async () => ({ outcome }), now: () => timestamp,
    });
    assert.equal(result.httpStatus, httpStatus);
    assert.equal(!result.body.success && result.body.errorCode, outcome);
  });
}

test("rejects invalid input without attempting persistence", async () => {
  let called = false;
  const result = await recordBellResult("trip-test-001", { bellRequestId: "bell-test-001" }, {
    saveBellResult: async () => { called = true; return saved; }, now: () => timestamp,
  });
  assert.equal(result.httpStatus, 400);
  assert.equal(!result.body.success && result.body.errorCode, "INVALID_REQUEST");
  assert.equal(called, false);
});

test("maps a failed atomic transaction or legacy repair to DB_ERROR", async () => {
  const result = await recordBellResult("trip-test-001", successBody, {
    saveBellResult: async () => { throw new Error("transaction rolled back"); }, now: () => timestamp,
  });
  assert.deepEqual(result, { httpStatus: 500, body: {
    success: false, errorCode: "DB_ERROR", message: "하차벨 결과를 저장하지 못했습니다.", timestamp,
  } });
});
