import assert from "node:assert/strict";
import test from "node:test";
import { BELL_COMMAND, BELL_STATUS, BOARDING_METHOD, TRIP_STATUS } from "@bus-ta/shared";
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
    lastLatitude: 37.49,
    lastLongitude: 127.03,
    locationChangedAt: "2026-07-25T12:00:00.000Z",
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
          last_latitude: 37.49,
          last_longitude: 127.03,
          location_changed_at: "2026-07-25T12:00:00.000Z",
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

test("restores arrival lookup identifiers from the stored trip", async () => {
  const requests: string[] = [];
  const repository = new SupabaseTripRepository(
    { url: "https://supabase.example", apiKey: "service-key" },
    async (url) => {
      requests.push(String(url));
      if (String(url).includes("/trips?")) {
        return new Response(
          JSON.stringify([
            {
              trip_id: "trip-test-001",
              destination: "도착정류장",
              route_no: "700-2",
              local_bus_id: "234000021",
              gbis_station_id: "201000166",
              destination_station: {
                stationName: "도착정류장",
                latitude: 37.21,
                longitude: 126.97,
              },
              station_list: [
                { stationName: "출발", latitude: 37.2, longitude: 126.9, sequence: 0 },
                { stationName: "도착정류장", latitude: 37.21, longitude: 126.97, sequence: 1 },
              ],
            },
          ]),
          { status: 200 },
        );
      }
      if (String(url).includes("trip_status")) {
        return new Response(
          JSON.stringify([
            {
              trip_id: "trip-test-001",
              current_station: null,
              next_station: null,
              remaining_stations: 1,
              trip_status: TRIP_STATUS.WAITING_BUS,
              boarding_method: null,
              boarding_confirmed_at: null,
              bell_status: BELL_STATUS.NOT_REQUESTED,
              last_request_id: null,
              location_source: null,
              recorded_at: null,
              updated_at: "2026-07-25T12:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      return new Response("[]", { status: 200 });
    },
  );

  const result = await repository.findTripProgressData("trip-test-001");

  assert.equal(result?.trip.localBusId, "234000021");
  assert.equal(result?.trip.gbisStationId, "201000166");
  assert.deepEqual(result?.trip.destinationStation, {
    stationName: "도착정류장",
    latitude: 37.21,
    longitude: 126.97,
  });
  assert.equal(requests.length, 3);
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

test("reports whether this location update atomically created the bell request", async () => {
  const repository = new SupabaseTripRepository(
    { url: "https://supabase.example", apiKey: "service-key" },
    async () =>
      new Response('"SAVED_BELL_CREATED"', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  const result = await repository.saveStatusAndLocation(input);

  assert.deepEqual(result, { bellCreated: true });
});

test("requests one server retry when boarding confirmation wins a stale GPS race", async () => {
  const repository = new SupabaseTripRepository(
    { url: "https://supabase.example", apiKey: "service-key" },
    async () =>
      new Response('"BOARDING_CONFIRMED_RETRY"', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  const result = await repository.saveStatusAndLocation(input);

  assert.deepEqual(result, {
    bellCreated: false,
    retryAfterBoardingConfirmation: true,
  });
});

test("confirms boarding through the dedicated atomic RPC", async () => {
  let request: { url: string; init: RequestInit | undefined } | null = null;
  const repository = new SupabaseTripRepository(
    { url: "https://supabase.example", apiKey: "service-key" },
    async (url, init) => {
      request = { url: String(url), init };
      return new Response('"CONFIRMED"', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  const result = await repository.confirmBoarding({
    tripId: "trip-test-001",
    requestId: "boarding-voice-001",
    boardingMethod: BOARDING_METHOD.USER_CONFIRMED,
    detectedAt: null,
    confirmedAt: "2026-08-22T01:00:00.000Z",
  });

  assert.equal(result, "CONFIRMED");
  assert.deepEqual(request, {
    url: "https://supabase.example/rest/v1/rpc/confirm_trip_boarding",
    init: {
      method: "POST",
      headers: {
        apikey: "service-key",
        Authorization: "Bearer service-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_trip_id: "trip-test-001",
        p_request_id: "boarding-voice-001",
        p_boarding_method: BOARDING_METHOD.USER_CONFIRMED,
        p_detected_at: null,
        p_confirmed_at: "2026-08-22T01:00:00.000Z",
      }),
    },
  });
});

for (const outcome of [
  "ALREADY_CONFIRMED",
  "TRIP_NOT_FOUND",
  "INVALID_STATUS",
  "INCONSISTENT",
] as const) {
  test(`returns ${outcome} from the boarding RPC`, async () => {
    const repository = new SupabaseTripRepository(
      { url: "https://supabase.example", apiKey: "service-key" },
      async () =>
        new Response(JSON.stringify(outcome), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const result = await repository.confirmBoarding({
      tripId: "trip-test-001",
      requestId: "boarding-ble-001",
      boardingMethod: BOARDING_METHOD.AUTO_DETECTED,
      detectedAt: "2026-08-22T00:59:58.000Z",
      confirmedAt: "2026-08-22T01:00:00.000Z",
    });

    assert.equal(result, outcome);
  });
}
