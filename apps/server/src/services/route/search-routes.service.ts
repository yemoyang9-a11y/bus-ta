import { RoutesSearchRequestSchema, type Route, type RoutesSearchRequest } from "@bus-ta/shared";
import { generateRouteGuide, type RouteGuideResult } from "../guide.js";

export interface RouteSearchProvider {
  searchRoutes(request: RoutesSearchRequest): Promise<Route[]>;
}

export interface RouteGuideProvider {
  generateRouteGuide(input: { destination: string; candidates: Route[] }): Promise<RouteGuideResult>;
}

export interface SearchRoutesDependencies extends RouteSearchProvider {
  generateRouteGuide?: RouteGuideProvider["generateRouteGuide"];
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
 * 502 로 응답하기 전에 실패 원인을 남긴다.
 *
 * 오류 객체를 통째로 찍으면 AxiosError 의 `config` 에 실린 API 키가 로그로 샌다.
 * 진단에 필요한 값(어느 upstream, 어떤 상태 코드, 메시지)만 골라서 남긴다.
 */
function logRouteSearchFailure(error: unknown): void {
  const detail = error as { upstream?: unknown; status?: unknown; message?: unknown };
  console.error(
    "[routes/search] 외부 API 요청 실패",
    `upstream=${typeof detail.upstream === "string" ? detail.upstream : "UNKNOWN"}`,
    `status=${typeof detail.status === "number" ? detail.status : "unknown"}`,
    `message=${typeof detail.message === "string" ? detail.message : "unknown"}`,
  );
}

function attachGuideMessages(routes: Route[], guideResult: RouteGuideResult): Route[] {
  const routeById = new Map(routes.map((route) => [route.candidateId, route]));
  const selectedRoutes = guideResult.selectedCandidates
    .flatMap((selected): Route[] => {
      const route = routeById.get(selected.candidateId);
      if (!route) return [];
      const { recommendationReason: _recommendationReason, ...routeWithoutReason } = route;

      return [
        {
          ...routeWithoutReason,
          guideMessage: selected.guideMessage,
        },
      ];
    })
    .slice(0, 2);

  if (selectedRoutes.length > 0) {
    return selectedRoutes;
  }

  return routes.slice(0, 2).map((route) => {
    const { recommendationReason: _recommendationReason, ...routeWithoutReason } = route;
    return routeWithoutReason;
  });
}

/**
 * POST /api/routes/search — 목적지/현재 좌표로 노선 후보를 검색한다.
 *
 * 도착 예정 시간은 여기서 조회하지 않는다. 사용자가 후보를 선택한 뒤
 * POST /api/trips 내부에서 getArrivalInfo(selectedCandidate) 로 조회한다.
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
  } catch (error) {
    logRouteSearchFailure(error);
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

  const guideRoutes =
    routes.length > 0
      ? attachGuideMessages(
          routes,
          await (dependencies.generateRouteGuide ?? generateRouteGuide)({
            destination: parsed.data.destination,
            candidates: routes,
          }),
        )
      : [];

  return {
    httpStatus: 200,
    body: {
      success: true,
      destination: parsed.data.destination,
      routes: guideRoutes,
      message:
        guideRoutes.length > 0
          ? "노선 후보를 조회했습니다."
          : "조건에 맞는 노선 후보가 없습니다.",
      timestamp,
    },
  };
}
