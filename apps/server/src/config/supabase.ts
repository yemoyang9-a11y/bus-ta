export type DbStatus = "UP" | "NOT_CONFIGURED" | "DOWN";

export interface SupabaseConnectionStatus {
  dbStatus: DbStatus;
  message: string;
}

type Env = Partial<Record<string, string | undefined>>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface SupabaseConfig {
  url: string;
  apiKey: string;
}

function readSupabaseConfig(env: Env): SupabaseConfig | null {
  const url = env["SUPABASE_URL"]?.trim().replace(/\/+$/, "");
  const apiKey =
    env["SUPABASE_SERVICE_ROLE_KEY"]?.trim() || env["SUPABASE_ANON_KEY"]?.trim();

  if (!url || !apiKey) {
    return null;
  }

  return { url, apiKey };
}

export async function getSupabaseConnectionStatus(
  env: Env = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<SupabaseConnectionStatus> {
  const config = readSupabaseConfig(env);

  if (!config) {
    return {
      dbStatus: "NOT_CONFIGURED",
      message: "Supabase is not configured",
    };
  }

  try {
    const response = await fetchImpl(`${config.url}/rest/v1/`, {
      method: "GET",
      headers: {
        apikey: config.apiKey,
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    if (response.ok) {
      return {
        dbStatus: "UP",
        message: "Supabase connection is healthy",
      };
    }
  } catch {
    // The health endpoint reports the failure without exposing connection details.
  }

  return {
    dbStatus: "DOWN",
    message: "Supabase connection failed",
  };
}
