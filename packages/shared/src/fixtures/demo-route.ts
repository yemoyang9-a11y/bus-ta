/**
 * 시연용 노선 + 정류장 시퀀스 단일 출처
 *
 * 모든 시연 시나리오에서 이 데이터를 기반으로 한다.
 * 실제 GBIS API 데이터 수신 후 이 파일로 업데이트한다.
 */
import { asRouteId, asStationId } from "../types/ids.js";
import type { Route } from "../types/route.js";

export const DEMO_ROUTE: Route = {
  routeId: asRouteId("demo-route-360"),
  routeNo: "360",
  routeName: "360번 (시연용)",
  stations: [
    {
      stationId: asStationId("demo-st-01"),
      name: "출발정류장 (시연)",
      lat: 37.4900,
      lng: 127.0300,
      sequence: 0,
      routeId: asRouteId("demo-route-360"),
    },
    {
      stationId: asStationId("demo-st-02"),
      name: "중간정류장1 (시연)",
      lat: 37.4920,
      lng: 127.0320,
      sequence: 1,
      routeId: asRouteId("demo-route-360"),
    },
    {
      stationId: asStationId("demo-st-03"),
      name: "중간정류장2 (시연)",
      lat: 37.4940,
      lng: 127.0340,
      sequence: 2,
      routeId: asRouteId("demo-route-360"),
    },
    {
      stationId: asStationId("demo-st-04"),
      name: "도착정류장 (시연)",
      lat: 37.4960,
      lng: 127.0360,
      sequence: 3,
      routeId: asRouteId("demo-route-360"),
    },
  ],
};

export const DEMO_BOARDING_STATION_ID = asStationId("demo-st-01");
export const DEMO_ALIGHTING_STATION_ID = asStationId("demo-st-04");
