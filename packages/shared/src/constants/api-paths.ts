/**
 * API 경로 단일 진실 (Single Source of Truth)
 *
 * 규칙:
 * - 앱·서버 양쪽 모두 이 파일에서 경로를 가져온다.
 * - 이 파일 외에 /api/... 경로 문자열을 하드코딩하지 않는다.
 */

const BASE = "/api";

export const API_PATHS = {
  health: `${BASE}/health`,

  routes: {
    search: `${BASE}/routes/search`,
  },

  trips: {
    create: `${BASE}/trips`,
    byId: (tripId: string) => `${BASE}/trips/${tripId}`,
    /**
     * refreshArrivals=true 는 "버스 놓쳤어요"처럼 사용자가 최신 값을 명시적으로
     * 요구한 경우에만 붙인다. 일반 상태 조회에는 붙이지 않는다 — 서버가 정한
     * 갱신 주기를 앱이 우회하게 된다. 붙이더라도 서버가 마지막 GBIS 호출로부터
     * 20초 하한은 그대로 지킨다.
     */
    status: (tripId: string, refreshArrivals?: boolean) =>
      `${BASE}/trips/${tripId}/status${refreshArrivals ? "?refreshArrivals=true" : ""}`,
    boarding: {
      confirm: (tripId: string) => `${BASE}/trips/${tripId}/boarding/confirm`,
    },
    bell: {
      result: (tripId: string) => `${BASE}/trips/${tripId}/bell/result`,
    },
  },

  beacons: {
    list: (routeNo: string) => `${BASE}/beacons?routeNo=${encodeURIComponent(routeNo)}`,
  },

  realtime: {
    session: `${BASE}/realtime/session`,
  },
} as const;
