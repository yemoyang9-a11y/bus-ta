import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_ROUTE, type CreateTripResponse, type Route } from "@bus-ta/shared";
import { initialState, tripReducer } from "../../../mobile/src/state/trip-reducer.js";
import { startJourneyBus, toBusLegCreateRequest, toBusLegRoute } from "../../../mobile/src/state/transfer-journey.js";

const firstBus = {
  routeNo: DEMO_ROUTE.routeNo,
  localBusId: DEMO_ROUTE.localBusId,
  gbisStationId: DEMO_ROUTE.gbisStationId,
  boardingStation: DEMO_ROUTE.boardingStation,
  destinationStation: DEMO_ROUTE.destinationStation,
  stationList: DEMO_ROUTE.stationList,
};
const secondBus = { ...firstBus, routeNo: "20", localBusId: "route-20", gbisStationId: "station-20" };
const route: Route = {
  ...DEMO_ROUTE, routeMode: "MULTIMODAL", tripSupported: false, journeySupported: true,
  segments: [
    { mode: "BUS", startName: "첫탑승", endName: "첫하차", lineNames: [], routeNumbers: [firstBus.routeNo], busLeg: firstBus },
    { mode: "WALK", startName: "첫하차", endName: "다음 정류장", lineNames: [], routeNumbers: [] },
    { mode: "BUS", startName: "다음 정류장", endName: "목적지", lineNames: [], routeNumbers: ["20"], busLeg: secondBus },
  ],
};

test("first bus arrival waits for actual alighting and retains the journey", () => {
  const started = tripReducer(initialState, { type: "START_JOURNEY", route });
  assert.equal(started.journeySegmentIndex, 0);
  const waiting = tripReducer(tripReducer(started, { type: "SELECT_ROUTE", route: toBusLegRoute(route, 0) }), { type: "START_TRIP", tripId: "trip-first" });
  const arrived = tripReducer(waiting, { type: "UPDATE_TRIP_STATUS", status: {
    tripId: "trip-first", tripStatus: "TRIP_DONE", boardingMethod: "USER_CONFIRMED",
    boardingConfirmedAt: "2026-09-23T00:00:00.000Z", currentStation: null, nextStation: null,
    remainingStations: 0, bellStatus: "SUCCESS", guideMessage: "도착", command: null,
  } });
  const prompt = tripReducer(arrived, { type: "MARK_JOURNEY_BUS_ARRIVED", tripId: "trip-first" });
  assert.equal(prompt.journeyPhase, "BUS_ALIGHT_CONFIRM");
  assert.equal(prompt.journeySegmentIndex, 0);
  assert.equal(prompt.tripId, "trip-first");
  const next = tripReducer(prompt, { type: "CONFIRM_JOURNEY_STEP", expectedIndex: 0 });
  assert.equal(next.journeySegmentIndex, 1);
  assert.equal(next.tripId, null);
  assert.equal(next.journeyRoute, route);
  assert.deepEqual(tripReducer(next, { type: "CONFIRM_JOURNEY_STEP", expectedIndex: 0 }), next);
});

test("walk and subway require their own confirmations; a later bus uses its own identifiers", () => {
  const mixed: Route = { ...route, segments: [
    { mode: "WALK", startName: "출발", endName: "역", lineNames: [], routeNumbers: [] },
    { mode: "SUBWAY", startName: "역", endName: "환승역", lineNames: ["1호선"], routeNumbers: [] },
    { mode: "WALK", startName: "환승역", endName: "정류장", lineNames: [], routeNumbers: [] },
    route.segments![2]!,
  ] };
  const start = tripReducer(initialState, { type: "START_JOURNEY", route: mixed });
  const atSubway = tripReducer(start, { type: "CONFIRM_JOURNEY_STEP", expectedIndex: 0 });
  assert.equal(atSubway.journeySegmentIndex, 1);
  const boarded = tripReducer(atSubway, { type: "CONFIRM_JOURNEY_STEP", expectedIndex: 1 });
  assert.equal(boarded.journeyPhase, "SUBWAY_ON_BOARD");
  assert.equal(boarded.journeySegmentIndex, 1);
  const alighted = tripReducer(boarded, { type: "CONFIRM_JOURNEY_STEP", expectedIndex: 1 });
  assert.equal(alighted.journeySegmentIndex, 2);
  const atBus = tripReducer(alighted, { type: "CONFIRM_JOURNEY_STEP", expectedIndex: 2 });
  assert.equal(atBus.journeySegmentIndex, 3);
  assert.deepEqual(toBusLegCreateRequest(mixed, 3), {
    destination: secondBus.destinationStation.stationName,
    candidateId: mixed.candidateId,
    routeNo: "20", localBusId: "route-20", gbisStationId: "station-20",
    boardingStation: secondBus.boardingStation, destinationStation: secondBus.destinationStation,
    stationList: secondBus.stationList, busTransitCount: 1, routeMode: "DIRECT_BUS", tripSupported: true,
  });
});

