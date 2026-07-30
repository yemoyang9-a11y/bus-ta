import assert from "node:assert/strict";
import test from "node:test";
import { BELL_COMMAND, BELL_STATUS, TRIP_STATUS } from "@bus-ta/shared";
import {
  DuplicateLocationRequestError,
  TripCancelledDuringUpdateError,
  TripCompletedDuringUpdateError,
} from "../../services/trip/update-trip-status.service.js";
import { SupabaseTripRepository } from "./trip.repository.js";

const input = {
  status: {
    tripId: "trip-test-001",
    currentStation: { stationName: "출발", latitude: 37.49, longitude: 127.03, sequence: 0 },
    nextStation: { stationName: "다음", latitude: 37.491, longitude: 127.031, sequence: 1 },
    remainingStations: 2,
    tripStatus: TRIP_STATUS.ON_BUS,
    bellStatus: BELL_STATUS.NOT_REQUESTED,
    lastRequestId: "loc-001",
    locationSource: "GPS" as const,
    recordedAt: "2026-07-25T12:00:00.000Z",
    updatedAt: "2026-07-25T12:00:01.000Z",
  },
  locationLog: {
    tripId: "trip-test-001",
    requestId: "loc-001",
    latitude: 37.49,
    longitude: 127.03,
    source: "GPS" as const,
    recordedAt: "2026-07-25T12:00:00.000Z",
    currentStation: { stationName: "출발", latitude: 37.49, longitude: 127.03, sequence: 0 },
    remainingStations: 2,
    locationAccepted: true,
    reason: null,
  },
  bellRequest: {
    tripId: "trip-test-001",
    bellRequestId: "bell-test-001",
    command: BELL_COMMAND.STOP_REQUEST,
    requestedAt: "2026-07-25T12:00:01.000Z",
  },
};

test("saves status, location, and bell request through the atomic RPC", async () => {
  let request: { url: string; init: RequestInit | undefined } | null = null;
  const repository = new SupabaseTripRepository(
    { url: "https://supabase.example", apiKey: "service-key" },
    async (url, init) => {
      request = { url: String(url), init };
      return new Response('"SAVED"', { status: 200, headers: { "Content-Type": "application/json" } });
    },
  );

  await repository.saveStatusAndLocation(input);

  assert.deepEqual(request, {
    url: "https://supabase.example/rest/v1/rpc/save_trip_status_and_location",
    init: {
      method: "POST",
      headers: {
        apikey: "service-key",
        Authorization: "Bearer service-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_trip_id: "trip-test-001",
        p_status: {
          current_station: input.status.currentStation,
          next_station: input.status.nextStation,
          remaining_stations: 2,
          trip_status: TRIP_STATUS.ON_BUS,
          bell_status: BELL_STATUS.NOT_REQUESTED,
          last_request_id: "loc-001",
          location_source: "GPS",
          recorded_at: "2026-07-25T12:00:00.000Z",
          updated_at: "2026-07-25T12:00:01.000Z",
        },
        p_location_log: {
          trip_id: "trip-test-001",
          request_id: "loc-001",
          latitude: 37.49,
          longitude: 127.03,
          source: "GPS",
          recorded_at: "2026-07-25T12:00:00.000Z",
          current_station: input.locationLog.currentStation,
          remaining_stations: 2,
          location_accepted: true,
          reason: null,
        },
        p_bell_request: {
          trip_id: "trip-test-001",
          bell_request_id: "bell-test-001",
          command: BELL_COMMAND.STOP_REQUEST,
          requested_at: "2026-07-25T12:00:01.000Z",
        },
      }),
    },
  });
});

test("reports cancellation when the atomic RPC sees a cancelled trip", async () => {
  const repository = new SupabaseTripRepository(
    { url: "https://supabase.example", apiKey: "service-key" },
    async () => new Response('"CANCELLED"', { status: 200, headers: { "Content-Type": "application/json" } }),
  );

  await assert.rejects(() => repository.saveStatusAndLocation(input), TripCancelledDuringUpdateError);
});

test("reports completion when the atomic RPC sees a completed trip", async () => {
  const repository = new SupabaseTripRepository(
    { url: "https://supabase.example", apiKey: "service-key" },
    async () => new Response('"TRIP_DONE"', { status: 200, headers: { "Content-Type": "application/json" } }),
  );

  await assert.rejects(() => repository.saveStatusAndLocation(input), TripCompletedDuringUpdateError);
});

test("reports a duplicate when a concurrent request already saved the same requestId", async () => {
  const repository = new SupabaseTripRepository(
    { url: "https://supabase.example", apiKey: "service-key" },
    async () => new Response('"DUPLICATE"', { status: 200, headers: { "Content-Type": "application/json" } }),
  );

  await assert.rejects(() => repository.saveStatusAndLocation(input), DuplicateLocationRequestError);
});

test("cancels through the atomic RPC and returns its terminal-state result", async () => {
  let request: { url: string; init: RequestInit | undefined } | null = null;
  const repository = new SupabaseTripRepository(
    { url: "https://supabase.example", apiKey: "service-key" },
    async (url, init) => {
      request = { url: String(url), init };
      return new Response('"TRIP_DONE"', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  const result = await repository.saveTripStatus({
    tripId: "trip-test-001",
    tripStatus: TRIP_STATUS.CANCELLED,
    updatedAt: "2026-07-25T12:13:00.000Z",
  });

  assert.equal(result, "TRIP_DONE");
  assert.deepEqual(request, {
    url: "https://supabase.example/rest/v1/rpc/cancel_trip",
    init: {
      method: "POST",
      headers: {
        apikey: "service-key",
        Authorization: "Bearer service-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_trip_id: "trip-test-001",
        p_updated_at: "2026-07-25T12:13:00.000Z",
      }),
    },
  });
});
