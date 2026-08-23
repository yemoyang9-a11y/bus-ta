import axios, { type AxiosRequestConfig } from "axios";
import type { ArrivalInfo, Occupancy, Route, RoutesSearchRequest } from "@bus-ta/shared";

type UpstreamName = "KAKAO" | "ODSAY";

/**
 * 외부 API 호출 실패를 "어느 upstream이 어떤 상태로 실패했는가"까지 담아 전달한다.
 *
 * AxiosError 를 그대로 전파하면 상위에서 오류를 통째로 로그에 찍는 순간
 * `config` 에 실린 API 키가 함께 노출된다. 그래서 원본을 `cause` 로도 넘기지 않고
 * 진단에 필요한 값만 옮겨 담는다.
 */
class UpstreamRequestError extends Error {
  readonly upstream: UpstreamName;
  readonly status: number | undefined;

  constructor(upstream: UpstreamName, status: number | undefined) {
    super(`${upstream} 요청 실패 (status=${status ?? "unknown"})`);
    this.name = "UpstreamRequestError";
    this.upstream = upstream;
    this.status = status;
  }
}

async function requestUpstream(upstream: UpstreamName, url: string, config: AxiosRequestConfig) {
  try {
    return await axios.get(url, config);
  } catch (error) {
    throw new UpstreamRequestError(
      upstream,
      axios.isAxiosError(error) ? error.response?.status : undefined,
    );
  }
}

// ─────────────────────────────────────────────
// STEP 1. 카카오 Geocoding: 목적지 텍스트 → 좌표
// ─────────────────────────────────────────────
async function getDestinationCoords(destinationText: string) {
  const url = "https://dapi.kakao.com/v2/local/search/keyword.json";
  const res = await requestUpstream("KAKAO", url, {
    headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
    params: { query: destinationText },
  });
  const place = res.data.documents[0];
  if (!place) throw new Error(`목적지를 찾을 수 없습니다: ${destinationText}`);
  return {
    latitude: parseFloat(place.y),
    longitude: parseFloat(place.x),
  };
}

// ─────────────────────────────────────────────
// STEP 2. ODsay 경로탐색: 출발지·목적지 좌표 → 경로 후보
// pathType: 1=지하철, 2=버스, 3=버스+지하철 혼합
// trafficType (subPath): 1=지하철, 2=버스, 3=도보
// ─────────────────────────────────────────────
async function searchODsayRoutes(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
) {
  const url = "https://api.odsay.com/v1/api/searchPubTransPathT";
  const res = await requestUpstream("ODSAY", url, {
    params: {
      SX: originLng,
      SY: originLat,
      EX: destLng,
      EY: destLat,
      apiKey: process.env.ODSAY_API_KEY,
    },
  });
  if (!res.data.result) {
    logODsayMissingResult(res.data);
    return [];
  }
  return res.data.result.path || [];
}

