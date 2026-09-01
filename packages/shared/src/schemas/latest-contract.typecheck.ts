import {
  API_PATHS,
  type BoardingConfirmationRequest,
  type BoardingConfirmationResponse,
  BeaconsListResponse,
  BellResultInput,
  CreateTripRequest,
  CreateTripResponse,
  EndTripResponse,
  RoutesSearchRequest,
  RoutesSearchResponse,
  RealtimeSessionResponse,
  Station,
  StationListItem,
  TripStatusResponse,
  type UpdateTripStatusRequest,
} from "../index.js";

const boardingStation: Station = {
  stationName: "오목천역.영신여자고교.청구아파트",
  latitude: 37.242027,
  longitude: 126.962801,
};

const destinationStation: Station = {
  stationName: "수원대학교",
  latitude: 37.213789,
  longitude: 126.979749,
};

const stationList: StationListItem[] = [
  {
    stationName: "오목천역.영신여자고교.청구아파트",
    latitude: 37.242027,
    longitude: 126.962801,
    sequence: 0,
  },
  {
    stationName: "수원대학교",
    latitude: 37.213789,
    longitude: 126.979749,
    sequence: 10,
  },
];

const routesSearchRequest: RoutesSearchRequest = {
  destination: "수원대학교",
  latitude: 37.2433596329495,
  longitude: 126.963902835862,
};

const routesSearchResponse: RoutesSearchResponse = {
  success: true,
  destination: routesSearchRequest.destination,
  routes: [
    {
      candidateId: 1,
      routeNo: "700-2",
      localBusId: "234000021",
      gbisStationId: "201000166",
      boardingStation,
      destinationStation,
      stationList,
      totalTime: 30,
      totalWalk: 825,
      payment: 1650,
      busTransitCount: 1,
      busStationCount: 10,
      totalDistance: 4653,
      intervalTime: 15,
      recommendationReason: "환승이 없고 이동 구조가 단순합니다.",
      guideMessage: "700-2번 버스를 이용할 수 있습니다.",
    },
  ],
};

const createTripRequest: CreateTripRequest = {
  destination: "수원대학교",
  candidateId: 1,
  routeNo: "700-2",
  localBusId: "234000021",
  gbisStationId: "201000166",
  boardingStation,
  destinationStation,
  stationList,
  totalTime: 30,
  totalWalk: 825,
  payment: 1650,
  busTransitCount: 1,
  busStationCount: 10,
  totalDistance: 4653,
  intervalTime: 15,
};

const createTripResponse: CreateTripResponse = {
  success: true,
  tripId: "trip-001",
  routeNo: "700-2",
  localBusId: "234000021",
  gbisStationId: "201000166",
  arrivals: [
    {
      predictedArrivalMinutes: 6,
      occupancy: { type: "CONGESTION", congestionLevel: 3, remainingSeats: null },
    },
    {
      predictedArrivalMinutes: 21,
      occupancy: { type: "REMAINING_SEATS", congestionLevel: null, remainingSeats: 4 },
    },
  ],
  tripStatus: "WAITING_BUS",
  bellStatus: "NOT_REQUESTED",
  shouldTriggerBell: false,
  createdAt: "2026-07-01T14:31:00+09:00",
  message: "선택한 노선으로 운행을 생성했습니다.",
  timestamp: "2026-07-01T14:31:00+09:00",
};

const endTripResponse: EndTripResponse = {
  success: true,
  tripId: "trip-001",
  tripStatus: "CANCELLED",
  message: "운행 안내를 종료했습니다.",
  timestamp: "2026-07-01T14:45:00+09:00",
};

const updateTripStatusRequest: UpdateTripStatusRequest = {
  requestId: "location-001",
  latitude: 37.237447,
  longitude: 126.962515,
  recordedAt: "2026-07-01T14:35:00+09:00",
  source: "MOCK",
};

const userConfirmedBoardingRequest: BoardingConfirmationRequest = {
  requestId: "boarding-voice-001",
  boardingMethod: "USER_CONFIRMED",
};

const autoDetectedBoardingRequest: BoardingConfirmationRequest = {
  requestId: "boarding-ble-001",
  boardingMethod: "AUTO_DETECTED",
  detectedAt: "2026-07-01T14:34:58+09:00",
};

const boardingConfirmationResponse: BoardingConfirmationResponse = {
  success: true,
  tripId: "trip-001",
  tripStatus: "ON_BUS",
  boardingMethod: "USER_CONFIRMED",
  boardingConfirmedAt: "2026-07-01T14:35:00+09:00",
  message: "버스 탑승을 확인했습니다.",
  timestamp: "2026-07-01T14:35:00+09:00",
};

const tripStatusResponse: TripStatusResponse = {
  success: true,
  tripId: "trip-001",
  arrivals: [
    {
      predictedArrivalMinutes: 4,
      occupancy: { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null },
    },
  ],
  arrivalStatus: "AVAILABLE",
  currentStation: stationList[0]!,
  nextStation: stationList[1]!,
  remainingStations: 1,
  tripStatus: "NEAR_DESTINATION",
  boardingMethod: "USER_CONFIRMED",
  boardingConfirmedAt: "2026-07-01T14:34:30+09:00",
  bellStatus: "PENDING",
  shouldTriggerBell: true,
  bellRequestId: "bell-request-001",
  command: "STOP_REQUEST",
  guideMessage: "하차까지 한 정류장 남았습니다. 다음 정류장에서 하차하세요.",
  source: "MOCK",
  message: "이동 상태를 갱신하고 하차벨 요청을 생성했습니다.",
  timestamp: "2026-07-01T14:35:00+09:00",
};

const bellResultInput: BellResultInput = {
  bellRequestId: "bell-request-001",
  command: "STOP_REQUEST",
  result: "SUCCESS",
  resultMessage: "mock 하차벨 작동 성공",
  isMock: true,
  timestamp: "2026-07-01T14:36:05+09:00",
};

const beaconsListResponse: BeaconsListResponse = {
  success: true,
  routeNo: "700-2",
  targetBeaconId: "MOCK_BUS_7002_001",
  isMock: true,
  message: "중간평가용 mock 비콘 정보를 반환했습니다.",
  timestamp: "2026-07-01T14:32:00+09:00",
};

const realtimeSessionResponse: RealtimeSessionResponse = {
  success: true,
  clientSecret: "ek_mock",
  model: "gpt-realtime-mini",
  expiresAt: "2026-07-01T14:40:00+09:00",
  message: "Realtime 세션 키를 발급했습니다.",
  timestamp: "2026-07-01T14:30:00+09:00",
};

void routesSearchResponse;
void createTripRequest;
void createTripResponse;
void endTripResponse;
void updateTripStatusRequest;
void userConfirmedBoardingRequest;
void autoDetectedBoardingRequest;
void boardingConfirmationResponse;
void API_PATHS.trips.boarding.confirm("trip-001");
void tripStatusResponse;
void bellResultInput;
void beaconsListResponse;
void realtimeSessionResponse;
