import { DEMO_ROUTE } from "@bus-ta/shared";
import type { Route, RoutesSearchRequest } from "@bus-ta/shared";

/**
 * Mock 노선 검색 제공자 — 시연/개발용.
 *
 * ROUTE_SEARCH_MODE=MOCK일 때 fixture(DEMO_ROUTE) 기반 후보를 돌려준다.
 * 실제 제공자와 같은 서버 정렬·중복 제거·안내 흐름을 통과한다.
 */
export async function mockSearchRoutes(_request: RoutesSearchRequest): Promise<Route[]> {
  const primary: Route = {
    ...DEMO_ROUTE,
    candidateId: 1,
    routeMode: "DIRECT_BUS",
    tripSupported: true,
    segments: [{
      mode: "BUS",
      startName: DEMO_ROUTE.boardingStation.stationName,
      endName: DEMO_ROUTE.destinationStation.stationName,
      lineNames: [],
      routeNumbers: [DEMO_ROUTE.routeNo],
    }],
    recommendationReason: "최단 소요 시간 (mock)",
  };

  const alternative: Route = {
    ...primary,
    candidateId: 2,
    recommendationReason: "환승 없는 직행 (mock)",
  };

  return [primary, alternative];
}
