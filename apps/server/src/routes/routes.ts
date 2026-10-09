import { Router } from "express";
import { getRouteSearchProvider } from "./route-search-provider.js";
import { searchRoutes } from "../services/route/search-routes.service.js";

export const routesRouter = Router();

// POST /api/routes/search
routesRouter.post("/search", async (req, res) => {
  const result = await searchRoutes(req.body, { searchRoutes: getRouteSearchProvider() });
  res.status(result.httpStatus).json(result.body);
});
