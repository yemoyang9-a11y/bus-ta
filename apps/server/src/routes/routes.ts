import { Router } from "express";
import { mockSearchRoutes } from "../adapters/routes/mock-route-search.adapter.js";
import { searchRoutes } from "../services/route/search-routes.service.js";

export const routesRouter = Router();

// POST /api/routes/search
// 효린 searchRoutes 실제 모듈이 준비되기 전까지 mock 후보 제공자를 사용한다.
routesRouter.post("/search", async (req, res) => {
  const result = await searchRoutes(req.body, { searchRoutes: mockSearchRoutes });
  res.status(result.httpStatus).json(result.body);
});
