/**
 * 시연용 하차벨 데모 스크립트 (인메모리, DB·서버 불필요)
 *
 * 실행: pnpm --filter @bus-ta/server demo:bell
 *
 * 1551 노선(수원대학교 → 병점역후문)의 mock GPS를 3초 간격으로 흘려보내며,
 * 실제 백엔드 서비스(createTrip → updateTripStatus 자동벨 → recordBellResult)와
 * mock 하차벨 어댑터로 하드웨어 데이터 송수신(STOP_REQUEST) 흐름을 터미널에 출력한다.
 *
 * 하드웨어가 없으므로 ②③(앱↔하드웨어 BLE)은 mock-bell.adapter 가 대역한다.
 * 부품 도착 후에는 ②③만 실제 BLE 로 교체하면 된다.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// 실행 디렉터리의 .env 자동 로드 (DEMO_USE_DB 모드에서 Supabase 키를 읽기 위함).
const envFilePath = resolve(process.cwd(), ".env");
if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

import { DEMO_ROUTE, DEMO_LOCATION_SEQUENCE } from "@bus-ta/shared";
import { createTrip } from "../services/trip/create-trip.service.js";
import {
  updateTripStatus,
  type TripProgressData,
  type SaveStatusAndLocationInput,
  type LocationLogLookup,
} from "../services/trip/update-trip-status.service.js";
import {
  recordBellResult,
  type BellRequestLookup,
  type SaveBellResultInput,
} from "../services/trip/bell-result.service.js";
import type {
  CreateTripWithStatusInput,
  TripCreateRecord,
  TripCreationRepository,
} from "../services/trip/create-trip.service.js";
import type { UpdateTripStatusRepository } from "../services/trip/update-trip-status.service.js";
import type { BellResultRepository } from "../services/trip/bell-result.service.js";
import { createSupabaseTripRepositoryFromEnv } from "../repositories/supabase/trip.repository.js";
import { MockBellAdapter } from "../adapters/bell/mock-bell.adapter.js";
import { asTripId, asBellRequestId } from "@bus-ta/shared";

/** createTrip / updateTripStatus / recordBellResult 가 함께 쓰는 저장소 묶음 */
type DemoRepo = TripCreationRepository & UpdateTripStatusRepository & BellResultRepository;
const USE_DB = process.env["DEMO_USE_DB"] === "true";

