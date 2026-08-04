import { REALTIME_SHARED_SECRET_HEADER } from "@bus-ta/shared";
import { Router } from "express";
import {
  createRealtimeSession,
  type RealtimeSessionServiceDependencies,
} from "../services/realtime/realtime-session.service.js";

export interface RealtimeRouterConfig {
  configuredSharedSecret?: string;
  openAiApiKey?: string;
}

export interface RealtimeRouterDependencies extends RealtimeSessionServiceDependencies {
  getConfig?: () => RealtimeRouterConfig;
}

function readConfigFromEnvironment(): RealtimeRouterConfig {
  const config: RealtimeRouterConfig = {};
  const configuredSharedSecret = process.env["REALTIME_SHARED_SECRET"];
  const openAiApiKey = process.env["OPENAI_API_KEY"];

  if (configuredSharedSecret !== undefined) {
    config.configuredSharedSecret = configuredSharedSecret;
  }
  if (openAiApiKey !== undefined) {
    config.openAiApiKey = openAiApiKey;
  }

  return config;
}

export function createRealtimeRouter(
  dependencies: RealtimeRouterDependencies = {},
): Router {
  const router = Router();

  // POST /api/realtime/session (the router is mounted at the complete path)
  router.post("/", async (req, res) => {
    const config = (dependencies.getConfig ?? readConfigFromEnvironment)();
    const providedSharedSecret = req.get(REALTIME_SHARED_SECRET_HEADER);
    const result = await createRealtimeSession(
      {
        ...(providedSharedSecret === undefined ? {} : { providedSharedSecret }),
        ...(config.configuredSharedSecret === undefined
          ? {}
          : { configuredSharedSecret: config.configuredSharedSecret }),
        ...(config.openAiApiKey === undefined ? {} : { openAiApiKey: config.openAiApiKey }),
      },
      dependencies,
    );

    res.status(result.httpStatus).json(result.body);
  });

  return router;
}

export const realtimeRouter = createRealtimeRouter();
