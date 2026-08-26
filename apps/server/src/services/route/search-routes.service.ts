import {
  RoutesSearchRequestSchema,
  type ArrivalInfo,
  type Route,
  type RoutesSearchRequest,
} from "@bus-ta/shared";
import { generateRouteGuide, type RouteGuideResult } from "../guide.js";

export interface RouteSearchProvider {
  searchRoutes(request: RoutesSearchRequest): Promise<Route[]>;
}

export interface RouteGuideProvider {
  generateRouteGuide(input: { destination: string; candidates: Route[] }): Promise<RouteGuideResult>;
}

/**
 * 추천 후보의 도착 예정 시간을 채운다.
 *
 * 후보 전체가 아니라 안내할 2개에만 붙이므로 호출 비용이 크지 않다. 게다가 두
 * 후보가 같은 정류장에서 타는 경우가 많아(예: 3411·341 모두 123000039) 실제
 * GBIS 호출은 대개 1~2회로 끝난다.
 */
export interface ArrivalProvider {
  getArrivals(candidate: Pick<Route, "gbisStationId" | "localBusId">): Promise<ArrivalInfo[]>;
}

export interface SearchRoutesDependencies extends RouteSearchProvider {
  generateRouteGuide?: RouteGuideProvider["generateRouteGuide"];
  getArrivals?: ArrivalProvider["getArrivals"];
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
 * 안내할 후보에 도착 예정 시간을 붙인다.
 *
 * 같은 정류장·같은 노선이면 한 번만 조회해 재사용한다. 조회에 실패한 후보는
 * arrivals 를 생략하고 나머지 안내는 그대로 진행한다 — 도착 시간을 못 얻었다고
 * 노선 자체를 못 알려주면 사용자는 탈 버스를 잃는다.
 */
async function attachArrivals(
  routes: Route[],
  getArrivals: ArrivalProvider["getArrivals"],
): Promise<Route[]> {
  const byTarget = new Map<string, Promise<ArrivalInfo[] | null>>();

  const lookup = (route: Route) => {
    const key = `${route.gbisStationId}:${route.localBusId}`;
    const cached = byTarget.get(key);
    if (cached) return cached;

    const pending = getArrivals({
      gbisStationId: route.gbisStationId,
      localBusId: route.localBusId,
    }).catch((error: unknown) => {
      console.error(
        "[routes/search] 후보 도착정보 조회 실패, 도착 시간 없이 안내한다",
        `station=${route.gbisStationId}`,
        `route=${route.localBusId}`,
        `message=${error instanceof Error ? error.message : "unknown"}`,
      );
      return null;
    });

    byTarget.set(key, pending);
    return pending;
  };

  const arrivalsPerRoute = await Promise.all(routes.map(lookup));

  return routes.map((route, index) => {
    const arrivals = arrivalsPerRoute[index];
    return arrivals ? { ...route, arrivals } : route;
  });
}

/**
 * POST /api/routes/search — 목적지/현재 좌표로 노선 후보를 검색한다.
 *
 * 안내할 후보 2개에 한해 도착 예정 시간을 함께 조회한다. 사용자가 노선을 고르기
 * 전에도 "몇 분 뒤에 오는지"를 알아야 선택할 수 있기 때문이다. 탑승 안내에 쓰는
 * 값은 여기 값이 아니라 POST /api/trips 응답의 arrivals 를 다시 사용한다.
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

  // 도착정보 조회기가 주입된 경우에만 붙인다. 주입하지 않으면 기존 계약 그대로
  // arrivals 없이 응답한다.
  const routesWithArrivals =
    dependencies.getArrivals && guideRoutes.length > 0
      ? await attachArrivals(guideRoutes, dependencies.getArrivals)
      : guideRoutes;

  return {
    httpStatus: 200,
    body: {
      success: true,
      destination: parsed.data.destination,
      routes: routesWithArrivals,
      message:
        guideRoutes.length > 0
          ? "노선 후보를 조회했습니다."
          : "조건에 맞는 노선 후보가 없습니다.",
      timestamp,
    },
  };
}
