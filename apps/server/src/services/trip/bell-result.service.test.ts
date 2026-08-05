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
    reconcileBellStatus: async () => {},
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
      reconcileBellStatus: async () => {},
      now: () => "2026-07-01T14:41:01+09:00",
    },
  );

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.bellStatus, BELL_STATUS.FAIL);
  assert.equal((saved[0] as { resultMessage: string }).resultMessage, "MOCK_HARDWARE_TIMEOUT");
  assert.equal((saved[0] as { bellStatus: string }).bellStatus, BELL_STATUS.FAIL);
});

test("returns the existing result without overwriting or reconciling when already consistent (idempotent)", async () => {
  let saved = false;
  let reconciled = false;

  const result = await recordBellResult("trip-test-001", successBody, {
    findBellRequest: async () => ({
      ...pendingLookup,
      result: BELL_STATUS.SUCCESS,
      bellStatus: BELL_STATUS.SUCCESS,
    }),
    saveBellResult: async () => {
      saved = true;
    },
    reconcileBellStatus: async () => {
      reconciled = true;
    },
    now: () => "2026-07-01T14:42:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.bellStatus, BELL_STATUS.SUCCESS);
  assert.equal(result.body.message, "이미 처리된 하차벨 결과입니다.");
  assert.equal(saved, false);
  assert.equal(reconciled, false);
});

test("self-heals trip_status when bell_logs has a result but status lagged (partial failure)", async () => {
  const reconcileCalls: Array<{ tripId: string; bellStatus: string; completedAt: string }> = [];

  const result = await recordBellResult("trip-test-001", successBody, {
    // bell_logs 에는 SUCCESS 가 기록됐지만 trip_status 는 아직 PENDING 인 부분 실패 상황
    findBellRequest: async () => ({
      ...pendingLookup,
      result: BELL_STATUS.SUCCESS,
      bellStatus: BELL_STATUS.PENDING,
    }),
    saveBellResult: async () => {
      throw new Error("should not save on idempotent path");
    },
    reconcileBellStatus: async (tripId, bellStatus, completedAt) => {
      reconcileCalls.push({ tripId, bellStatus, completedAt });
    },
    now: () => "2026-07-01T14:42:30+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  // 권위 있는 값(bell_logs.result)을 반환하고 trip_status 를 보정한다.
  assert.equal(result.body.bellStatus, BELL_STATUS.SUCCESS);
  assert.equal(reconcileCalls.length, 1);
  assert.deepEqual(reconcileCalls[0], {
    tripId: "trip-test-001",
    bellStatus: BELL_STATUS.SUCCESS,
    completedAt: "2026-07-01T14:42:30+09:00",
  });
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
    reconcileBellStatus: async () => {},
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
    reconcileBellStatus: async () => {},
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
      reconcileBellStatus: async () => {},
      now: () => "2026-07-01T14:45:00+09:00",
    },
  );

  assert.equal(result.httpStatus, 400);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "INVALID_REQUEST");
});

test("returns 500 DB_ERROR when looking up the bell request fails", async () => {
  const result = await recordBellResult("trip-test-001", successBody, {
    findBellRequest: async () => {
      throw new Error("Supabase unavailable");
    },
    saveBellResult: async () => {
      throw new Error("should not be called");
    },
    reconcileBellStatus: async () => {
      throw new Error("should not be called");
    },
    now: () => "2026-07-01T14:46:00+09:00",
  });

  assert.equal(result.httpStatus, 500);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "DB_ERROR",
    message: "하차벨 결과를 저장하지 못했습니다.",
    timestamp: "2026-07-01T14:46:00+09:00",
  });
});

test("returns 500 DB_ERROR when saving the bell result fails", async () => {
  const result = await recordBellResult("trip-test-001", successBody, {
    findBellRequest: async () => pendingLookup,
    saveBellResult: async () => {
      throw new Error("Supabase unavailable");
    },
    reconcileBellStatus: async () => {
      throw new Error("should not be called");
    },
    now: () => "2026-07-01T14:47:00+09:00",
  });

  assert.equal(result.httpStatus, 500);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "DB_ERROR",
    message: "하차벨 결과를 저장하지 못했습니다.",
    timestamp: "2026-07-01T14:47:00+09:00",
  });
});

test("returns 500 DB_ERROR when reconciling a lagged bell status fails", async () => {
  const result = await recordBellResult("trip-test-001", successBody, {
    findBellRequest: async () => ({
      ...pendingLookup,
      result: BELL_STATUS.SUCCESS,
      bellStatus: BELL_STATUS.PENDING,
    }),
    saveBellResult: async () => {
      throw new Error("should not be called");
    },
    reconcileBellStatus: async () => {
      throw new Error("Supabase unavailable");
    },
    now: () => "2026-07-01T14:48:00+09:00",
  });

  assert.equal(result.httpStatus, 500);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "DB_ERROR",
    message: "하차벨 결과를 저장하지 못했습니다.",
    timestamp: "2026-07-01T14:48:00+09:00",
  });
});
