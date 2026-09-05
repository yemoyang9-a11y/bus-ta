import assert from "node:assert/strict";
import test from "node:test";
import { createAssistDevicePreparation } from "../../../mobile/src/realtime/assist-device-preparation.js";

// ─────────────────────────────────────────────
// 운행을 만드는 시점의 보조기기 준비.
//
// 2026-09-04 실차 시험에서 하차벨이 두 번 다 울리지 않았다. 이 준비 단계가
// connectAll() 로 지팡이와 하차벨을 한 번에 찾았는데, 사용자는 아직 정류장에 있었고
// 하차벨 보드는 오지 않은 버스 안이라 BLE 범위 밖이었다. 반드시 실패하는 스캔이었고,
// 실패한 뒤 다시 찾는 코드가 없어 버스에 타고 나서도 연결이 없었다.
//
// 그래서 이 단계는 지팡이만 맡고, 하차벨은 탑승 확정 뒤 화면이 연결한다.
// ─────────────────────────────────────────────

const TRIP_ID = "trip-1";

function makePreparation(overrides: Record<string, unknown> = {}) {
  const calls = {
    caneConnects: 0,
    setTargetBeacon: [] as string[],
    failures: [] as string[],
    dispatched: [] as { type: string; [key: string]: unknown }[],
  };

  const preparation = createAssistDevicePreparation({
    getActiveTripId: () => TRIP_ID,
    listBeacons: async () => ({ targetBeaconId: "BUS_35_001", isMock: false }),
    connectCane: async () => {
      calls.caneConnects += 1;
      return { id: "cane" };
    },
    setTargetBeacon: async (targetBeaconId: string) => {
      calls.setTargetBeacon.push(targetBeaconId);
    },
    notifyFailure: (event) => {
      calls.failures.push(`${event.device}:${event.reason}`);
    },
    dispatch: (action) => {
      calls.dispatched.push(action as { type: string });
    },
    ...overrides,
  } as Parameters<typeof createAssistDevicePreparation>[0]);

  return { preparation, calls };
}

test("준비 단계는 지팡이만 연결한다", async () => {
  const { preparation, calls } = makePreparation();

  await preparation.prepare({ tripId: TRIP_ID, routeNo: "35" });

  assert.equal(calls.caneConnects, 1);
  // 하차벨 연결을 여기서 시도했다면 반드시 실패했을 것이고, 사용자는 아직 버스에
  // 타지도 않았는데 "하차벨에 연결하지 못했습니다"를 듣게 된다.
  assert.deepEqual(calls.failures, []);
});

test("탑승 뒤 연결할 하차벨 보드 이름을 상태에 남긴다", async () => {
  const { preparation, calls } = makePreparation();

  await preparation.prepare({ tripId: TRIP_ID, routeNo: "35" });

  const target = calls.dispatched.find(
    (action) => action.type === "SET_TARGET_BEACON_ID",
  );
  // 앱에 이름을 박아 두면 시연 노선을 바꿀 때마다 어긋난다. 실제로 DB 는
  // BUS_35_001 로 바뀌었는데 앱은 BUS_1551_001 을 찾고 있었다.
  assert.equal(target?.targetBeaconId, "BUS_35_001");
});

test("지팡이 연결에 실패하면 지팡이만 알린다", async () => {
  const { preparation, calls } = makePreparation({
    connectCane: async () => null,
  });

  await preparation.prepare({ tripId: TRIP_ID, routeNo: "35" });

  assert.deepEqual(calls.failures, ["CANE:NOT_CONNECTED"]);
  // 지팡이가 무엇을 찾을지 모르므로 스캔 준비 완료로 표시하면 안 된다.
  assert.equal(
    calls.dispatched.some((action) => action.type === "SET_CANE_READY"),
    false,
  );
  assert.deepEqual(calls.setTargetBeacon, []);
});

test("비콘 조회에 실패해도 지팡이 연결은 시도한다", async () => {
  const { preparation, calls } = makePreparation({
    listBeacons: async () => {
      throw new Error("upstream");
    },
  });

  await preparation.prepare({ tripId: TRIP_ID, routeNo: "35" });

  assert.equal(calls.caneConnects, 1);
  assert.deepEqual(calls.failures, ["CANE:BEACON_LOOKUP_FAILED"]);
});

test("비콘 준비 완료는 targetBeaconId를 상태에 남긴 뒤 표시한다", async () => {
  const { preparation, calls } = makePreparation();

  await preparation.prepare({ tripId: TRIP_ID, routeNo: "35" });

  const targetIndex = calls.dispatched.findIndex(
    (action) => action.type === "SET_TARGET_BEACON_ID",
  );
  const completedIndex = calls.dispatched.findIndex(
    (action) => action.type === "SET_BEACON_PREPARATION_COMPLETED",
  );

  assert.notEqual(targetIndex, -1);
  assert.notEqual(completedIndex, -1);

  // 탑승 확정이 먼저 도착한 경우 RidingScreen은 준비 완료를 기다린다.
  // 따라서 targetBeaconId를 먼저 저장하고 그 뒤에 준비 완료를 알려야 한다.
  assert.ok(targetIndex < completedIndex);

  assert.equal(
    calls.dispatched[completedIndex]?.completed,
    true,
  );
});