import { Router } from "express";
import { getArrivalInfo } from "../adapters/routes/hyorin-route-search.adapter.js";
import { createSupabaseTripRepositoryFromEnv } from "../repositories/supabase/trip.repository.js";
import { createTrip } from "../services/trip/create-trip.service.js";
import { getTripStatus } from "../services/trip/get-trip-status.service.js";
import { recordBellResult } from "../services/trip/bell-result.service.js";
import { endTrip } from "../services/trip/end-trip.service.js";
import { updateTripStatus } from "../services/trip/update-trip-status.service.js";
import { confirmBoarding } from "../services/trip/confirm-boarding.service.js";

export const tripsRouter = Router();

// POST /api/trips
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
      const info = await getArrivalInfo(candidate);
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

  const result = await getTripStatus(req.params.tripId ?? "", {
    findTripProgressData: (tripId) => repository.findTripProgressData(tripId),
    // get_trip_status 는 사용자가 버스를 놓쳤다고 말한 직후 호출되는 경로다.
    // 캐시/기존 predictedArrivalMinutes를 거치지 않고 GBIS를 새로 조회한다.
    // arrivals 가 비어 있는 이유(차량 없음 / 방향 확인 불가) 판단은 service 가 한다.
    getArrivals: (candidate) => getArrivalInfo(candidate),
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
