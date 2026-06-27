import assert from "node:assert/strict";
import test from "node:test";
import { BELL_COMMAND, BELL_STATUS, TRIP_STATUS } from "@bus-ta/shared";
import { recordBellResult, type BellRequestLookup } from "./bell-result.service.js";

const pendingLookup: BellRequestLookup = {
  tripId: "trip-test-001",
  bellRequestId: "bell-test-001",
  result: null,
  bellStatus: BELL_STATUS.PENDING,
  tripStatus: TRIP_STATUS.NEAR_DESTINATION,
};

const successBody = {
  bellRequestId: "bell-test-001",
  command: BELL_COMMAND.STOP_REQUEST,
  result: BELL_STATUS.SUCCESS,
  isMock: true,
  timestamp: "2026-07-01T14:40:00+09:00",
};

test("records a SUCCESS result and moves bell to SUCCESS", async () => {
  const saved: unknown[] = [];

  const result = await recordBellResult("trip-test-001", successBody, {
    findBellRequest: async () => pendingLookup,
    saveBellResult: async (data) => {
      saved.push(data);
    },
    now: () => "2026-07-01T14:40:01+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.bellStatus, BELL_STATUS.SUCCESS);
  assert.equal(result.body.tripStatus, TRIP_STATUS.NEAR_DESTINATION);
  assert.equal(result.body.bellRequestId, "bell-test-001");

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], {
    tripId: "trip-test-001",
    bellRequestId: "bell-test-001",
    result: BELL_STATUS.SUCCESS,
    resultMessage: null,
    isMock: true,
    completedAt: "2026-07-01T14:40:01+09:00",
    bellStatus: BELL_STATUS.SUCCESS,
  });
});

test("records a FAIL result with a fail message", async () => {
  const saved: unknown[] = [];

  const result = await recordBellResult(
    "trip-test-001",
    {
      bellRequestId: "bell-test-001",
      command: BELL_COMMAND.STOP_REQUEST,
      result: BELL_STATUS.FAIL,
      resultMessage: "MOCK_HARDWARE_TIMEOUT",
      isMock: true,
      timestamp: "2026-07-01T14:41:00+09:00",
    },
    {
      findBellRequest: async () => pendingLookup,
      saveBellResult: async (data) => {
        saved.push(data);
      },
      now: () => "2026-07-01T14:41:01+09:00",
    },
  );

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.bellStatus, BELL_STATUS.FAIL);
  assert.equal((saved[0] as { resultMessage: string }).resultMessage, "MOCK_HARDWARE_TIMEOUT");
  assert.equal((saved[0] as { bellStatus: string }).bellStatus, BELL_STATUS.FAIL);
});

test("returns the existing result without overwriting when already completed (idempotent)", async () => {
  let saved = false;

  const result = await recordBellResult("trip-test-001", successBody, {
    findBellRequest: async () => ({
      ...pendingLookup,
      result: BELL_STATUS.SUCCESS,
      bellStatus: BELL_STATUS.SUCCESS,
    }),
    saveBellResult: async () => {
      saved = true;
    },
    now: () => "2026-07-01T14:42:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.bellStatus, BELL_STATUS.SUCCESS);
  assert.equal(result.body.message, "이미 처리된 하차벨 결과입니다.");
  assert.equal(saved, false);
});

test("rejects when bell is not in PENDING state", async () => {
  const result = await recordBellResult("trip-test-001", successBody, {
    findBellRequest: async () => ({
      ...pendingLookup,
      bellStatus: BELL_STATUS.NOT_REQUESTED,
    }),
    saveBellResult: async () => {
      throw new Error("should not save");
    },
    now: () => "2026-07-01T14:43:00+09:00",
  });

  assert.equal(result.httpStatus, 409);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "INVALID_BELL_STATE");
});

test("returns 404 when the bell request does not exist", async () => {
  const result = await recordBellResult("trip-test-001", successBody, {
    findBellRequest: async () => null,
    saveBellResult: async () => {},
    now: () => "2026-07-01T14:44:00+09:00",
  });

  assert.equal(result.httpStatus, 404);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "BELL_REQUEST_NOT_FOUND");
});

test("rejects an invalid request body", async () => {
  const result = await recordBellResult(
    "trip-test-001",
    { bellRequestId: "bell-test-001" },
    {
      findBellRequest: async () => {
        throw new Error("should not be called");
      },
      saveBellResult: async () => {},
      now: () => "2026-07-01T14:45:00+09:00",
    },
  );

  assert.equal(result.httpStatus, 400);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "INVALID_REQUEST");
});
