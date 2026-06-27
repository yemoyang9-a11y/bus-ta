import { RoutesSearchRequestSchema, type Route, type RoutesSearchRequest } from "@bus-ta/shared";

export interface RouteSearchProvider {
  searchRoutes(request: RoutesSearchRequest): Promise<Route[]>;
}

export interface SearchRoutesDependencies extends RouteSearchProvider {
  now?: () => string;
}

type SearchRoutesSuccessBody = {
  success: true;
  destination: string;
  routes: Route[];
  message: string;
  timestamp: string;
};

type SearchRoutesErrorBody = {
  success: false;
  errorCode: "INVALID_REQUEST" | "ROUTE_SEARCH_FAILED";
  message: string;
  timestamp: string;
};

export type SearchRoutesResult =
  | { httpStatus: 200; body: SearchRoutesSuccessBody }
  | { httpStatus: 400; body: SearchRoutesErrorBody }
  | { httpStatus: 502; body: SearchRoutesErrorBody };

const defaultNow = () => new Date().toISOString();

/**
 * POST /api/routes/search — 목적지/현재 좌표로 노선 후보를 검색한다.
 *
 * 도착 예정 시간은 여기서 조회하지 않는다. 사용자가 후보를 선택한 뒤
 * POST /api/trips 내부에서 getArrivalInfo(selectedCandidate) 로 조회한다.
 * 현재는 mock 제공자를 주입해 골격만 동작한다.
 */
export async function searchRoutes(
  input: unknown,
  dependencies: SearchRoutesDependencies,
): Promise<SearchRoutesResult> {
  const now = dependencies.now ?? defaultNow;
  const timestamp = now();

  const parsed = RoutesSearchRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      httpStatus: 400,
      body: {
        success: false,
        errorCode: "INVALID_REQUEST",
        message: "노선 검색 요청 데이터가 올바르지 않습니다.",
        timestamp,
      },
    };
  }

  let routes: Route[];
  try {
    routes = await dependencies.searchRoutes(parsed.data);
  } catch {
    return {
      httpStatus: 502,
      body: {
        success: false,
        errorCode: "ROUTE_SEARCH_FAILED",
        message: "노선 검색에 실패했습니다.",
        timestamp,
      },
    };
  }

  return {
    httpStatus: 200,
    body: {
      success: true,
      destination: parsed.data.destination,
      routes,
      message:
        routes.length > 0
          ? "노선 후보를 조회했습니다."
          : "조건에 맞는 노선 후보가 없습니다.",
      timestamp,
    },
  };
}
