import {
  BELL_STATUS,
  DEMO_ROUTE,
  TRIP_STATUS,
  type CreateTripRequest,
  type CreateTripResponse,
  type EndTripResponse,
  type RoutesSearchRequest,
  type RoutesSearchResponse,
  type TripStatusResponse,
  type UpdateTripRequest,
} from "@bus-ta/shared";

const MOCK_TRIP_ID = "trip-realtime-mock-001";
const MOCK_CREATED_AT = "2026-07-30T17:30:00+09:00";

export const REALTIME_MOCK_DESTINATION = "병점역후문";

export const realtimeMockFunctionClient = {
  async searchRoutes(body: RoutesSearchRequest): Promise<RoutesSearchResponse> {
    return {
      success: true,
      destination: body.destination || REALTIME_MOCK_DESTINATION,
      routes: [
        {
          ...DEMO_ROUTE,
          recommendationReason: "환승 없이 한 번에 이동할 수 있어 추천합니다.",
          guideMessage: "1551번 버스를 타면 병점역후문까지 갈 수 있습니다.",
        },
      ],
      message: "mock 경로 후보를 반환했습니다.",
      timestamp: now(),
    };
  },

  async createTrip(body: CreateTripRequest): Promise<CreateTripResponse> {
    return {
      success: true,
      tripId: MOCK_TRIP_ID,
      routeNo: body.routeNo,
      localBusId: body.localBusId,
      gbisStationId: body.gbisStationId,
      predictedArrivalMinutes: 6,
      tripStatus: TRIP_STATUS.WAITING_BUS,
      bellStatus: BELL_STATUS.NOT_REQUESTED,
      shouldTriggerBell: false,
      createdAt: MOCK_CREATED_AT,
      message: "mock 운행 안내를 생성했습니다.",
      timestamp: now(),
    };
  },

  async getTripStatus(tripId: string): Promise<TripStatusResponse> {
    return {
      success: true,
      tripId,
      destination: REALTIME_MOCK_DESTINATION,
      routeNo: DEMO_ROUTE.routeNo,
      currentStation: DEMO_ROUTE.stationList[8] ?? null,
      nextStation: DEMO_ROUTE.stationList[9] ?? null,
      remainingStations: 1,
      tripStatus: TRIP_STATUS.NEAR_DESTINATION,
      bellStatus: BELL_STATUS.PENDING,
      shouldTriggerBell: true,
      bellRequestId: "bell-realtime-mock-001",
      command: "STOP_REQUEST",
      guideMessage: "하차까지 한 정류장 남았습니다. 다음 정류장에서 하차하세요.",
      source: "MOCK",
      message: "mock 이동 상태를 조회했습니다.",
      timestamp: now(),
    };
  },

  async endTrip(tripId: string, body: UpdateTripRequest): Promise<EndTripResponse> {
    if (body.action !== "CANCEL") {
      throw new Error("mock 운행 종료는 CANCEL만 지원합니다.");
    }

    return {
      success: true,
      tripId,
      tripStatus: TRIP_STATUS.CANCELLED,
      message: "mock 운행 안내를 종료했습니다.",
      timestamp: now(),
    };
  },
};

export function shouldUseRealtimeMockFunctions() {
  return process.env["EXPO_PUBLIC_REALTIME_USE_MOCK"] === "true";
}

function now() {
  return new Date().toISOString();
}
