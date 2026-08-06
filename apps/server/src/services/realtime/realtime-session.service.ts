import {
  REALTIME_MODEL,
  REALTIME_SESSION_ERROR_CODES,
  type RealtimeSessionErrorResponse,
  type RealtimeSessionSuccessResponse,
} from "@bus-ta/shared";
import {
  createRealtimeClientSecretAdapter,
  type RealtimeClientSecretAdapter,
  type RealtimeClientSecretPayload,
  type RealtimeFetch,
} from "../../adapters/realtime/openai-realtime.adapter.js";

export interface RealtimeSessionServiceInput {
  providedSharedSecret?: string;
  configuredSharedSecret?: string;
  openAiApiKey?: string;
}

export interface RealtimeSessionServiceDependencies {
  fetch?: RealtimeFetch;
  createClientSecret?: RealtimeClientSecretAdapter["createClientSecret"];
  now?: () => string;
}

export type RealtimeSessionServiceResult =
  | { httpStatus: 200; body: RealtimeSessionSuccessResponse }
  | { httpStatus: 401; body: RealtimeSessionErrorResponse }
  | { httpStatus: 502; body: RealtimeSessionErrorResponse };

const defaultNow = () => new Date().toISOString();

function failedResponse(
  timestamp: string,
): { httpStatus: 502; body: RealtimeSessionErrorResponse } {
  return {
    httpStatus: 502,
    body: {
      success: false,
      errorCode: REALTIME_SESSION_ERROR_CODES.REALTIME_SESSION_FAILED,
      message: "Realtime 세션 단기 키를 발급하지 못했습니다.",
      timestamp,
    },
  };
}

function unauthorizedResponse(
  timestamp: string,
): { httpStatus: 401; body: RealtimeSessionErrorResponse } {
  return {
    httpStatus: 401,
    body: {
      success: false,
      errorCode: REALTIME_SESSION_ERROR_CODES.UNAUTHORIZED,
      message: "Realtime 세션 공유 시크릿이 올바르지 않습니다.",
      timestamp,
    },
  };
}

function isUsableEpochSeconds(value: number) {
  if (!Number.isInteger(value) || value <= 0) return false;
  return !Number.isNaN(new Date(value * 1000).getTime());
}

export async function createRealtimeSession(
  input: RealtimeSessionServiceInput,
  dependencies: RealtimeSessionServiceDependencies = {},
): Promise<RealtimeSessionServiceResult> {
  const timestamp = (dependencies.now ?? defaultNow)();

  if (
    typeof input.configuredSharedSecret !== "string" ||
    input.configuredSharedSecret.length === 0 ||
    input.providedSharedSecret !== input.configuredSharedSecret
  ) {
    return unauthorizedResponse(timestamp);
  }

  if (typeof input.openAiApiKey !== "string" || input.openAiApiKey.trim().length === 0) {
    return failedResponse(timestamp);
  }

  const adapter: RealtimeClientSecretAdapter = dependencies.createClientSecret
    ? { createClientSecret: dependencies.createClientSecret }
    : createRealtimeClientSecretAdapter(dependencies.fetch);

  let clientSecret: RealtimeClientSecretPayload;
  try {
    clientSecret = await adapter.createClientSecret(input.openAiApiKey);
  } catch {
    return failedResponse(timestamp);
  }

  if (
    typeof clientSecret.value !== "string" ||
    clientSecret.value.trim().length === 0 ||
    !isUsableEpochSeconds(clientSecret.expiresAtEpochSeconds)
  ) {
    return failedResponse(timestamp);
  }

  return {
    httpStatus: 200,
    body: {
      success: true,
      clientSecret: clientSecret.value,
      model: REALTIME_MODEL,
      expiresAt: new Date(clientSecret.expiresAtEpochSeconds * 1000).toISOString(),
      message: "Realtime 세션 단기 키를 발급했습니다.",
      timestamp,
    },
  };
}

export const createRealtimeSessionService = createRealtimeSession;
