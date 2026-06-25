/**
 * API 경로 단일 진실 (Single Source of Truth)
 *
 * 규칙:
 * - 앱·서버 양쪽 모두 이 파일에서 경로를 가져온다.
 * - 이 파일 외에 /api/... 경로 문자열을 하드코딩하지 않는다.
 *
 * 폐기된 경로 (절대 사용 금지):
 * - GET  /api/trips/{tripId}/bell          → GET /api/trips/{tripId}/status 로 대체
 * - POST /api/ble/result                   → POST /api/trips/{tripId}/bell/result 로 대체
 * - POST /api/trips/{tripId}/bell/request  → PATCH /api/trips/{tripId}/status 처리 중 자동 생성으로 대체
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
      // 하차벨 요청은 PATCH /status 처리 중 백엔드가 자동 생성한다 (별도 request 엔드포인트 없음).
      result: (tripId: string) => `${BASE}/trips/${tripId}/bell/result`,
    },
  },

  beacons: {
    list: `${BASE}/beacons`,
  },
} as const;
