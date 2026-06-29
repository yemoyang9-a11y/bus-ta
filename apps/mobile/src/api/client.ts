import { API_PATHS } from "@bus-ta/shared";

declare const process: {
  env: {
    EXPO_PUBLIC_API_BASE_URL?: string;
  };
};

const BASE_URL = process.env["EXPO_PUBLIC_API_BASE_URL"] ?? "http://localhost:3000";

// TODO: axios 또는 fetch 래퍼로 교체
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export const apiClient = {
  health: () => request(API_PATHS.health),
  routes: {
    search: (body: unknown) =>
      request(API_PATHS.routes.search, { method: "POST", body: JSON.stringify(body) }),
  },
  trips: {
    create: (body: unknown) =>
      request(API_PATHS.trips.create, { method: "POST", body: JSON.stringify(body) }),
    getStatus: (tripId: string) => request(API_PATHS.trips.status(tripId)),
    updateStatus: (tripId: string, body: unknown) =>
      request(API_PATHS.trips.status(tripId), { method: "PATCH", body: JSON.stringify(body) }),
    bell: {
      // 하차벨 요청은 PATCH /status 응답으로 자동 생성되므로 별도 request 호출이 없다.
      result: (tripId: string, body: unknown) =>
        request(API_PATHS.trips.bell.result(tripId), {
          method: "POST",
          body: JSON.stringify(body),
        }),
    },
  },
  beacons: {
    list: () => request(API_PATHS.beacons.list),
  },
};
