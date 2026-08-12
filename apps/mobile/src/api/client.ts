import { API_PATHS, type BeaconsListResponse } from "@bus-ta/shared";

declare const process: {
  env: {
    EXPO_PUBLIC_API_BASE_URL?: string;
  };
};

const BASE_URL = process.env["EXPO_PUBLIC_API_BASE_URL"] ?? "http://localhost:3000";

// 백엔드 공통 오류 응답 형식 (공통 API 명세서 4.1)
interface ApiErrorBody {
  success: false;
  errorCode: string;
  message: string;
  timestamp: string;
}

// errorCode·status를 화면까지 전달하기 위한 커스텀 에러
export class ApiError extends Error {
  readonly errorCode: string;
  readonly status: number;

  constructor(errorCode: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.errorCode = errorCode;
    this.status = status;
  }
}

// TODO: axios 또는 fetch 래퍼로 교체
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (networkError) {
    // 네트워크 자체가 끊겼거나 서버에 도달하지 못한 경우
    throw new ApiError(
      "NETWORK_ERROR",
      networkError instanceof Error ? networkError.message : "네트워크 연결에 실패했습니다.",
      0
    );
  }

  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // 서버가 JSON이 아닌 응답을 보낸 경우 (예: 502 HTML 에러 페이지)
    }
    throw new ApiError(
      body.errorCode ?? "UNKNOWN_ERROR",
      body.message ?? `API error: ${res.status} ${path}`,
      res.status
    );
  }

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
    endTrip: (tripId: string) =>
      request(API_PATHS.trips.byId(tripId), {
        method: "PATCH",
        body: JSON.stringify({ action: "CANCEL" }),
      }),
    bell: {
      result: (tripId: string, body: unknown) =>
        request(API_PATHS.trips.bell.result(tripId), {
          method: "POST",
          body: JSON.stringify(body),
        }),
    },
  },
  beacons: {
    list: (routeNo: string) =>
      request<BeaconsListResponse>(API_PATHS.beacons.list(routeNo)),
  },
};