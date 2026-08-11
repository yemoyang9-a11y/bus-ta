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
 * remainSeatCnt: ""/-1 은 정보 없음이고, 0 도 정보 없음으로 취급한다.
 *
 * 실측(2026-08-06 stationId=233000575)에서 일반시내버스 9건이 전부
 * crowded=1(여유)이면서 동시에 remainSeatCnt=0 이었다. 여유로운 버스가 0석일 수 없으므로
 * 이 0 은 "이 차종은 좌석 수를 보고하지 않는다"는 미사용 기본값이다.
 * 그대로 흘려보내면 사용자가 만석 안내를 듣게 된다.
 */
function readRemainingSeats(raw: unknown): number | null {
  const value = readGbisNumber(raw);
  return value !== null && value >= 1 ? value : null;
}

/**
 * 둘 다 유효하면 잔여좌석을 우선한다. 좌석 수가 혼잡도보다 구체적인 정보다.
 */
function toOccupancy(rawCongestion: unknown, rawRemainingSeats: unknown): Occupancy {
  const remainingSeats = readRemainingSeats(rawRemainingSeats);
  if (remainingSeats !== null) {
    return { type: "REMAINING_SEATS", congestionLevel: null, remainingSeats };
  }

  const congestionLevel = readCongestionLevel(rawCongestion);
  if (congestionLevel !== null) {
    return { type: "CONGESTION", congestionLevel, remainingSeats: null };
  }

  return { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null };
}

/**
 * predictTime 이 비어 있으면 그 순번의 차량은 없는 것이므로 배열에 넣지 않는다.
 */
function toArrival(
  rawPredictTime: unknown,
  rawCongestion: unknown,
  rawRemainingSeats: unknown,
): ArrivalInfo | null {
  const predictedArrivalMinutes = readGbisNumber(rawPredictTime);
  if (predictedArrivalMinutes === null || predictedArrivalMinutes < 0) return null;

  return {
    predictedArrivalMinutes,
    occupancy: toOccupancy(rawCongestion, rawRemainingSeats),
  };
}

// ─────────────────────────────────────────────
// 도착 예정 정보 조회 adapter (효린 담당)
// selectedCandidate: searchRoutes()가 반환한 Route 객체 중 사용자가 선택한 것
// 반환: { gbisStationId, localBusId, arrivals } — arrivals 는 도착 순서대로 최대 2대
// ─────────────────────────────────────────────
export async function getArrivalInfo(
  selectedCandidate: Pick<Route, "gbisStationId" | "localBusId">,
): Promise<{ gbisStationId: string; localBusId: string; arrivals: ArrivalInfo[] }> {
  const { gbisStationId, localBusId } = selectedCandidate;

  // ODsay startLocalStationID = GBIS stationId (테스트로 동일 확인, 역조회 불필요)
  const busArrivalList = await getBusArrivalByStationId(gbisStationId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matched = busArrivalList.find((a: any) => String(a.routeId) === String(localBusId));

  if (!matched) {
    return { gbisStationId, localBusId, arrivals: [] };
  }

  const arrivals = [
    toArrival(matched.predictTime1, matched.crowded1, matched.remainSeatCnt1),
    toArrival(matched.predictTime2, matched.crowded2, matched.remainSeatCnt2),
  ].filter((arrival): arrival is ArrivalInfo => arrival !== null);

  return { gbisStationId, localBusId, arrivals };
}
