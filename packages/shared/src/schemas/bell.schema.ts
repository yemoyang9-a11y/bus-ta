import { z } from "zod";
import { BELL_COMMAND } from "../constants/bell-command.js";
import { BELL_STATUS } from "../constants/bell-status.js";
import { TRIP_STATUS } from "../constants/trip-status.js";

const BellStatusSchema = z.enum([
  BELL_STATUS.NOT_REQUESTED,
  BELL_STATUS.PENDING,
  BELL_STATUS.SUCCESS,
  BELL_STATUS.FAIL,
]);

/**
 * bellRequestId: 하차벨 요청 ↔ /bell/result 결과 연결 전용
 * requestId(위치 업데이트용)와 절대 혼용하지 않는다.
 *
 * 상태 전환 책임:
 * - PATCH /trips/{tripId}/status      → remainingStations=1 & NOT_REQUESTED 감지 시 자동 PENDING 생성
 * - POST  /trips/{tripId}/bell/result → PENDING → SUCCESS | FAIL
 * - GET   조회                        → 상태 변경 없음
 */
export const BellRequestSchema = z.object({
  tripId: z.string().min(1),
  bellRequestId: z.string().min(1),
});
export type BellRequestInput = z.infer<typeof BellRequestSchema>;

export const BellResultSchema = z.object({
  bellRequestId: z.string().min(1),
  command: z.enum([BELL_COMMAND.STOP_REQUEST]),
  result: z.enum([BELL_STATUS.SUCCESS, BELL_STATUS.FAIL]),
  resultMessage: z.string().optional(),
  isMock: z.boolean().optional(),
  timestamp: z.string().min(1),
});
export type BellResultInput = z.infer<typeof BellResultSchema>;

export const BellStateResponseSchema = z.object({
  success: z.boolean(),
  tripId: z.string(),
  bellStatus: BellStatusSchema,
  tripStatus: z.enum([
    TRIP_STATUS.WAITING_BUS,
    TRIP_STATUS.ON_BUS,
    TRIP_STATUS.NEAR_DESTINATION,
    TRIP_STATUS.TRIP_DONE,
    TRIP_STATUS.CANCELLED,
    TRIP_STATUS.ERROR,
  ]),
  message: z.string(),
  timestamp: z.string(),
});
export type BellStateResponse = z.infer<typeof BellStateResponseSchema>;
