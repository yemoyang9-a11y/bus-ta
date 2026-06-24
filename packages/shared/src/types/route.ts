import type { RouteId } from "./ids.js";
import type { Station } from "./station.js";

export interface Route {
  routeId: RouteId;
  /** 노선 번호 (예: "360") */
  routeNo: string;
  routeName: string;
  stations: Station[];
}
