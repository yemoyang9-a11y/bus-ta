import { z } from "zod";
import { TRIP_STATUS } from "../constants/trip-status.js";

const TripStatusSchema = z.enum([
  TRIP_STATUS.WAITING_BUS,
  TRIP_STATUS.ON_BUS,
  TRIP_STATUS.NEAR_DESTINATION,
  TRIP_STATUS.TRIP_DONE,
  TRIP_STATUS.ERROR,
]);

export const CreateTripRequestSchema = z.object({
  routeId: z.string().min(1),
  boardingStationId: z.string().min(1),
  alightingStationId: z.string().min(1),
});
export type CreateTripRequest = z.infer<typeof CreateTripRequestSchema>;

export const UpdateTripRequestSchema = z.object({
  alightingStationId: z.string().min(1).optional(),
});
export type UpdateTripRequest = z.infer<typeof UpdateTripRequestSchema>;

export const UpdateTripStatusRequestSchema = z.object({
  status: TripStatusSchema,
});
export type UpdateTripStatusRequest = z.infer<typeof UpdateTripStatusRequestSchema>;

export const TripStatusResponseSchema = z.object({
  tripId: z.string(),
  status: TripStatusSchema,
  remainingStops: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type TripStatusResponse = z.infer<typeof TripStatusResponseSchema>;
