import { z } from "zod";
import { BELL_COMMAND } from "../constants/bell-command.js";
import { BELL_STATUS } from "../constants/bell-status.js";
import { BOARDING_METHOD } from "../constants/boarding-method.js";
import { TRIP_STATUS } from "../constants/trip-status.js";
import { ArrivalInfoSchema } from "./arrival.schema.js";
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
  source: z.enum(["GPS", "MOCK", "MANUAL"]).optional(),
  message: z.string(),
  timestamp: z.string(),
});
export type TripStatusResponse = z.infer<typeof TripStatusResponseSchema>;
