import { z } from "zod";

export const BeaconSchema = z.object({
  beaconId: z.string().min(1),
  routeId: z.string().min(1),
  currentStationId: z.string().nullable(),
  routeNo: z.string(),
  lastSeenAt: z.string().datetime().nullable(),
});
export type BeaconData = z.infer<typeof BeaconSchema>;

export const BeaconsListResponseSchema = z.object({
  beacons: z.array(BeaconSchema),
});
export type BeaconsListResponse = z.infer<typeof BeaconsListResponseSchema>;
