import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { getArrivalInfo } from "./hyorin-route-search.adapter.js";

// Synthetic route occurrences, distinct from the captured GBIS fixtures in the main adapter suite.
const destination = { stationName: "목적정류장", latitude: 37, longitude: 127 };
function stop(id: string, seq: number, name = "다른정류장", y = 38) {
  return { stationId: id, stationSeq: seq, stationName: name, x: 127, y };
}
async function lookup(t: import("node:test").TestContext, stations: ReturnType<typeof stop>[]) {
  t.mock.method(axios, "get", async (url: string) => ({ data: { response: {
    msgHeader: { resultCode: 0 },
    msgBody: url.includes("busarrivalservice") ? { busArrivalList: [
      { routeId: "route", staOrder: 1, predictTime1: 4, predictTime2: "" },
      { routeId: "route", staOrder: 5, predictTime1: 12, predictTime2: "" },
    ] } : { busRouteStationList: stations },
  } } }));
  return getArrivalInfo({ localBusId: "route", gbisStationId: "board", destinationStation: destination });
}

for (const [meters, status] of [[99.9, "AVAILABLE"], [100.1, "UPSTREAM_ERROR"]] as const) {
  test(`different-name destination ${meters}m from GBIS stop: ${status}`, async (t) => {
    const result = await lookup(t, [stop("board", 1), stop("dest", 2, "다른표기", 37 + meters / 111000), stop("board", 5)]);
    assert.equal(result.arrivalStatus, status);
    assert.deepEqual(result.arrivals.map(a => a.predictedArrivalMinutes), status === "AVAILABLE" ? [4] : []);
  });
}

test("same name matches even when coordinates differ", async (t) => {
  const result = await lookup(t, [stop("board", 1), stop("dest", 2, destination.stationName), stop("board", 5)]);
  assert.deepEqual(result.arrivals.map(a => a.predictedArrivalMinutes), [4]);
});

test("three destination occurrences resolving to one preceding boarding use that direction", async (t) => {
  const result = await lookup(t, [stop("board", 1), ...[2, 3, 4].map(seq => stop("dest", seq, destination.stationName)), stop("board", 5)]);
  assert.equal(result.arrivalStatus, "AVAILABLE");
  assert.deepEqual(result.arrivals.map(a => a.predictedArrivalMinutes), [4]);
});

test("three destination occurrences resolving to different boarding directions fail safely", async (t) => {
  const result = await lookup(t, [stop("board", 1), stop("dest", 2, destination.stationName), stop("board", 5), stop("dest", 6, destination.stationName), stop("dest", 7, destination.stationName)]);
  assert.equal(result.arrivalStatus, "UPSTREAM_ERROR"); assert.deepEqual(result.arrivals, []);
});

test("circular route with destination only before boarding cannot infer wraparound", async (t) => {
  const result = await lookup(t, [stop("dest", 0, destination.stationName), stop("board", 1), stop("board", 5)]);
  assert.equal(result.arrivalStatus, "UPSTREAM_ERROR"); assert.deepEqual(result.arrivals, []);
});