/**
 * ODsay 는 키가 틀려도 HTTP 200 에 error 본문을 돌려준다. 그대로 빈 배열을 반환하면
 * "조건에 맞는 후보 없음"과 구분되지 않아 운영에서 원인을 알 수 없다.
 * 응답 본문에는 우리가 보낸 키가 들어 있지 않으므로 코드와 메시지는 그대로 남겨도 된다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function logODsayMissingResult(data: any): void {
  const rawError = data?.error;
  const errors: unknown[] = Array.isArray(rawError) ? rawError : rawError ? [rawError] : [];

  if (errors.length === 0) {
    console.error("[routes/search] ODSAY 응답에 result 가 없다", "code=none", "message=none");
    return;
  }

  for (const item of errors) {
    const detail = item as { code?: unknown; message?: unknown; msg?: unknown };
    console.error(
      "[routes/search] ODSAY 응답에 result 가 없다",
      `code=${String(detail.code ?? "unknown")}`,
      `message=${String(detail.message ?? detail.msg ?? "unknown")}`,
    );
  }
}

// ─────────────────────────────────────────────
// 유틸: 두 좌표 사이 거리 계산 (km)
// ─────────────────────────────────────────────
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = (lat2 - lat1) * 111;
  const dLng = (lng2 - lng1) * 88;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ─────────────────────────────────────────────
// 노선 검색 adapter (효린 담당)
// mockSearchRoutes 와 동일 시그니처로 교체
// ─────────────────────────────────────────────
export async function searchRoutes(request: RoutesSearchRequest): Promise<Route[]> {
  const { destination, latitude, longitude } = request;

  const destCoords = await getDestinationCoords(destination);
  const paths = await searchODsayRoutes(latitude, longitude, destCoords.latitude, destCoords.longitude);

  if (!paths || paths.length === 0) return [];

  const candidates: Route[] = [];
  let candidateId = 1;

  for (const path of paths) {
    // 버스 구간만 추출 (trafficType 2 = 버스)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const busSubPaths = (path.subPath || []).filter((sp: any) => sp.trafficType === 2);

    // MVP: 환승 없는 직행 버스 경로만 처리
    if (busSubPaths.length !== 1) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subPath = busSubPaths[0] as any;

    const stations = subPath.passStopList?.stations || [];
    if (stations.length < 2) continue;

    // subPath 하나를 여러 버스 노선이 공유할 수 있다 (같은 도로 구간을 지나는 버스들).
    // lane[0]만 쓰면 나머지 노선이 후보에서 통째로 빠지므로, lane 전체를 순회해
    // 노선마다 별도 후보를 만든다. 정류장 정보는 subPath 공통이라 그대로 공유한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lanes = (subPath.lane ?? []) as any[];
    if (lanes.length === 0) continue;

    // ODsay startLocalStationID = GBIS stationId (테스트로 동일 확인, 역조회 불필요)
    const gbisStationId = String(subPath.startLocalStationID ?? "");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stationList = stations.map((s: any, i: number) => ({
      stationName: s.stationName as string,
      latitude: parseFloat(s.y),
      longitude: parseFloat(s.x),
      sequence: i,
    }));

    const boardingStation = {
      stationName: subPath.startName as string,
      latitude: parseFloat(stations[0].y),
      longitude: parseFloat(stations[0].x),
    };
    const destinationStation = {
      stationName: stations[stations.length - 1].stationName as string,
      latitude: parseFloat(stations[stations.length - 1].y),
      longitude: parseFloat(stations[stations.length - 1].x),
    };

    // 하차 정류장이 목적지에서 0.7km 초과 시 제외 (subPath 공통 조건이라 노선과 무관하게 한 번만 검사)
    const dist = distanceKm(
      destinationStation.latitude,
      destinationStation.longitude,
      destCoords.latitude,
      destCoords.longitude,
    );
    if (dist > 0.7) continue;

    const info = path.info ?? {};

    for (const lane of lanes) {
      const routeNo = String(lane.busNo ?? "");
      const localBusId = String(lane.busLocalBlID ?? "");

      candidates.push({
        candidateId: candidateId++,
        routeNo,
        localBusId,
        gbisStationId,
        boardingStation,
        destinationStation,
        stationList,
        totalTime: info.totalTime ?? undefined,
        totalWalk: info.totalWalk ?? undefined,
        payment: info.payment ?? undefined,
        busTransitCount: info.busTransitCount ?? undefined,
        busStationCount: subPath.stationCount ?? undefined,
        totalDistance: info.totalDistance ?? undefined,
        intervalTime: subPath.intervalTime ?? undefined,
      });
    }
  }

  return candidates;
}

// ─────────────────────────────────────────────
// GBIS 실시간 도착정보 조회
// ─────────────────────────────────────────────
// GBIS 응답 지연이 운행 생성 전체를 붙잡지 않도록 상한을 둔다.
// 초과하면 axios 가 던지고, 상위(create-trip)가 arrivals: [] 로 진행한다.
const GBIS_REQUEST_TIMEOUT_MS = 5000;

async function getBusArrivalByStationId(gbisStationId: string) {
  const url = "https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2";
  const res = await axios.get(url, {
    params: {
      serviceKey: process.env.GBIS_SERVICE_KEY,
      stationId: gbisStationId,
      _type: "json",
    },
    timeout: GBIS_REQUEST_TIMEOUT_MS,
  });
  const items = res.data?.response?.msgBody?.busArrivalList;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

/**
 * GBIS 는 값이 없을 때 빈 문자열을 준다. 숫자만 골라내고 나머지는 null 로 접는다.
 */
function readGbisNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) ? raw : null;
  if (typeof raw !== "string" || raw.trim() === "") return null;

  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * crowded: ""/0 은 정보 없음, 1~4 만 유효한 혼잡도다.
 */
function readCongestionLevel(raw: unknown): number | null {
  const value = readGbisNumber(raw);
  return value !== null && value >= 1 && value <= 4 ? value : null;
}

