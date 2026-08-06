import { z } from "zod";

export const RealtimeSessionResponseSchema = z.object({
  success: z.literal(true),
  clientSecret: z.string().min(1),
  model: z.string().min(1),
  expiresAt: z.string().min(1),
  message: z.string(),
  timestamp: z.string(),
});
export type RealtimeSessionResponse = z.infer<typeof RealtimeSessionResponseSchema>;
