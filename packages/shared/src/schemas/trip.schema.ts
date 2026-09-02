import { z } from "zod";
import { BELL_COMMAND } from "../constants/bell-command.js";
import { BELL_STATUS } from "../constants/bell-status.js";
import { BOARDING_METHOD } from "../constants/boarding-method.js";
import { TRIP_STATUS } from "../constants/trip-status.js";
import { StationListItemSchema, StationSchema } from "./route.schema.js";

const TripStatusSchema = z.enum([
  TRIP_STATUS.WAITING_BUS,
  TRIP_STATUS.ON_BUS,
  TRIP_STATUS.NEAR_DESTINATION,
  TRIP_STATUS.TRIP_DONE,
  TRIP_STATUS.CANCELLED,
  TRIP_STATUS.ERROR,
]);

const BellStatusSchema = z.enum([
  BELL_STATUS.NOT_REQUESTED,
  BELL_STATUS.PENDING,
  BELL_STATUS.SUCCESS,
  BELL_STATUS.FAIL,
]);

const BoardingMethodSchema = z.enum([
  BOARDING_METHOD.USER_CONFIRMED,
  BOARDING_METHOD.AUTO_DETECTED,
]);

export const CreateTripRequestSchema = z.object({
  destination: z.string().min(1),
  candidateId: z.number().int().positive(),
  routeNo: z.string().min(1),
  localBusId: z.string().min(1),
  gbisStationId: z.string().min(1),
  boardingStation: StationSchema,
  destinationStation: StationSchema,
  stationList: z.array(StationListItemSchema).min(2),
  totalTime: z.number().int().nonnegative().optional(),
  totalWalk: z.number().int().nonnegative().optional(),
  payment: z.number().int().nonnegative().optional(),
  busTransitCount: z.number().int().nonnegative().optional(),
  busStationCount: z.number().int().nonnegative().optional(),
  totalDistance: z.number().int().nonnegative().optional(),
  intervalTime: z.number().int().nonnegative().optional(),
});
export type CreateTripRequest = z.infer<typeof CreateTripRequestSchema>;

/**
 * 도착 예정 차량 한 대의 혼잡도 정보.
 *
 * type 이 어떤 값을 담고 있는지 결정한다.
 * - CONGESTION: congestionLevel 1~4, remainingSeats 는 null
 * - REMAINING_SEATS: remainingSeats 0 이상, congestionLevel 은 null
 * - UNAVAILABLE: 둘 다 null
 *
 * `remainingSeats: 0` 에 대하여 (이 필드를 좁히기 전에 반드시 읽을 것)
 *
 * 계약상 `0` 은 유효값이고 그 뜻은 "정보 없음"이 아니라 **만석**이다.
 * 그래서 스키마는 `.nonnegative()` 로 `0` 을 허용한다. 의도된 것이다.
 *
 * GBIS 공식 문서(gbis.go.kr) 확인 결과 `remainSeatCnt` 의 "정보없음" sentinel 은
 * `-1` 뿐이고 `0` 은 "0석 남음"(만석)을 뜻하는 정상 값이다. 또한 `crowded`·
 * `remainSeatCnt` 는 한 버스가 상황에 따라 둘 다 줄 수 있는 값이 아니라, 노선유형
 * (`routeTypeCd`)이 애초에 어느 필드를 채우는지를 결정한다 — 좌석형 노선유형
 * (직행좌석형시내 등)은 만석이면 실제로 `remainSeatCnt=0` 을 낸다. 어댑터는 이제
 * 노선유형이 좌석형 집합에 속하면 `remainSeatCnt` 만 읽고 `-1` 만 정보없음으로
 * 처리하므로 `0` 이 실제로 나갈 수 있다. 자세한 분기는
 * `apps/server/src/adapters/routes/hyorin-route-search.adapter.ts` 의
 * `toOccupancy` 를 참고한다.
 *
 * 이 필드를 `.positive()` 로 좁히면 계약이 허용하는 값을 거부하게 되므로 좁히지 말 것.
 */
export const OccupancySchema = z
  .object({
    type: z.enum(["CONGESTION", "REMAINING_SEATS", "UNAVAILABLE"]),
    congestionLevel: z.number().int().min(1).max(4).nullable(),
    remainingSeats: z.number().int().nonnegative().nullable(),
  })
  .superRefine((value, ctx) => {
    const expected =
      value.type === "CONGESTION"
        ? { congestionLevel: true, remainingSeats: false }
        : value.type === "REMAINING_SEATS"
          ? { congestionLevel: false, remainingSeats: true }
          : { congestionLevel: false, remainingSeats: false };

    if (expected.congestionLevel !== (value.congestionLevel !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["congestionLevel"],
        message: `occupancy.type=${value.type}에서 congestionLevel 값이 계약과 맞지 않습니다.`,
      });
    }

    if (expected.remainingSeats !== (value.remainingSeats !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remainingSeats"],
        message: `occupancy.type=${value.type}에서 remainingSeats 값이 계약과 맞지 않습니다.`,
      });
    }
  });
export type Occupancy = z.infer<typeof OccupancySchema>;

export const ArrivalInfoSchema = z.object({
  predictedArrivalMinutes: z.number().int().nonnegative(),
  occupancy: OccupancySchema,
});
export type ArrivalInfo = z.infer<typeof ArrivalInfoSchema>;

