import { Router } from "express";
import { getArrivalInfo } from "../adapters/routes/hyorin-route-search.adapter.js";
import { createSupabaseTripRepositoryFromEnv } from "../repositories/supabase/trip.repository.js";
import { createTrip } from "../services/trip/create-trip.service.js";
import { getTripStatus } from "../services/trip/get-trip-status.service.js";
import { recordBellResult } from "../services/trip/bell-result.service.js";
import { updateTripStatus } from "../services/trip/update-trip-status.service.js";

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
    getPredictedArrivalMinutes: async (candidate) => {
      const info = await getArrivalInfo(candidate);
      return info.predictedArrivalMinutes;
    },
  });
  res.status(result.httpStatus).json(result.body);
});

// PATCH /api/trips/:tripId
// 미구현(보류): 운행 취소/시연 재시작용. 중간평가 범위 밖이며 시연에 해당 장면이 없다.
// 명세는 docs/API_SPEC.md "PATCH /api/trips/{tripId}" 참고.
tripsRouter.patch("/:tripId", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
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

  const result = await getTripStatus(req.params.tripId ?? "", repository);
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
