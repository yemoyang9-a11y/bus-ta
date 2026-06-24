import { z } from "zod";

export const RoutesSearchRequestSchema = z.object({
  originName: z.string().min(1),
  originLat: z.number(),
  originLng: z.number(),
  destinationName: z.string().min(1),
  destinationLat: z.number(),
  destinationLng: z.number(),
});
export type RoutesSearchRequest = z.infer<typeof RoutesSearchRequestSchema>;

export const StationSchema = z.object({
  stationId: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  sequence: z.number().int().nonnegative(),
  routeId: z.string(),
});

export const RouteSchema = z.object({
  routeId: z.string(),
  routeNo: z.string(),
  routeName: z.string(),
  stations: z.array(StationSchema),
});

export const RoutesSearchResponseSchema = z.object({
  routes: z.array(RouteSchema),
});
export type RoutesSearchResponse = z.infer<typeof RoutesSearchResponseSchema>;
