import { z } from "zod";

export const BeaconSchema = z.object({
  beaconId: z.string().min(1),
  routeNo: z.string(),
  localBusId: z.string().optional(),
  vehicleId: z.string().optional(),
  targetBeaconId: z.string().min(1),
  isMock: z.boolean(),
});
export type BeaconData = z.infer<typeof BeaconSchema>;

export const BeaconsListResponseSchema = z.object({
  success: z.boolean(),
  routeNo: z.string(),
  targetBeaconId: z.string(),
  isMock: z.boolean(),
  message: z.string(),
  timestamp: z.string(),
});
export type BeaconsListResponse = z.infer<typeof BeaconsListResponseSchema>;
