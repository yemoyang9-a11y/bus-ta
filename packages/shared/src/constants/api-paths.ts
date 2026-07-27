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
    status: (tripId: string) => `${BASE}/trips/${tripId}/status`,
    bell: {
      result: (tripId: string) => `${BASE}/trips/${tripId}/bell/result`,
    },
  },

  beacons: {
    list: (routeNo: string) => `${BASE}/beacons?routeNo=${encodeURIComponent(routeNo)}`,
  },
} as const;
