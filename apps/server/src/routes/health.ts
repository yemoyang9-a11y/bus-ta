import { Router } from "express";

export const healthRouter = Router();

// GET /api/health
healthRouter.get("/", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
