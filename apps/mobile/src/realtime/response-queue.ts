import type { TripStatusChangedEvent } from "./types";

export type PendingResponse = {
  eventId: string;
  instructions: string;
  precedingEvents: unknown[];
};

type DurablePendingResponse = PendingResponse & {
  criticalKey?: string;
  tripId?: string | null;
};

function getCriticalStatusKey(event: TripStatusChangedEvent): string | null {
  if (event.tripStatus === "TRIP_DONE") return "trip-done";
  if (event.bellStatus === "SUCCESS" || event.bellStatus === "FAIL") {
    return `bell-${event.bellStatus}`;
  }
  if (event.remainingStations === 1) return "remaining-1";
  if (event.remainingStations === 2) return "remaining-2";
  return null;
}

/**
 * Function 응답과 중요한 운행 안내는 순서를 보존하고, 일반 운행 상태는 최신 한 건만 유지한다.
 */
export class RealtimeResponseQueue {
  private durableResponses: DurablePendingResponse[] = [];
  private latestStatusResponse: PendingResponse | null = null;
  private announcedCriticalKeys = new Set<string>();
  private currentTripId: string | null | undefined;

  enqueueDirect(response: PendingResponse) {
    this.durableResponses.push(response);
  }

  enqueueStatus(
    response: PendingResponse,
    event: TripStatusChangedEvent,
    tripId: string | null,
  ) {
    this.syncTrip(tripId);

    const criticalKey = getCriticalStatusKey(event);
    if (!criticalKey) {
      this.latestStatusResponse = response;
      return;
    }

    // 중요한 안내가 도착했다면 그보다 오래된 일반 상태 안내는 더 이상 말하지 않는다.
    this.latestStatusResponse = null;

    const scopedKey = `${tripId ?? "no-trip"}:${criticalKey}`;
    if (this.announcedCriticalKeys.has(scopedKey)) return;

    const queuedIndex = this.durableResponses.findIndex(
      (queued) => queued.criticalKey === scopedKey,
    );
    const criticalResponse: DurablePendingResponse = {
      ...response,
      criticalKey: scopedKey,
      tripId,
    };

    if (queuedIndex >= 0) {
      // 아직 안내되지 않은 같은 중요 이벤트는 최신 서버 상태로 교체한다.
      this.durableResponses[queuedIndex] = criticalResponse;
      return;
    }

    this.durableResponses.push(criticalResponse);
  }

  dequeue(): PendingResponse | undefined {
    const durable = this.durableResponses.shift();
    if (durable) {
      if (durable.criticalKey) {
        this.announcedCriticalKeys.add(durable.criticalKey);
      }
      return durable;
    }

    const latestStatus = this.latestStatusResponse;
    this.latestStatusResponse = null;
    return latestStatus ?? undefined;
  }

  private syncTrip(tripId: string | null) {
    if (this.currentTripId === tripId) return;

    this.currentTripId = tripId;
    this.latestStatusResponse = null;
    this.announcedCriticalKeys.clear();
    this.durableResponses = this.durableResponses.filter(
      (queued) => queued.criticalKey === undefined,
    );
  }
}
