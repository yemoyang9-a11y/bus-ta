import { Router } from "express";

export const beaconsRouter = Router();

// GET /api/beacons
beaconsRouter.get("/", (_req, res) => {
  // TODO: 비콘 목록 반환
  res.status(501).json({ message: "Not implemented" });
});
