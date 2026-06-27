import { DEMO_ROUTE } from "@bus-ta/shared";
import type { Route, RoutesSearchRequest } from "@bus-ta/shared";

/**
 * Mock 노선 검색 제공자 — 시연/개발용.
 *
 * 효린 `searchRoutes(destination, latitude, longitude)` 실제 모듈이 repo 에 들어오면
 * 동일 시그니처 구현으로 교체한다. 그때까지 fixture(DEMO_ROUTE) 기반 후보 2개를 돌려준다.
 * (최종 후보 2개 선택은 본래 유나 OpenAI 모듈 책임이며, 여기서는 mock 으로 대체한다.)
 */
export async function mockSearchRoutes(_request: RoutesSearchRequest): Promise<Route[]> {
  const primary: Route = {
    ...DEMO_ROUTE,
    candidateId: 1,
    recommendationReason: "최단 소요 시간 (mock)",
  };

  const alternative: Route = {
    ...DEMO_ROUTE,
    candidateId: 2,
    recommendationReason: "환승 없는 직행 (mock)",
  };

  return [primary, alternative];
}
