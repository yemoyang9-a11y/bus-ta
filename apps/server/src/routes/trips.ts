import { Router } from "express";

export const tripsRouter = Router();

// POST /api/trips
tripsRouter.post("/", (_req, res) => {
  // TODO: trip 생성
  res.status(501).json({ message: "Not implemented" });
});

// PATCH /api/trips/:tripId
tripsRouter.patch("/:tripId", (_req, res) => {
  // TODO: trip 정보 수정 (목적지 변경 등)
  res.status(501).json({ message: "Not implemented" });
});

// PATCH /api/trips/:tripId/status
tripsRouter.patch("/:tripId/status", (_req, res) => {
  // TODO: tripStatus 강제 변경 (앱 → 서버)
  res.status(501).json({ message: "Not implemented" });
});

// GET /api/trips/:tripId/status
tripsRouter.get("/:tripId/status", (_req, res) => {
  // TODO: 현재 tripStatus + 남은 정류장 수 조회 (상태 변경 없음)
  res.status(501).json({ message: "Not implemented" });
});

// 폐기: POST /api/trips/:tripId/bell/request
// 하차벨 요청은 PATCH /:tripId/status 처리 중 remainingStations=1 & NOT_REQUESTED 감지 시 자동 생성한다.

// POST /api/trips/:tripId/bell/result
// PENDING → SUCCESS | FAIL 으로만 전환
tripsRouter.post("/:tripId/bell/result", (_req, res) => {
  // TODO: 하차벨 결과 수신 처리
  res.status(501).json({ message: "Not implemented" });
});