test("last confirmed segment ends the journey while a direct bus remains unchanged", () => {
  const oneBus: Route = { ...route, segments: [route.segments![0]!] };
  const begun = tripReducer(initialState, { type: "START_JOURNEY", route: oneBus });
  const waiting = tripReducer(begun, { type: "START_TRIP", tripId: "trip-last" });
  const done = tripReducer({ ...waiting, tripStatus: "TRIP_DONE" }, { type: "MARK_JOURNEY_BUS_ARRIVED", tripId: "trip-last" });
  const finished = tripReducer(done, { type: "CONFIRM_JOURNEY_STEP", expectedIndex: 0 });
  assert.equal(finished.journeyRoute, null);
  assert.equal(finished.tripId, null);
  assert.equal(finished.routeCandidates, null);
  assert.equal(tripReducer(initialState, { type: "START_TRIP", tripId: "direct" }).journeyRoute, null);
});

test("simultaneous screen and voice bus starts share one server request", async () => {
  const journey = { ...route };
  let calls = 0;
  const response: CreateTripResponse = { success: true, tripId: "one-trip", routeNo: "1551",
    localBusId: firstBus.localBusId, gbisStationId: firstBus.gbisStationId, arrivals: [],
    tripStatus: "WAITING_BUS", bellStatus: "NOT_REQUESTED", shouldTriggerBell: false,
    createdAt: "2026-09-23T00:00:00.000Z", message: "생성", timestamp: "2026-09-23T00:00:00.000Z" };
  const create = async () => { calls += 1; return response; };
  const [screen, voice] = await Promise.all([startJourneyBus(journey, 0, 1, create), startJourneyBus(journey, 0, 1, create)]);
  assert.equal(calls, 1);
  assert.equal(screen.tripId, voice.tripId);
});

test("a restarted journey does not share the previous pending bus request", async () => {
  const journey = { ...route };
  let calls = 0;
  let finishFirst: ((value: CreateTripResponse) => void) | undefined;
  const response = (tripId: string): CreateTripResponse => ({ success: true, tripId, routeNo: "1551",
    localBusId: firstBus.localBusId, gbisStationId: firstBus.gbisStationId, arrivals: [],
    tripStatus: "WAITING_BUS", bellStatus: "NOT_REQUESTED", shouldTriggerBell: false,
    createdAt: "2026-09-23T00:00:00.000Z", message: "생성", timestamp: "2026-09-23T00:00:00.000Z" });
  const create = async () => {
    calls += 1;
    if (calls === 1) return new Promise<CreateTripResponse>((resolve) => { finishFirst = resolve; });
    return response("new-trip");
  };
  const oldRequest = startJourneyBus(journey, 0, 1, create);
  const newRequest = startJourneyBus(journey, 0, 2, create);
  await newRequest;
  assert.equal(calls, 2);
  assert.equal((await newRequest).tripId, "new-trip");
  assert.ok(finishFirst);
  finishFirst(response("old-trip"));
  assert.equal((await oldRequest).tripId, "old-trip");
});

