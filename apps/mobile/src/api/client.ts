import {
  API_PATHS,
  type BeaconsListResponse,
  type BoardingConfirmationRequest,
  type BoardingConfirmationResponse,
  type CreateTripRequest,
  type CreateTripResponse,
  type EndTripResponse,
  type RealtimeSessionResponse,
  type RoutesSearchRequest,
  type RoutesSearchResponse,
  type TripStatusResponse,
  type UpdateTripRequest,
  type UpdateTripStatusRequest,
} from "@bus-ta/shared";

declare const process: {
  env: {
    EXPO_PUBLIC_API_BASE_URL?: string;
  };
};

const BASE_URL = process.env["EXPO_PUBLIC_API_BASE_URL"] ?? "http://localhost:3000";

interface ApiErrorBody {
  success: false;
  errorCode: string;
  message: string;
  timestamp: string;
}

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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json");

  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch (networkError) {
    throw new ApiError(
      "NETWORK_ERROR",
      networkError instanceof Error ? networkError.message : "네트워크 연결에 실패했습니다.",
      0,
    );
  }

  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // JSON 오류 응답이 아닌 경우 기본 메시지를 사용한다.
    }

    throw new ApiError(
      body.errorCode ?? "UNKNOWN_ERROR",
      body.message ?? `API error: ${res.status} ${path}`,
      res.status,
    );
  }

  return res.json() as Promise<T>;
}

export const apiClient = {
  health: () => request(API_PATHS.health),
  routes: {
    search: (body: RoutesSearchRequest) =>
      request<RoutesSearchResponse>(API_PATHS.routes.search, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  trips: {
    create: (body: CreateTripRequest) =>
      request<CreateTripResponse>(API_PATHS.trips.create, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    getStatus: (tripId: string) =>
      request<TripStatusResponse>(API_PATHS.trips.status(tripId)),
    end: (tripId: string, body: UpdateTripRequest) =>
      request<EndTripResponse>(API_PATHS.trips.byId(tripId), {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    updateStatus: (tripId: string, body: UpdateTripStatusRequest) =>
      request<TripStatusResponse>(API_PATHS.trips.status(tripId), {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    confirmBoarding: (tripId: string, body: BoardingConfirmationRequest) =>
      request<BoardingConfirmationResponse>(API_PATHS.trips.boarding.confirm(tripId), {
        method: "POST",
        body: JSON.stringify(body),
      }),
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
    list: (routeNo: string) =>
      request<BeaconsListResponse>(API_PATHS.beacons.list(routeNo)),
  },
  realtime: {
    createSession: (sharedSecret?: string) => {
      const headers = sharedSecret ? { "x-realtime-shared-secret": sharedSecret } : undefined;
      return request<RealtimeSessionResponse>(
        API_PATHS.realtime.session,
        headers ? { method: "POST", headers } : { method: "POST" },
      );
    },
  },
};
