import { z } from "zod";

export const RoutesSearchRequestSchema = z.object({
  destination: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type RoutesSearchRequest = z.infer<typeof RoutesSearchRequestSchema>;

export const StationSchema = z.object({
  stationName: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  sequence: z.number().int().nonnegative().optional(),
});

export const StationListItemSchema = StationSchema.extend({
  sequence: z.number().int().nonnegative(),
});

export const RouteCandidateSchema = z.object({
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
  recommendationReason: z.string().optional(),
  guideMessage: z.string().optional(),
});

export const RoutesSearchResponseSchema = z.object({
  success: z.boolean(),
  destination: z.string(),
  routes: z.array(RouteCandidateSchema),
  message: z.string().optional(),
  timestamp: z.string().optional(),
});
export type RoutesSearchResponse = z.infer<typeof RoutesSearchResponseSchema>;
