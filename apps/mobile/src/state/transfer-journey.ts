import type { CreateTripRequest, CreateTripResponse, Route } from "@bus-ta/shared";

const busStartFlights = new WeakMap<Route, Map<string, Promise<CreateTripResponse>>>();

export function startJourneyBus(route: Route, index: number, generation: number, create: (request: CreateTripRequest) => Promise<CreateTripResponse>): Promise<CreateTripResponse> {
  let byIndex = busStartFlights.get(route);
  if (!byIndex) { byIndex = new Map(); busStartFlights.set(route, byIndex); }
  const key = `${generation}:${index}`;
  const existing = byIndex.get(key);
  if (existing) return existing;
  const request = toBusLegCreateRequest(route, index);
  const flight = Promise.resolve().then(() => create(request)).finally(() => byIndex?.delete(key));
  byIndex.set(key, flight);
  return flight;
}

export function canStartJourney(route: Route): boolean {
  return route.routeMode === "MULTIMODAL" && route.journeySupported === true &&
    Array.isArray(route.segments) && route.segments.length > 0 &&
    route.segments.some((segment) => segment.mode === "BUS") &&
    route.segments.every((segment) => segment.mode !== "BUS" ||
      (segment.busLeg !== undefined && segment.busLeg.stationList.length >= 2));
}

export function toBusLegRoute(route: Route, index: number): Route {
  if (!canStartJourney(route)) throw new Error("지원하지 않는 환승 경로입니다.");
  const segment = route.segments?.[index];
  if (segment?.mode !== "BUS" || !segment.busLeg) throw new Error("버스 구간이 아닙니다.");
  const leg = segment.busLeg;
  return {
    candidateId: route.candidateId,
    ...leg,
    ...(segment.sectionTime === undefined ? {} : { totalTime: segment.sectionTime }),
    busTransitCount: 1,
    busStationCount: Math.max(leg.stationList.length - 1, 0),
    routeMode: "DIRECT_BUS",
    tripSupported: true,
    segments: [segment],
  };
}

export function toBusLegCreateRequest(route: Route, index: number): CreateTripRequest {
  const leg = toBusLegRoute(route, index);
  return {
    destination: leg.destinationStation.stationName,
    candidateId: leg.candidateId,
    routeNo: leg.routeNo,
    localBusId: leg.localBusId,
    gbisStationId: leg.gbisStationId,
    boardingStation: leg.boardingStation,
    destinationStation: leg.destinationStation,
    stationList: leg.stationList,
    busTransitCount: 1,
    routeMode: "DIRECT_BUS",
    tripSupported: true,
  };
}