const INTERVAL_MS = Number(process.env["DEMO_INTERVAL_MS"] ?? 3000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const line = (s = "") => console.log(s);
const rule = () => line("──────────────────────────────────────────────────────────");

/** 인메모리 저장소 — 실제 Supabase repository 자리를 대신한다. */
function createMemoryStore(): DemoRepo {
  let trip: TripCreateRecord | null = null;
  let status: TripProgressData["status"] | null = null;
  const locationLogs = new Map<string, unknown>();
  const bellLogs = new Map<string, { result: "SUCCESS" | "FAIL" | null }>();

  return {
    // createTrip
    async createTripWithStatus(data: CreateTripWithStatusInput): Promise<void> {
      trip = data.trip;
      status = {
        ...data.status,
        bellRequestId: null,
        command: null,
      } as TripProgressData["status"];
    },
    // updateTripStatus
    async findTripProgressData(): Promise<TripProgressData | null> {
      if (!trip || !status) return null;
      return {
        trip: {
          tripId: trip.tripId,
          destination: trip.destination,
          routeNo: trip.routeNo,
          stationList: trip.stationList,
        },
        status,
      };
    },
    async findLocationLogByRequestId(
      _tripId: string,
      requestId: string,
    ): Promise<LocationLogLookup | null> {
      return locationLogs.has(requestId)
        ? { tripId: trip!.tripId, requestId }
        : null;
    },
    async saveStatusAndLocation(data: SaveStatusAndLocationInput): Promise<void> {
      locationLogs.set(data.locationLog.requestId, data.locationLog);
      if (data.bellRequest) {
        bellLogs.set(data.bellRequest.bellRequestId, { result: null });
      }
      status = {
        ...status!,
        ...data.status,
        bellRequestId: data.bellRequest?.bellRequestId ?? status!.bellRequestId,
        command: data.bellRequest?.command ?? status!.command,
      };
    },
    // recordBellResult
    async findBellRequest(
      _tripId: string,
      bellRequestId: string,
    ): Promise<BellRequestLookup | null> {
      const bell = bellLogs.get(bellRequestId);
      if (!bell || !status) return null;
      return {
        tripId: trip!.tripId,
        bellRequestId,
        result: bell.result,
        bellStatus: status.bellStatus,
        tripStatus: status.tripStatus,
      };
    },
    async saveBellResult(data: SaveBellResultInput): Promise<void> {
      bellLogs.get(data.bellRequestId)!.result = data.result;
      status = { ...status!, bellStatus: data.bellStatus, updatedAt: data.completedAt };
    },
    async reconcileBellStatus(
      _tripId: string,
      bellStatus: "SUCCESS" | "FAIL",
      completedAt: string,
    ): Promise<void> {
      status = { ...status!, bellStatus, updatedAt: completedAt };
    },
  };
}

async function main() {
  let repo: DemoRepo;
  if (USE_DB) {
    const supabase = createSupabaseTripRepositoryFromEnv();
    if (!supabase) {
      line("[오류] DEMO_USE_DB=true 인데 Supabase 설정이 없습니다.");
      line("       apps/server/.env 에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 를 넣어주세요.");
      process.exit(1);
    }
    repo = supabase;
  } else {
    repo = createMemoryStore();
  }

  // 데모는 항상 성공을 보여주기 위해 성공률 100% 로 둔다.
  const bell = new MockBellAdapter(1);

  line();
  line("════════════ 하차벨 시연 (1551번 · 수원대학교 → 병점역후문) ════════════");
  line(`저장 모드: ${USE_DB ? "실제 Supabase 기록" : "인메모리(DB 미사용)"}`);
  line(`mock GPS ${DEMO_LOCATION_SEQUENCE.length}개를 ${INTERVAL_MS / 1000}초 간격으로 전송합니다.`);
  rule();

  // 1) 운행 생성 (DB 모드는 매 실행마다 고유 tripId 사용)
  const tripId = USE_DB ? `trip-demo-1551-${Date.now()}` : "trip-demo-1551";
  const created = await createTrip(
    { ...DEMO_ROUTE, destination: DEMO_ROUTE.destinationStation.stationName },
    {
      createTripWithStatus: (data) => repo.createTripWithStatus(data),
      getArrivals: async () =>
        DEMO_ROUTE.totalTime == null
          ? []
          : [
              {
                predictedArrivalMinutes: DEMO_ROUTE.totalTime,
                occupancy: { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null },
              },
            ],
      generateTripId: () => tripId,
    },
  );
  if (created.httpStatus !== 201) {
    line(`[운행생성 실패] ${JSON.stringify(created.body)}`);
    return;
  }
  line(`[운행생성] POST /api/trips → tripId=${tripId}  tripStatus=WAITING_BUS`);
  rule();

  // 2) 3초마다 위치 전송
  for (const loc of DEMO_LOCATION_SEQUENCE) {
    await sleep(INTERVAL_MS);
    const res = await updateTripStatus(tripId, loc, {
      findTripProgressData: (t) => repo.findTripProgressData(t),
      findLocationLogByRequestId: (t, r) => repo.findLocationLogByRequestId(t, r),
      saveStatusAndLocation: (d) => repo.saveStatusAndLocation(d),
    });
    if (res.httpStatus !== 200) {
      line(`[위치오류] ${JSON.stringify(res.body)}`);
      continue;
    }
    const b = res.body;
    line(
      `[위치] ${b.currentStation?.stationName ?? "-"}` +
        `  남은정류장=${b.remainingStations}  상태=${b.tripStatus}`,
    );

    // 3) 목적지 전 정류장 → 하차벨 신호 흐름
    if (b.shouldTriggerBell && b.bellRequestId) {
      rule();
      line("★ 목적지 전 정류장 도달 → 하차벨 신호 발생");
      line(`  ① 백엔드 → 앱     STOP_REQUEST 생성  bellRequestId=${b.bellRequestId}  (NOT_REQUESTED→PENDING)`);
      line(`  ② 앱 → 하드웨어    (BLE 모의) STOP_REQUEST 전송 → [MOCK 하차벨]`);
      const result = await bell.sendRequest(asTripId(tripId), asBellRequestId(b.bellRequestId));
      line(`  ③ 하드웨어 → 앱    (BLE 모의) 결과 응답  ${result.result}`);
      const saved = await recordBellResult(
        tripId,
        {
          bellRequestId: b.bellRequestId,
          command: result.command,
          result: result.result,
          resultMessage: result.resultMessage,
          isMock: result.isMock,
          timestamp: result.timestamp,
        },
        {
          findBellRequest: (t, r) => repo.findBellRequest(t, r),
          saveBellResult: (d) => repo.saveBellResult(d),
          reconcileBellStatus: (t, s, c) => repo.reconcileBellStatus(t, s, c),
        },
      );
      const bs = saved.httpStatus === 200 ? saved.body.bellStatus : "ERROR";
      line(`  ④ 앱 → 백엔드     POST /api/trips/${tripId}/bell/result 저장  (PENDING→${bs})`);
      line(`[완료] 하차벨 정상 동작 (mock)  bellStatus=${bs}`);
      rule();
    }
  }

  line("════════════ 시연 종료 ════════════");
  if (USE_DB) {
    line();
    line(`[DB 확인] Supabase 대시보드에서 tripId="${tripId}" 로 조회하세요.`);
    line(`  trips / trip_status / location_logs / bell_logs 에 데이터가 기록됩니다.`);
  }
  line();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
