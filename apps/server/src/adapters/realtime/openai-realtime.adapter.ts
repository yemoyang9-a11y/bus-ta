import { REALTIME_MODEL } from "@bus-ta/shared";

export const REALTIME_CLIENT_SECRETS_URL =
  "https://api.openai.com/v1/realtime/client_secrets";

const REALTIME_CLIENT_SECRET_REQUEST_BODY = {
  session: {
    type: "realtime",
    model: REALTIME_MODEL,
  },
  expires_after: {
    anchor: "created_at",
    seconds: 600,
  },
} as const;

export type RealtimeFetch = typeof fetch;

export interface RealtimeClientSecretPayload {
  value: string;
  expiresAtEpochSeconds: number;
}

export interface RealtimeClientSecretAdapter {
  createClientSecret(apiKey: string): Promise<RealtimeClientSecretPayload>;
}

function isValidClientSecretPayload(value: unknown): value is {
  value: string;
  expires_at: number;
} {
  if (typeof value !== "object" || value === null) return false;

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.value === "string" &&
    payload.value.trim().length > 0 &&
    typeof payload.expires_at === "number" &&
    Number.isInteger(payload.expires_at) &&
    payload.expires_at > 0
  );
}

export function createRealtimeClientSecretAdapter(
  fetchImpl: RealtimeFetch = fetch,
): RealtimeClientSecretAdapter {
  return {
    async createClientSecret(apiKey) {
      const response = await fetchImpl(REALTIME_CLIENT_SECRETS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(REALTIME_CLIENT_SECRET_REQUEST_BODY),
      });

      if (!response.ok) {
        throw new Error("Realtime upstream request failed");
      }

      const payload: unknown = await response.json();
      if (!isValidClientSecretPayload(payload)) {
        throw new Error("Realtime upstream response was malformed");
      }

      return {
        value: payload.value,
        expiresAtEpochSeconds: payload.expires_at,
      };
    },
  };
}
