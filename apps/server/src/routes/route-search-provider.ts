import { searchRoutes as realSearchRoutes } from "../adapters/routes/hyorin-route-search.adapter.js";
import { mockSearchRoutes } from "../adapters/routes/mock-route-search.adapter.js";
import type { RouteSearchProvider } from "../services/route/search-routes.service.js";

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * 검색 제공자는 요청 시점에 선택한다.
 * index.ts가 .env를 로드하기 전에 모듈이 평가되는 문제를 피하기 위해
 * 모듈 로드 시점에 환경변수를 읽지 않는다.
 */
export function getRouteSearchProvider(
  env: Environment = process.env,
): RouteSearchProvider["searchRoutes"] {
  return env.ROUTE_SEARCH_MODE === "MOCK" ? mockSearchRoutes : realSearchRoutes;
}
