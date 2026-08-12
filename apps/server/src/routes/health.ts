import { Router } from "express";
import { type HealthResponse as SharedHealthResponse } from "@bus-ta/shared";
import {
  getSupabaseConnectionStatus,
  type SupabaseConnectionStatus,
} from "../config/supabase.js";

export const healthRouter = Router();

export interface HealthResponse {
  httpStatus: 200 | 500;
  body: SharedHealthResponse;
}

export function buildHealthResponse(
  dbConnection: SupabaseConnectionStatus,
  timestamp = new Date().toISOString(),
): HealthResponse {
  if (dbConnection.dbStatus === "DOWN") {
    return {
      httpStatus: 500,
      body: {
        success: false,
        serverStatus: "UP",
        dbStatus: dbConnection.dbStatus,
        errorCode: "DB_ERROR",
        message: dbConnection.message,
        timestamp,
      },
    };
  }

  return {
    httpStatus: 200,
    body: {
      success: true,
      serverStatus: "UP",
      dbStatus: dbConnection.dbStatus,
      message: "Server is running",
      timestamp,
    },
  };
}

// GET /api/health
healthRouter.get("/", async (_req, res) => {
  const dbConnection = await getSupabaseConnectionStatus();
  const response = buildHealthResponse(dbConnection);

  res.status(response.httpStatus).json(response.body);
});
