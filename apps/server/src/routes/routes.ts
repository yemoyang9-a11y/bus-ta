import { Router } from "express";
import {
  getArrivalInfo,
  searchRoutes as hyorinSearchRoutes,
} from "../adapters/routes/hyorin-route-search.adapter.js";
import { ArrivalCache } from "../services/arrival/arrival-cache.js";
import { searchRoutes } from "../services/route/search-routes.service.js";

export const routesRouter = Router();

// 검색 요청마다 GBIS 를 새로 부르지 않도록 프로세스 단위로 캐시를 공유한다.
// 도착정보는 사용자와 무관한 값이라 공유해도 된다. 사용자별 상태(비콘 스캔 여부
// 등)는 이 캐시에 두지 않는다.
const arrivalCache = new ArrivalCache((target) => getArrivalInfo(target));

// POST /api/routes/search
routesRouter.post("/search", async (req, res) => {
  const result = await searchRoutes(req.body, {
    searchRoutes: hyorinSearchRoutes,
    getArrivals: async (candidate) => {
      const snapshot = await arrivalCache.get(candidate);
      // 조회 실패(null)와 실시간 차량 없음([])은 다른 뜻이다. 실패는 예외로
      // 올려보내 호출부가 arrivals 필드를 생략하게 한다.
      if (snapshot.arrivals === null) {
        throw new Error("도착정보를 확인할 수 없습니다.");
      }
      return snapshot.arrivals;
    },
  });
  res.status(result.httpStatus).json(result.body);
});
