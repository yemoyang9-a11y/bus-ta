import type { RealtimeSessionResponse } from "@bus-ta/shared";
import { REALTIME_CLIENT_SECRET_TTL_SECONDS } from "./config.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type CreateRealtimeClientSecretOptions = {
  apiKey: string | undefined;
  model: string;
  now?: () => string;
  fetchImpl?: FetchLike;
};

type RealtimeSessionErrorResponse = {
  success: false;
  errorCode: "REALTIME_SESSION_FAILED";
  message: string;
  timestamp: string;
};

type CreateRealtimeClientSecretResult =
  | { httpStatus: 200; body: RealtimeSessionResponse }
  | { httpStatus: 502; body: RealtimeSessionErrorResponse };

type OpenAIClientSecretResponse = {
  value?: string;
  client_secret?: {
    value?: string;
    expires_at?: number;
  };
};

export async function createRealtimeClientSecret({
  apiKey,
  model,
  now = () => new Date().toISOString(),
  fetchImpl = fetch,
}: CreateRealtimeClientSecretOptions): Promise<CreateRealtimeClientSecretResult> {
  const timestamp = now();
  const trimmedApiKey = apiKey?.trim();

  if (!trimmedApiKey) {
    return buildRealtimeSessionFailed(timestamp);
  }

  try {
    const response = await fetchImpl("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${trimmedApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model,
        },
        expires_after: {
          anchor: "created_at",
          seconds: REALTIME_CLIENT_SECRET_TTL_SECONDS,
        },
      }),
    });

    if (!response.ok) {
      return buildRealtimeSessionFailed(timestamp);
    }

    const payload = (await response.json()) as OpenAIClientSecretResponse;
    const clientSecret = payload.client_secret?.value ?? payload.value;

    if (!clientSecret) {
      return buildRealtimeSessionFailed(timestamp);
    }

    const expiresAt =
      typeof payload.client_secret?.expires_at === "number"
        ? new Date(payload.client_secret.expires_at * 1000).toISOString()
        : new Date(Date.parse(timestamp) + REALTIME_CLIENT_SECRET_TTL_SECONDS * 1000).toISOString();

    return {
      httpStatus: 200,
      body: {
        success: true,
        clientSecret,
        model,
        expiresAt,
        message: "Realtime 세션 키를 발급했습니다.",
        timestamp,
      },
    };
  } catch {
    return buildRealtimeSessionFailed(timestamp);
  }
}

function buildRealtimeSessionFailed(timestamp: string): CreateRealtimeClientSecretResult {
  return {
    httpStatus: 502,
    body: {
      success: false,
      errorCode: "REALTIME_SESSION_FAILED",
      message: "Realtime 세션 키 발급에 실패했습니다.",
      timestamp,
    },
  };
}
