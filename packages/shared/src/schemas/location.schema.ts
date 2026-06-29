import { z } from "zod";

/**
 * requestId: GPS/mock 위치 업데이트 중복 요청 판정 전용
 * bellRequestId 와 절대 혼용하지 않는다.
 */
export const LocationUpdateSchema = z.object({
  tripId: z.string().min(1),
  requestId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  recordedAt: z.string().min(1),
  source: z.enum(["GPS", "MOCK", "MANUAL"]),
});
export type LocationUpdateInput = z.infer<typeof LocationUpdateSchema>;
