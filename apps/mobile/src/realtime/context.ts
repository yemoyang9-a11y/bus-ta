import type { RealtimeGuideContext } from "./types";

export function createRealtimeGuideContext(): RealtimeGuideContext {
  return {
    routes: [],
  };
}

export function clearActiveTripContext(context: RealtimeGuideContext) {
  context.tripId = undefined;
  context.tripStatus = undefined;
  context.selectedRoute = undefined;
}
