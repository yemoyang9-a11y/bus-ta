import { randomUUID } from "node:crypto";
import {
  ArrivalInfoSchema,
  BELL_STATUS,
  CreateTripRequestSchema,
  TRIP_STATUS,
  type ArrivalInfo,
  type CreateTripRequest,
} from "@bus-ta/shared";

type CreateTripStation = CreateTripRequest["boardingStation"];
type CreateTripStationListItem = CreateTripRequest["stationList"][number];

export interface TripCreateRecord {
  tripId: string;
  destination: string;
  candidateId: number;
  routeNo: string;
  localBusId: string;
  gbisStationId: string;
  vehicleId: string | null;
  boardingStation: CreateTripStation;
  destinationStation: CreateTripStation;
  stationList: CreateTripStationListItem[];
  totalTime: number | null;
  totalWalk: number | null;
  payment: number | null;
  busTransitCount: number | null;
  busStationCount: number | null;
  totalDistance: number | null;
  intervalTime: number | null;
  predictedArrivalMinutes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TripStatusCreateRecord {
  tripId: string;
  currentStation: CreateTripStation | null;
  nextStation: CreateTripStation | null;
  remainingStations: number;
  tripStatus: typeof TRIP_STATUS.WAITING_BUS;
  bellStatus: typeof BELL_STATUS.NOT_REQUESTED;
  lastRequestId: string | null;
  locationSource: string | null;
  recordedAt: string | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  locationChangedAt: string | null;
  updatedAt: string;
}

export interface CreateTripWithStatusInput {
  trip: TripCreateRecord;
  status: TripStatusCreateRecord;
}

export interface TripCreationRepository {
  createTripWithStatus(data: CreateTripWithStatusInput): Promise<void>;
}

export interface CreateTripDependencies extends TripCreationRepository {
  getArrivals?: (selectedCandidate: CreateTripRequest) => Promise<ArrivalInfo[]>;
  generateTripId?: () => string;
  now?: () => string;
}

// 응답에 담는 도착 예정 차량 수 상한 (계약 5.2-A)
const MAX_ARRIVALS = 2;

type CreateTripSuccessBody = {
  success: true;
  tripId: string;
  routeNo: string;
  localBusId: string;
  gbisStationId: string;
  arrivals: ArrivalInfo[];
  tripStatus: typeof TRIP_STATUS.WAITING_BUS;
  bellStatus: typeof BELL_STATUS.NOT_REQUESTED;
  shouldTriggerBell: false;
  createdAt: string;
  message: string;
  timestamp: string;
};

type CreateTripErrorBody = {
  success: false;
  errorCode: "INVALID_REQUEST" | "INVALID_STATION_LIST" | "DB_ERROR";
  message: string;
  timestamp: string;
};

export type CreateTripResult =
  | { httpStatus: 201; body: CreateTripSuccessBody }
  | { httpStatus: 400; body: CreateTripErrorBody }
  | { httpStatus: 500; body: CreateTripErrorBody };

const defaultNow = () => new Date().toISOString();
const defaultGenerateTripId = () => `trip-${randomUUID()}`;
const defaultArrivalLookup = async (): Promise<ArrivalInfo[]> => [];

export async function createTrip(
  input: unknown,
  dependencies: CreateTripDependencies,
): Promise<CreateTripResult> {
  const now = dependencies.now ?? defaultNow;
  const timestamp = now();
  const parsed = CreateTripRequestSchema.safeParse(input);

  if (!parsed.success) {
    return {
      httpStatus: 400,
      body: {
        success: false,
        errorCode: "INVALID_REQUEST",
        message: "요청 데이터가 올바르지 않습니다.",
        timestamp,
      },
    };
  }

  const stationListValidation = validateStationList(parsed.data);
  if (stationListValidation) {
    return {
      httpStatus: 400,
      body: {
        success: false,
        errorCode: "INVALID_STATION_LIST",
        message: stationListValidation,
        timestamp,
      },
    };
  }

  const tripId = (dependencies.generateTripId ?? defaultGenerateTripId)();
  const arrivals = await readArrivals(
    parsed.data,
    dependencies.getArrivals ?? defaultArrivalLookup,
  );
  // trips.predicted_arrival_minutes 는 단일 컬럼이라 첫 번째 차량만 저장한다.
  // occupancy 는 응답 전용이며 저장하지 않는다.
  const predictedArrivalMinutes = arrivals[0]?.predictedArrivalMinutes ?? null;

  const trip: TripCreateRecord = {
    tripId,
    destination: parsed.data.destination,
    candidateId: parsed.data.candidateId,
    routeNo: parsed.data.routeNo,
    localBusId: parsed.data.localBusId,
    gbisStationId: parsed.data.gbisStationId,
    vehicleId: null,
    boardingStation: parsed.data.boardingStation,
    destinationStation: parsed.data.destinationStation,
    stationList: parsed.data.stationList,
    totalTime: parsed.data.totalTime ?? null,
    totalWalk: parsed.data.totalWalk ?? null,
    payment: parsed.data.payment ?? null,
    busTransitCount: parsed.data.busTransitCount ?? null,
    busStationCount: parsed.data.busStationCount ?? null,
    totalDistance: parsed.data.totalDistance ?? null,
    intervalTime: parsed.data.intervalTime ?? null,
    predictedArrivalMinutes,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const status: TripStatusCreateRecord = {
    tripId,
    currentStation: null,
    nextStation: parsed.data.boardingStation,
    remainingStations: parsed.data.stationList.length - 1,
    tripStatus: TRIP_STATUS.WAITING_BUS,
    bellStatus: BELL_STATUS.NOT_REQUESTED,
    lastRequestId: null,
    locationSource: null,
    recordedAt: null,
    lastLatitude: null,
    lastLongitude: null,
    locationChangedAt: null,
    updatedAt: timestamp,
  };

  try {
    await dependencies.createTripWithStatus({ trip, status });
  } catch {
    return {
      httpStatus: 500,
      body: {
        success: false,
        errorCode: "DB_ERROR",
        message: "운행 정보를 저장하지 못했습니다.",
        timestamp,
      },
    };
  }

  return {
    httpStatus: 201,
    body: {
      success: true,
      tripId,
      routeNo: parsed.data.routeNo,
      localBusId: parsed.data.localBusId,
      gbisStationId: parsed.data.gbisStationId,
      arrivals,
      tripStatus: TRIP_STATUS.WAITING_BUS,
      bellStatus: BELL_STATUS.NOT_REQUESTED,
      shouldTriggerBell: false,
      createdAt: timestamp,
      message: "선택한 노선으로 운행을 생성했습니다.",
      timestamp,
    },
  };
}

/**
 * GBIS 조회는 실패하거나 계약과 다른 값을 줄 수 있다.
 * 어느 쪽이든 운행 생성은 막지 않고, 계약을 통과한 항목만 최대 2개까지 남긴다.
 */
async function readArrivals(
  selectedCandidate: CreateTripRequest,
  lookup: (selectedCandidate: CreateTripRequest) => Promise<ArrivalInfo[]>,
): Promise<ArrivalInfo[]> {
  try {
    const value = await lookup(selectedCandidate);
    if (!Array.isArray(value)) return [];

    return value
      .flatMap((arrival) => {
        const result = ArrivalInfoSchema.safeParse(arrival);
        return result.success ? [result.data] : [];
      })
      .slice(0, MAX_ARRIVALS);
  } catch {
    return [];
  }
}

function validateStationList(data: CreateTripRequest): string | null {
  const first = data.stationList[0];
  const last = data.stationList[data.stationList.length - 1];

  if (!first || !sameStation(data.boardingStation, first)) {
    return "boardingStation은 stationList의 첫 정류장과 일치해야 합니다.";
  }

  if (!last || !sameStation(data.destinationStation, last)) {
    return "destinationStation은 stationList의 마지막 정류장과 일치해야 합니다.";
  }

  if (sameStation(data.boardingStation, data.destinationStation)) {
    return "탑승 정류장과 목적지 정류장은 서로 달라야 합니다.";
  }

  for (let i = 1; i < data.stationList.length; i += 1) {
    const previous = data.stationList[i - 1]!;
    const current = data.stationList[i]!;

    if (current.sequence <= previous.sequence) {
      return "stationList의 sequence는 오름차순이어야 합니다.";
    }
  }

  const seen = new Set<string>();
  for (const station of data.stationList) {
    const key = `${station.stationName}:${station.latitude}:${station.longitude}`;
    if (seen.has(key)) {
      return "stationList에는 동일한 정류장 이름과 좌표가 중복될 수 없습니다.";
    }
    seen.add(key);
  }

  return null;
}

function sameStation(left: CreateTripStation, right: CreateTripStation) {
  return (
    left.stationName === right.stationName &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude
  );
}
