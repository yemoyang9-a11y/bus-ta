import { Router } from "express";
import { createSupabaseTripRepositoryFromEnv } from "../repositories/supabase/trip.repository.js";
import { createTrip } from "../services/trip/create-trip.service.js";
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

  const result = await createTrip(req.body, repository);
  res.status(result.httpStatus).json(result.body);
});

// PATCH /api/trips/:tripId
tripsRouter.patch("/:tripId", (_req, res) => {
  // TODO: trip 정보 수정 (목적지 변경 등)
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
tripsRouter.get("/:tripId/status", (_req, res) => {
  // TODO: 현재 tripStatus + 남은 정류장 수 조회 (상태 변경 없음)
  res.status(501).json({ message: "Not implemented" });
});

// POST /api/trips/:tripId/bell/result
// PENDING → SUCCESS | FAIL 으로만 전환
tripsRouter.post("/:tripId/bell/result", (_req, res) => {
  // TODO: 하차벨 결과 수신 처리
  res.status(501).json({ message: "Not implemented" });
});
