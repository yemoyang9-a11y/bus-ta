import { Router } from "express";
import { getArrivalInfo } from "../adapters/routes/hyorin-route-search.adapter.js";
import { ArrivalCache } from "../services/arrival/arrival-cache.js";
import { createSupabaseTripRepositoryFromEnv } from "../repositories/supabase/trip.repository.js";
import { createTrip } from "../services/trip/create-trip.service.js";
import { getTripStatus } from "../services/trip/get-trip-status.service.js";
import { recordBellResult } from "../services/trip/bell-result.service.js";
import { endTrip } from "../services/trip/end-trip.service.js";
import { updateTripStatus } from "../services/trip/update-trip-status.service.js";
import { confirmBoarding } from "../services/trip/confirm-boarding.service.js";

export const tripsRouter = Router();

// POST /api/trips
/**
 * 도착정보 조회는 이 캐시를 거친다.
 *
 * GET /status 는 앱이 대기 중 반복 호출하고 사용자가 물을 때마다 또 불린다. 그때마다
 * GBIS 를 직접 부르면 호출량이 사용자 수 × 조회 빈도로 그대로 늘어난다. 캐시가 남은
 * 시간에 맞춰 주기를 정하고(최소 20초·최대 5분), 같은 대상에 동시 요청이 와도 한 번만
 * 부른다. 조회 실패는 상태로 구분해 "차량 없음"으로 굳지 않게 한다.
 *
 * 프로세스 전역이라 도착정보만 담는다. 비콘 스캔 여부처럼 운행마다 다른 값은 넣지 않는다.
 */
const arrivalCache = new ArrivalCache((target) => getArrivalInfo(target));

tripsRouter.post("/", async (req, res) => {
  const repository = createSupabaseTripRepositoryFromEnv();

  if (!repository) {
    res.status(500).json({
      success: false,
      errorCode: "DB_ERROR",
      message: "Supabase is not configured",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const result = await createTrip(req.body, {
    createTripWithStatus: (data) => repository.createTripWithStatus(data),
    getArrivals: async (candidate) => {
      // create_trip 은 arrivals 만 쓴다. 조회 실패(null)는 빈 배열로 접어 기존
      // 동작을 유지한다 — 실패와 차량없음 구분은 GET /status 의 arrivalStatus 가 한다.
      const snapshot = await arrivalCache.get(candidate);
      const info = { arrivals: snapshot.arrivals ?? [] };
      return info.arrivals;
    },
  });
  res.status(result.httpStatus).json(result.body);
});

// PATCH /api/trips/:tripId
// 사용자 명시 취소: WAITING_BUS | ON_BUS | NEAR_DESTINATION | ERROR → CANCELLED
tripsRouter.patch("/:tripId", async (req, res) => {
  const repository = createSupabaseTripRepositoryFromEnv();

  if (!repository) {
    res.status(500).json({
      success: false,
      errorCode: "DB_ERROR",
      message: "Supabase is not configured",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const result = await endTrip(req.params.tripId ?? "", req.body, repository);
  res.status(result.httpStatus).json(result.body);
});

// PATCH /api/trips/:tripId/status
tripsRouter.patch("/:tripId/status", async (req, res) => {
  const repository = createSupabaseTripRepositoryFromEnv();

  if (!repository) {
    res.status(500).json({
      success: false,
      errorCode: "DB_ERROR",
      message: "Supabase is not configured",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const result = await updateTripStatus(req.params.tripId ?? "", req.body, repository);
  res.status(result.httpStatus).json(result.body);
});

// POST /api/trips/:tripId/boarding/confirm
// 명시적 사용자 확인과 프론트 BLE 자동 판정이 공유하는 단일 탑승확정 경로.
tripsRouter.post("/:tripId/boarding/confirm", async (req, res) => {
  const repository = createSupabaseTripRepositoryFromEnv();

  if (!repository) {
    res.status(500).json({
      success: false,
      errorCode: "DB_ERROR",
      message: "Supabase is not configured",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const result = await confirmBoarding(req.params.tripId ?? "", req.body, repository);
  res.status(result.httpStatus).json(result.body);
});

// GET /api/trips/:tripId/status
// 조회 전용 — 상태를 변경하지 않고 하차벨 요청도 새로 만들지 않는다.
tripsRouter.get("/:tripId/status", async (req, res) => {
  const repository = createSupabaseTripRepositoryFromEnv();

  if (!repository) {
    res.status(500).json({
      success: false,
      errorCode: "DB_ERROR",
      message: "Supabase is not configured",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // "버스 놓쳤어요" 처럼 사용자가 최신 값을 명시적으로 요구한 경우에만 참으로 온다.
  // 캐시가 마지막 GBIS 호출로부터 20초 하한은 그대로 지키므로 남발돼도 호출은 안 늘어난다.
  const refreshArrivals = req.query.refreshArrivals === "true";

  const result = await getTripStatus(req.params.tripId ?? "", {
    findTripProgressData: (tripId) => repository.findTripProgressData(tripId),
    refreshArrivals,
    // get_trip_status 는 앱의 반복 조회와 사용자 질문이 함께 들어오는 경로다.
    // 캐시를 거쳐 GBIS 호출 빈도를 정책대로 묶고, 다음 조회까지 남은 시간을 함께 돌려준다.
    // arrivals 가 비어 있는 이유(차량 없음 / 예상시간 없음 / 확인 불가)는 arrivalStatus 로 구분한다.
    getArrivals: async (candidate) => {
      const { refresh, ...target } = candidate;
      const snapshot = await arrivalCache.get(target, refresh ? { refresh: true } : {});
      return {
        arrivals: snapshot.arrivals ?? [],
        arrivalStatus: snapshot.arrivalStatus,
        nextRefreshInMs: snapshot.nextRefreshInMs,
      };
    },
  });
  res.status(result.httpStatus).json(result.body);
});

// POST /api/trips/:tripId/bell/result
// PENDING → SUCCESS | FAIL 으로만 전환
tripsRouter.post("/:tripId/bell/result", async (req, res) => {
  const repository = createSupabaseTripRepositoryFromEnv();

  if (!repository) {
    res.status(500).json({
      success: false,
      errorCode: "DB_ERROR",
      message: "Supabase is not configured",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const result = await recordBellResult(req.params.tripId ?? "", req.body, repository);
  res.status(result.httpStatus).json(result.body);
});
