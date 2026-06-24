import { z } from "zod";

/**
 * requestId: GPS/mock 위치 업데이트 중복 요청 판정 전용
 * bellRequestId 와 절대 혼용하지 않는다.
 */
export const LocationUpdateSchema = z.object({
  tripId: z.string().min(1),
  requestId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
  timestamp: z.string().datetime(),
});
export type LocationUpdateInput = z.infer<typeof LocationUpdateSchema>;
