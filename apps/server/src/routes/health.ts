import { Router } from "express";
import {
  getSupabaseConnectionStatus,
  type SupabaseConnectionStatus,
} from "../config/supabase.js";

export const healthRouter = Router();

export interface HealthResponseBody {
  success: boolean;
  serverStatus: "UP";
  dbStatus: SupabaseConnectionStatus["dbStatus"];
  errorCode?: "DB_ERROR";
  message: string;
  timestamp: string;
}

export interface HealthResponse {
  httpStatus: 200 | 500;
  body: HealthResponseBody;
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
