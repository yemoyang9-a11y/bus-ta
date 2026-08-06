import { z } from "zod";

const HealthTimestampSchema = z.string().datetime({ offset: true });

export const DbStatusSchema = z.enum(["UP", "NOT_CONFIGURED", "DOWN"]);
export type DbStatus = z.infer<typeof DbStatusSchema>;

export const HealthSuccessResponseSchema = z
  .object({
    success: z.literal(true),
    serverStatus: z.literal("UP"),
    dbStatus: z.enum(["UP", "NOT_CONFIGURED"]),
    message: z.string(),
    timestamp: HealthTimestampSchema,
  })
  .strict();
export type HealthSuccessResponse = z.infer<typeof HealthSuccessResponseSchema>;

export const HealthErrorResponseSchema = z
  .object({
    success: z.literal(false),
    serverStatus: z.literal("UP"),
    dbStatus: z.literal("DOWN"),
    errorCode: z.literal("DB_ERROR"),
    message: z.string(),
    timestamp: HealthTimestampSchema,
  })
  .strict();
export type HealthErrorResponse = z.infer<typeof HealthErrorResponseSchema>;

export const HealthResponseSchema = z.union([
  HealthSuccessResponseSchema,
  HealthErrorResponseSchema,
]);
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