test("the same journey reuses its successful bus creation after the request settles", async () => {
  const journey = { ...route };
  let calls = 0;
  const response: CreateTripResponse = { success: true, tripId: "once", routeNo: "1551",
    localBusId: firstBus.localBusId, gbisStationId: firstBus.gbisStationId, arrivals: [],
    tripStatus: "WAITING_BUS", bellStatus: "NOT_REQUESTED", shouldTriggerBell: false,
    createdAt: "2026-09-23T00:00:00.000Z", message: "생성", timestamp: "2026-09-23T00:00:00.000Z" };
  const create = async () => { calls += 1; return response; };
  const first = await startJourneyBus(journey, 0, 99, create);
  const second = await startJourneyBus(journey, 0, 99, create);
  assert.equal(calls, 1);
  assert.equal(first.tripId, second.tripId);
});

test("a failed bus creation can be retried within the same journey", async () => {
  const journey = { ...route };
  let calls = 0;
  const create = async (): Promise<CreateTripResponse> => {
    calls += 1;
    if (calls === 1) throw new Error("temporary failure");
    return { success: true, tripId: "retry-trip", routeNo: "1551",
      localBusId: firstBus.localBusId, gbisStationId: firstBus.gbisStationId, arrivals: [],
      tripStatus: "WAITING_BUS", bellStatus: "NOT_REQUESTED", shouldTriggerBell: false,
      createdAt: "2026-09-23T00:00:00.000Z", message: "생성", timestamp: "2026-09-23T00:00:00.000Z" };
  };
  await assert.rejects(startJourneyBus(journey, 0, 1, create), /temporary failure/);
  assert.equal((await startJourneyBus(journey, 0, 1, create)).tripId, "retry-trip");
  assert.equal(calls, 2);
});

test("adopting the same bus trip twice does not reset confirmed boarding", () => {
  const begun = tripReducer(initialState, { type: "START_JOURNEY", route });
  const waiting = tripReducer(begun, { type: "START_TRIP", tripId: "shared-trip" });
  const boarded = tripReducer(waiting, { type: "CONFIRM_BOARDING", tripId: "shared-trip",
    tripStatus: "ON_BUS", boardingMethod: "USER_CONFIRMED", boardingConfirmedAt: "2026-09-23T00:00:00.000Z" });
  assert.equal(tripReducer(boarded, { type: "START_TRIP", tripId: "shared-trip" }), boarded);
});

test("reselecting the same route after cancellation creates a new journey generation", () => {
  const first = tripReducer(initialState, { type: "START_JOURNEY", route });
  const cancelled = tripReducer(first, { type: "RESET_TRIP_KEEP_SEARCH" });
  const second = tripReducer(cancelled, { type: "START_JOURNEY", route });
  assert.equal(second.journeyRoute, first.journeyRoute);
  assert.notEqual(second.journeyGeneration, first.journeyGeneration);
});

test("boarding the final subway does not complete the journey before actual alighting", () => {
  const lastSubway: Route = { ...route, segments: [route.segments![0]!,
    { mode: "SUBWAY", startName: "환승역", endName: "목적역", lineNames: ["1호선"], routeNumbers: [] }] };
  const first = tripReducer(initialState, { type: "START_JOURNEY", route: lastSubway });
  const arrived = tripReducer({ ...first, tripId: "bus", tripStatus: "TRIP_DONE" }, { type: "MARK_JOURNEY_BUS_ARRIVED", tripId: "bus" });
  const subway = tripReducer(arrived, { type: "CONFIRM_JOURNEY_STEP", expectedIndex: 0, expectedPhase: "BUS_ALIGHT_CONFIRM" });
  const boarded = tripReducer(subway, { type: "CONFIRM_JOURNEY_STEP", expectedIndex: 1, expectedPhase: "GUIDING" });
  assert.equal(boarded.journeyPhase, "SUBWAY_ON_BOARD");
  assert.equal(boarded.journeySegmentIndex, 1);
  assert.equal(boarded.journeyRoute, lastSubway);
  assert.deepEqual(tripReducer(boarded, { type: "CONFIRM_JOURNEY_STEP", expectedIndex: 1, expectedPhase: "GUIDING" }), boarded);
  const finished = tripReducer(boarded, { type: "CONFIRM_JOURNEY_STEP", expectedIndex: 1, expectedPhase: "SUBWAY_ON_BOARD" });
  assert.equal(finished.journeyRoute, null);
});
