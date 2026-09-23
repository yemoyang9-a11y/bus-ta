import { searchRoutes as realSearchRoutes } from "../adapters/routes/hyorin-route-search.adapter.js";
import { mockSearchRoutes } from "../adapters/routes/mock-route-search.adapter.js";
import type { RouteSearchProvider } from "../services/route/search-routes.service.js";

/** Resolve per request, after index.ts loads dotenv. MODE selects the source; SCOPE selects route types. */
export function getRouteSearchProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RouteSearchProvider["searchRoutes"] {
  return env.ROUTE_SEARCH_MODE === "MOCK" ? mockSearchRoutes : realSearchRoutes;
}