/**
 * remainSeatCnt: GBIS 공식 문서상 "정보없음" sentinel 은 -1 뿐이다. 0 은
 * 유효값이고 뜻은 "0석 남음"(만석)이다. -1 을 제외한 0 이상 정수는 전부 유효값이다.
 *
 * 이 함수는 해당 노선유형이 remainSeatCnt 필드 대상일 때만 호출해야 한다
 * (toOccupancy 의 노선유형 분기 참고). 노선유형이 이 필드를 아예 채우지
 * 않는 경우(예: 일반형시내버스) 값이 0 이어도 좌석 정보가 아니다.
 */
function readSeatCount(raw: unknown): number | null {
  const value = readGbisNumber(raw);
  return value !== null && value >= 0 ? value : null;
}

// GBIS routeTypeCd: 노선유형에 따라 crowded/remainSeatCnt 중 어느 필드가
// 유효한지가 애초에 갈린다 (gbis.go.kr 공식 문서 확인, 2026-08-11).
// - 혼잡도(crowded) 제공: 13 일반형시내버스, 15 따복형시내버스, 23 일반형농어촌버스
// - 잔여좌석(remainSeatCnt) 제공: 11 직행좌석형시내, 12 좌석형시내, 14 광역급행형시내,
//   16 경기순환버스, 17 준공영제 직행좌석시내, 21 직행좌석형농어촌, 22 좌석형농어촌
// 그 외 노선유형(마을버스 30 등)은 두 필드 모두 대상이 아니다.
const CONGESTION_ROUTE_TYPES = new Set([13, 15, 23]);
const SEAT_COUNT_ROUTE_TYPES = new Set([11, 12, 14, 16, 17, 21, 22]);

/**
 * routeTypeCd 가 어느 필드(crowded/remainSeatCnt)를 채우는 노선유형인지에 따라
 * 분기한다. "둘 다 유효하면 우선순위로 고른다"는 값 기반 추정이 아니라, 노선유형이
 * 애초에 한쪽 필드만 채운다는 GBIS 공식 문서 근거로 확정한다. 대상이 아닌 필드는
 * 값이 뭐가 와도(노이즈여도) 무시한다.
 */
function toOccupancy(
  rawRouteTypeCd: unknown,
  rawCongestion: unknown,
  rawRemainingSeats: unknown,
): Occupancy {
  const routeTypeCd = readGbisNumber(rawRouteTypeCd);

  if (routeTypeCd !== null && SEAT_COUNT_ROUTE_TYPES.has(routeTypeCd)) {
    const remainingSeats = readSeatCount(rawRemainingSeats);
    if (remainingSeats !== null) {
      return { type: "REMAINING_SEATS", congestionLevel: null, remainingSeats };
    }
    return { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null };
  }

  if (routeTypeCd !== null && CONGESTION_ROUTE_TYPES.has(routeTypeCd)) {
    const congestionLevel = readCongestionLevel(rawCongestion);
    if (congestionLevel !== null) {
      return { type: "CONGESTION", congestionLevel, remainingSeats: null };
    }
    return { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null };
  }

  return { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null };
}

/**
 * predictTime 이 비어 있으면 그 순번의 차량은 없는 것이므로 배열에 넣지 않는다.
 */
function toArrival(
  rawPredictTime: unknown,
  rawRouteTypeCd: unknown,
  rawCongestion: unknown,
  rawRemainingSeats: unknown,
): ArrivalInfo | null {
  const predictedArrivalMinutes = readGbisNumber(rawPredictTime);
  if (predictedArrivalMinutes === null || predictedArrivalMinutes < 0) return null;

  return {
    predictedArrivalMinutes,
    occupancy: toOccupancy(rawRouteTypeCd, rawCongestion, rawRemainingSeats),
  };
}

