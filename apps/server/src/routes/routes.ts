import { Router } from "express";

export const routesRouter = Router();

// POST /api/routes/search
routesRouter.post("/search", (_req, res) => {
  // TODO: 카카오 로컬 API + GBIS API 연동
  res.status(501).json({ message: "Not implemented" });
});
