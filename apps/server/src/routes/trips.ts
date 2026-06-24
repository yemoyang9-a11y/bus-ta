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

// POST /api/trips/:tripId/bell/request
// NOT_REQUESTED | 재시도 가능한 FAIL → PENDING 으로만 전환
tripsRouter.post("/:tripId/bell/request", (_req, res) => {
  // TODO: 하차벨 요청 처리
  res.status(501).json({ message: "Not implemented" });
});

// POST /api/trips/:tripId/bell/result
// PENDING → SUCCESS | FAIL 으로만 전환
tripsRouter.post("/:tripId/bell/result", (_req, res) => {
  // TODO: 하차벨 결과 수신 처리
  res.status(501).json({ message: "Not implemented" });
});