// ─────────────────────────────────────────────
// GBIS 노선별 경유정류소 목록 조회 (회차 노선 방향 판별용)
// ─────────────────────────────────────────────
async function getBusRouteStations(routeId: string) {
  const url = "https://apis.data.go.kr/6410000/busrouteservice/v2/getBusRouteStationListv2";
  const res = await axios.get(url, {
    params: {
      serviceKey: process.env.GBIS_SERVICE_KEY,
      routeId,
      format: "json",
    },
    timeout: GBIS_REQUEST_TIMEOUT_MS,
  });
  const items = res.data?.response?.msgBody?.busRouteStationList;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

/**
 * 노선 경유정류소 조회를 "확인함 / 확인 못 함"으로 구분해서 돌려준다.
 *
 * 실패와 빈 응답을 모두 빈 배열로 접으면, 호출부에서 "이 노선은 정류장을 한 번만
 * 지난다"로 오해해 방향 검증 없이 도착정보를 통과시킨다. 확인하지 못한 상태는
 * 빈 배열이 아니라 verified=false 로 구분한다.
 */
type RouteStationsLookup =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { verified: true; stations: any[] } | { verified: false };

async function lookupRouteStations(routeId: string): Promise<RouteStationsLookup> {
  try {
    const stations = await getBusRouteStations(routeId);
    if (stations.length === 0) {
      console.error("[trips/arrival] GBIS 노선 경유정류소 응답이 비어 방향을 확인할 수 없다", `routeId=${routeId}`);
      return { verified: false };
    }
    return { verified: true, stations };
  } catch (error) {
    console.error(
      "[trips/arrival] GBIS 노선 경유정류소 조회 실패로 방향을 확인할 수 없다",
      `routeId=${routeId}`,
      `message=${error instanceof Error ? error.message : "unknown"}`,
    );
    return { verified: false };
  }
}

// 인접 정류장 좌표는 시스템 간 소수점 오차가 있을 수 있어 이름 불일치 시의
// 폴백 판정에만 쓰는 허용 거리다. 서로 다른 정류장을 같은 정류장으로 착각하지
// 않도록 일반적인 정류장 간 간격보다 훨씬 좁게 잡는다.
const SAME_STATION_DISTANCE_KM = 0.1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stationMatches(
  gbisStation: any,
  target: { stationName: string; latitude: number; longitude: number },
): boolean {
  if (gbisStation.stationName === target.stationName) return true;

  const lat = typeof gbisStation.y === "number" ? gbisStation.y : parseFloat(gbisStation.y);
  const lng = typeof gbisStation.x === "number" ? gbisStation.x : parseFloat(gbisStation.x);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;

  return distanceKm(lat, lng, target.latitude, target.longitude) < SAME_STATION_DISTANCE_KM;
}

/**
 * 회차 노선은 같은 정류장이 GBIS 도착정보에 방향별로 두 번 나올 수 있다.
 *
 * 처음엔 "보딩역 바로 다음 정류장이 일치하는 쪽"으로 방향을 가르려 했으나,
 * 실측(2026-08-20, routeId 233000281·233000268)에서 회차 전/후 구간이 같은
 * 도로를 그대로 다시 지나는 노선은 두 occurrence의 다음 정류장이 완전히
 * 동일해서 구분이 안 됐다. 대신 노선 전체 정류장 순서에서 "목적지가 어디
 * 있는지"를 찾아, 그보다 앞서면서 가장 가까운 보딩역 occurrence를 사용자가
 * 탈 방향으로 확정한다. 같은 실측 데이터로 왕복 방향 모두 검증했다.
 *
 * 방향을 하나로 확정하지 못하면(목적지 불일치, 목적지 occurrence마다 다른
 * 방향을 가리키는 모호한 경우 등) null을 반환하고, 호출부는 arrivals: [] 로
 * 안전하게 접는다 — 접근성 앱에서 틀린 방향 안내는 정보 누락보다 나쁘다.
 *
 * routeStations 는 호출부가 이미 조회해 둔 노선 전체 정류장 목록을 그대로
 * 받는다(순수 함수) — getArrivalInfo() 가 도착정보 조회와 병렬로 미리
 * 가져오기 때문이다(PR #33 리뷰: 순차 조회 시 최악 10초 지연).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveDirectionalStaOrder(
  routeStations: any[],
  gbisStationId: string,
  destinationStation: { stationName: string; latitude: number; longitude: number } | undefined,
): number | null {
  if (!destinationStation) return null;
  if (routeStations.length === 0) return null;

  const boardingIndexes: number[] = [];
  routeStations.forEach((s, i) => {
    if (String(s.stationId ?? "") === gbisStationId) boardingIndexes.push(i);
  });
  if (boardingIndexes.length === 0) return null;

  const destinationIndexes: number[] = [];
  routeStations.forEach((s, i) => {
    if (stationMatches(s, destinationStation)) destinationIndexes.push(i);
  });
  if (destinationIndexes.length === 0) return null;

  const resolvedStaOrders = new Set<number>();
  for (const destIndex of destinationIndexes) {
    const precedingBoarding = boardingIndexes.filter((b) => b < destIndex);
    if (precedingBoarding.length === 0) continue;

    const chosen = Math.max(...precedingBoarding);
    const staOrder = readGbisNumber(routeStations[chosen]?.stationSeq);
    if (staOrder !== null) resolvedStaOrders.add(staOrder);
  }

  // 목적지가 여러 번 나오는데 각기 다른 방향을 가리키면(모호) 확정하지 않는다.
  return resolvedStaOrders.size === 1 ? [...resolvedStaOrders][0]! : null;
}

// ─────────────────────────────────────────────
// 도착 예정 정보 조회 adapter (효린 담당)
// selectedCandidate: searchRoutes()가 반환한 Route 객체 중 사용자가 선택한 것
// 반환: { gbisStationId, localBusId, arrivals } — arrivals 는 도착 순서대로 최대 2대
// ─────────────────────────────────────────────
export async function getArrivalInfo(
  selectedCandidate: Pick<Route, "gbisStationId" | "localBusId"> & {
    destinationStation?: { stationName: string; latitude: number; longitude: number };
  },
): Promise<{ gbisStationId: string; localBusId: string; arrivals: ArrivalInfo[] }> {
  const { gbisStationId, localBusId, destinationStation } = selectedCandidate;

  // 도착정보 조회와 노선 정류장 목록 조회를 병렬로 시작한다(PR #33 리뷰). 순차
  // 실행하면 각각 최대 GBIS_REQUEST_TIMEOUT_MS(5초)라 최악 10초까지 create_trip
  // 응답이 지연된다. 노선 정류장 목록은 destinationStation 이 있을 때만 방향
  // 판별에 쓰이므로 그때만 함께 조회한다.
  // ODsay startLocalStationID = GBIS stationId (테스트로 동일 확인, 역조회 불필요)
  const [busArrivalList, routeStationsLookup] = await Promise.all([
    getBusArrivalByStationId(gbisStationId),
    destinationStation
      ? lookupRouteStations(localBusId)
      : Promise.resolve<RouteStationsLookup>({ verified: false }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches = busArrivalList.filter((a: any) => String(a.routeId) === String(localBusId));
  if (matches.length === 0) {
    return { gbisStationId, localBusId, arrivals: [] };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let matched: any;

  if (!destinationStation) {
    // 목적지가 없으면 방향을 판별할 기준 자체가 없다. 이 경로는 검증 대상이 아니다.
    matched = matches[0];
  } else if (!routeStationsLookup.verified) {
    // 목적지가 있는데 경유정류소를 확인하지 못했다면 방향을 검증할 수 없다.
    // 반대 방향 도착정보를 그대로 안내하면 사용자가 반대편에서 버스를 기다리게
    // 되므로, 검증 불가 상태는 fail closed 로 처리한다(PR #33 리뷰 P1).
    return { gbisStationId, localBusId, arrivals: [] };
  } else {
    const routeStations = routeStationsLookup.stations;

    // 이번 응답에 레코드가 몇 개 왔는지가 아니라, 노선이 이 정류장을 구조적으로
    // 두 번 이상 지나는지로 방향 검증 여부를 정한다(PR #33 리뷰 핵심 지적). GBIS가
    // 특정 시점엔 반대 방향 레코드를 아예 안 줄 수 있어서, 레코드가 1개뿐이라고
    // 곧장 신뢰하면 그 1개가 반대 방향이어도 그대로 안내해버릴 수 있다.
    const boardingOccursMultipleTimes =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      routeStations.filter((s: any) => String(s.stationId ?? "") === gbisStationId).length > 1;

    if (matches.length === 1 && !boardingOccursMultipleTimes) {
      matched = matches[0];
    } else {
      const staOrder = resolveDirectionalStaOrder(routeStations, gbisStationId, destinationStation);
      matched =
        staOrder === null
          ? undefined
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            matches.find((m: any) => readGbisNumber(m.staOrder) === staOrder);
    }
  }

  if (!matched) {
    return { gbisStationId, localBusId, arrivals: [] };
  }

  const arrivals = [
    toArrival(matched.predictTime1, matched.routeTypeCd, matched.crowded1, matched.remainSeatCnt1),
    toArrival(matched.predictTime2, matched.routeTypeCd, matched.crowded2, matched.remainSeatCnt2),
  ].filter((arrival): arrival is ArrivalInfo => arrival !== null);

  return { gbisStationId, localBusId, arrivals };
}
