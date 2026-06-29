import type { Beacon } from "@bus-ta/shared";

export interface GetBeaconRepository {
  findByRouteNo(routeNo: string): Promise<Beacon | null>;
}

export interface GetBeaconDependencies extends GetBeaconRepository {
  now?: () => string;
}

type GetBeaconSuccessBody = {
  success: true;
  routeNo: string;
  targetBeaconId: string;
  isMock: boolean;
  message: string;
  timestamp: string;
};

type GetBeaconErrorBody = {
  success: false;
  errorCode: "INVALID_REQUEST" | "BEACON_NOT_FOUND" | "DB_ERROR";
  message: string;
  timestamp: string;
};

export type GetBeaconResult =
  | { httpStatus: 200; body: GetBeaconSuccessBody }
  | { httpStatus: 400; body: GetBeaconErrorBody }
  | { httpStatus: 404; body: GetBeaconErrorBody }
  | { httpStatus: 500; body: GetBeaconErrorBody };

const defaultNow = () => new Date().toISOString();

/**
 * GET /api/beacons?routeNo= — 노선번호로 mock 비콘의 targetBeaconId 를 조회한다.
 * 중간평가에서는 fixture 기반 mock targetBeaconId 를 반환한다.
 */
export async function getBeaconByRoute(
  routeNo: unknown,
  dependencies: GetBeaconDependencies,
): Promise<GetBeaconResult> {
  const now = dependencies.now ?? defaultNow;
  const timestamp = now();

  if (typeof routeNo !== "string" || routeNo.trim() === "") {
    return {
      httpStatus: 400,
      body: {
        success: false,
        errorCode: "INVALID_REQUEST",
        message: "routeNo 쿼리 파라미터가 필요합니다.",
        timestamp,
      },
    };
  }

  const normalizedRouteNo = routeNo.trim();

  let beacon: Beacon | null;
  try {
    beacon = await dependencies.findByRouteNo(normalizedRouteNo);
  } catch {
    return {
      httpStatus: 500,
      body: {
        success: false,
        errorCode: "DB_ERROR",
        message: "비콘 정보를 조회하지 못했습니다.",
        timestamp,
      },
    };
  }

  if (!beacon) {
    return {
      httpStatus: 404,
      body: {
        success: false,
        errorCode: "BEACON_NOT_FOUND",
        message: "해당 노선의 비콘을 찾을 수 없습니다.",
        timestamp,
      },
    };
  }

  return {
    httpStatus: 200,
    body: {
      success: true,
      routeNo: beacon.routeNo,
      targetBeaconId: beacon.targetBeaconId,
      isMock: beacon.isMock,
      message: "비콘 정보를 조회했습니다.",
      timestamp,
    },
  };
}
