import { Router } from "express";
import {
  getArrivalInfo,
  searchRoutes as hyorinSearchRoutes,
} from "../adapters/routes/hyorin-route-search.adapter.js";
import { ArrivalCache } from "../services/arrival/arrival-cache.js";
import { searchRoutes } from "../services/route/search-routes.service.js";

export const routesRouter = Router();

// 검색 요청마다 GBIS 를 새로 부르지 않도록 프로세스 단위로 캐시를 공유한다.
// 같은 정류장을 여러 사용자가 조회해도 갱신 주기 안에서는 한 번만 나간다.
const arrivalCache = new ArrivalCache((target) => getArrivalInfo(target));

// POST /api/routes/search
routesRouter.post("/search", async (req, res) => {
  const result = await searchRoutes(req.body, {
    searchRoutes: hyorinSearchRoutes,
    getArrivals: async (candidate) => (await arrivalCache.get(candidate)).arrivals,
  });
  res.status(result.httpStatus).json(result.body);
});
