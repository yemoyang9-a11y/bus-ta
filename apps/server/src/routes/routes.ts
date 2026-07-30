import { Router } from "express";
import { searchRoutes as hyorinSearchRoutes } from "../adapters/routes/hyorin-route-search.adapter.js";
import { searchRoutes } from "../services/route/search-routes.service.js";

export const routesRouter = Router();

// POST /api/routes/search
routesRouter.post("/search", async (req, res) => {
  const result = await searchRoutes(req.body, { searchRoutes: hyorinSearchRoutes });
  res.status(result.httpStatus).json(result.body);
});
