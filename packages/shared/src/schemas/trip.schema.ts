import { z } from "zod";
import { BELL_COMMAND } from "../constants/bell-command.js";
import { BELL_STATUS } from "../constants/bell-status.js";
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
 * 다만 현재 GBIS 어댑터는 `0` 을 절대 내보내지 않는다. GBIS 원본의
 * `remainSeatCnt=0` 이 "만석"인지 "이 차종은 좌석수를 보고하지 않음"인지
 * 응답만으로 구분할 수 없어, 어댑터가 안전한 쪽(정보 없음 → UNAVAILABLE 또는
 * CONGESTION)으로 접기 때문이다. 근거는
 * `apps/server/src/adapters/routes/hyorin-route-search.adapter.ts` 의
 * `readRemainingSeats` 주석을 참고한다.
 *
 * 즉 "지금 0 이 안 나온다"는 어댑터 층의 사정이지 계약이 금지해서가 아니다.
 * 만석을 확실히 구분할 수 있는 입력원이 생기면 그때 `0` 이 실제로 나가야 한다.
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

export const TripStatusResponseSchema = z.object({
  success: z.boolean(),
  tripId: z.string(),
  destination: z.string().optional(),
  routeNo: z.string().optional(),
  currentStation: StationSchema.nullable().optional(),
  nextStation: StationSchema.nullable().optional(),
  remainingStations: z.number().int().nonnegative(),
  tripStatus: TripStatusSchema,
  bellStatus: BellStatusSchema,
  shouldTriggerBell: z.boolean(),
  bellRequestId: z.string().optional(),
  command: z.enum([BELL_COMMAND.STOP_REQUEST]).nullable().optional(),
  guideMessage: z.string().optional(),
  source: z.enum(["GPS", "MOCK", "MANUAL"]).optional(),
  message: z.string(),
  timestamp: z.string(),
});
export type TripStatusResponse = z.infer<typeof TripStatusResponseSchema>;
