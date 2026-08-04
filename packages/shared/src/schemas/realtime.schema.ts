import { z } from "zod";
import { REALTIME_MODEL, REALTIME_SESSION_ERROR_CODES } from "../constants/realtime.js";

const IsoTimestampSchema = z.string().datetime({ offset: true });

export const RealtimeSessionSuccessResponseSchema = z.object({
  success: z.literal(true),
  clientSecret: z.string().min(1),
  model: z.literal(REALTIME_MODEL),
  expiresAt: IsoTimestampSchema,
  message: z.string(),
  timestamp: IsoTimestampSchema,
});
export type RealtimeSessionSuccessResponse = z.infer<
  typeof RealtimeSessionSuccessResponseSchema
>;

export const RealtimeSessionErrorResponseSchema = z.object({
  success: z.literal(false),
  errorCode: z.enum([
    REALTIME_SESSION_ERROR_CODES.UNAUTHORIZED,
    REALTIME_SESSION_ERROR_CODES.REALTIME_SESSION_FAILED,
  ]),
  message: z.string(),
  timestamp: IsoTimestampSchema,
});
export type RealtimeSessionErrorResponse = z.infer<typeof RealtimeSessionErrorResponseSchema>;

export const RealtimeSessionResponseSchema = z.union([
  RealtimeSessionSuccessResponseSchema,
  RealtimeSessionErrorResponseSchema,
]);
export type RealtimeSessionResponse = z.infer<typeof RealtimeSessionResponseSchema>;