export const ArrivalStatusSchema = z.enum(["AVAILABLE", "NO_VEHICLE", "UPSTREAM_ERROR"]);
export type ArrivalStatus = z.infer<typeof ArrivalStatusSchema>;

export const CreateTripResponseSchema = z.object({
  success: z.literal(true),
  tripId: z.string().min(1),
  routeNo: z.string().min(1),
  localBusId: z.string().min(1),
  gbisStationId: z.string().min(1),
  // 도착 순서대로 최대 2대. 정보가 없으면 빈 배열이다.
  arrivals: z.array(ArrivalInfoSchema).max(2),
  tripStatus: z.literal(TRIP_STATUS.WAITING_BUS),
  bellStatus: z.literal(BELL_STATUS.NOT_REQUESTED),
  shouldTriggerBell: z.literal(false),
  createdAt: z.string().min(1),
  message: z.string(),
  timestamp: z.string(),
});
export type CreateTripResponse = z.infer<typeof CreateTripResponseSchema>;

export const UpdateTripRequestSchema = z.object({
  action: z.enum(["CANCEL"]),
});
export type UpdateTripRequest = z.infer<typeof UpdateTripRequestSchema>;

export const EndTripResponseSchema = z.object({
  success: z.literal(true),
  tripId: z.string().min(1),
  tripStatus: z.literal(TRIP_STATUS.CANCELLED),
  message: z.string(),
  timestamp: z.string(),
});
export type EndTripResponse = z.infer<typeof EndTripResponseSchema>;

export const UpdateTripStatusRequestSchema = z.object({
  requestId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  recordedAt: z.string().min(1),
  source: z.enum(["GPS", "MOCK", "MANUAL"]),
});
export type UpdateTripStatusRequest = z.infer<typeof UpdateTripStatusRequestSchema>;

export const BoardingConfirmationRequestSchema = z.discriminatedUnion("boardingMethod", [
  z
    .object({
      requestId: z.string().min(1),
      boardingMethod: z.literal(BOARDING_METHOD.USER_CONFIRMED),
    })
    .strict(),
  z
    .object({
      requestId: z.string().min(1),
      boardingMethod: z.literal(BOARDING_METHOD.AUTO_DETECTED),
      detectedAt: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
]);
export type BoardingConfirmationRequest = z.infer<typeof BoardingConfirmationRequestSchema>;

export const BoardingConfirmationResponseSchema = z.object({
  success: z.literal(true),
  tripId: z.string().min(1),
  tripStatus: z.enum([TRIP_STATUS.ON_BUS, TRIP_STATUS.NEAR_DESTINATION]),
  boardingMethod: BoardingMethodSchema,
  boardingConfirmedAt: z.string().datetime({ offset: true }),
  message: z.string(),
  timestamp: z.string().datetime({ offset: true }),
});
export type BoardingConfirmationResponse = z.infer<typeof BoardingConfirmationResponseSchema>;

export const TripStatusResponseSchema = z.object({
  success: z.boolean(),
  tripId: z.string(),
  destination: z.string().optional(),
  routeNo: z.string().optional(),
  // 도착정보 재조회는 GET /status 에만 있다. PATCH /status 응답도 같은 타입으로
  // 다루므로(apps/mobile/src/api/client.ts) 필수로 두면 계약이 거짓이 된다.
  arrivals: z.array(ArrivalInfoSchema).optional(),
  arrivalStatus: ArrivalStatusSchema.optional(),
  /**
   * 앱이 다음 도착정보 조회까지 기다릴 시간(ms).
   *
   * 주기를 앱이 스스로 정하면 서버의 GBIS 호출 정책과 어긋난다. 서버가 남은 시간에
   * 맞춰 정해 내려준다. 값이 없으면 앱은 반복 조회를 하지 않는다.
   *
   * arrivals·arrivalStatus 와 같은 범위다 — GET /status 의 WAITING_BUS 응답에만 있고
   * PATCH /status 에는 없다.
   */
  nextArrivalRefreshInMs: z.number().int().nonnegative().optional(),
  /**
   * 스마트지팡이 비콘 스캔을 시작해야 하는지.
   *
   * 탑승 확정 전(WAITING_BUS)에만 참이 될 수 있다. 한 번 켜면 끄지 않는 것은 앱
   * 책임이다 — 앞차가 떠나면 도착 예정 시간이 다시 늘어나는데, 그때 끄면 정작
   * 버스가 눈앞에 왔을 때 스캔이 꺼져 있다.
   */
  shouldScanBeacon: z.boolean().optional(),
  currentStation: StationSchema.nullable().optional(),
  nextStation: StationSchema.nullable().optional(),
  remainingStations: z.number().int().nonnegative(),
  tripStatus: TripStatusSchema,
  boardingMethod: BoardingMethodSchema.nullable(),
  boardingConfirmedAt: z.string().datetime({ offset: true }).nullable(),
  bellStatus: BellStatusSchema,
  shouldTriggerBell: z.boolean(),
  bellRequestId: z.string().optional(),
  command: z.enum([BELL_COMMAND.STOP_REQUEST]).nullable().optional(),
  guideMessage: z.string().optional(),
  locationStatus: z.literal("STALE").optional(),
  locationGapSeconds: z.number().int().nonnegative().optional(),
  locationWarning: z.string().optional(),
  source: z.enum(["GPS", "MOCK", "MANUAL"]).optional(),
  message: z.string(),
  timestamp: z.string(),
});
export type TripStatusResponse = z.infer<typeof TripStatusResponseSchema>;
