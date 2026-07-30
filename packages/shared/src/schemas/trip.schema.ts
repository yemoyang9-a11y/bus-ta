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

export const UpdateTripRequestSchema = z.object({
  action: z.enum(["CANCEL"]),
});
export type UpdateTripRequest = z.infer<typeof UpdateTripRequestSchema>;

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
