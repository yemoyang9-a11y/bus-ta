import { Router } from "express";
import { HANEUM_REALTIME_MODEL } from "../services/realtime/config.js";
import { createRealtimeClientSecret } from "../services/realtime/create-realtime-session.service.js";

export const realtimeRouter = Router();

// POST /api/realtime/session
realtimeRouter.post("/session", async (req, res) => {
  const expectedSharedSecret = process.env["REALTIME_SHARED_SECRET"]?.trim();
  const requestSharedSecret = req.header("x-realtime-shared-secret")?.trim();

  if (expectedSharedSecret && requestSharedSecret !== expectedSharedSecret) {
    res.status(401).json({
      success: false,
      errorCode: "UNAUTHORIZED",
      message: "Realtime 세션 요청 권한이 없습니다.",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const result = await createRealtimeClientSecret({
    apiKey: process.env["OPENAI_API_KEY"],
    model: HANEUM_REALTIME_MODEL,
  });

  res.status(result.httpStatus).json(result.body);
});
