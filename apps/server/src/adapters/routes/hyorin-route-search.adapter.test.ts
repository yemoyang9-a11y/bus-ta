import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import axios from "axios";
import { ArrivalInfoSchema, RouteCandidateSchema } from "@bus-ta/shared";
import { getArrivalInfo, searchRoutes } from "./hyorin-route-search.adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(fileName: string): unknown {
  const filePath = path.join(__dirname, "__fixtures__", fileName);
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

// 2026-08-06 실제 ODsay searchPubTransPathT 호출로 캡처한 원본 응답.
// 수원대학교 → 병점역후문 구간, 한 subPath를 34/34-1/46/1000번 버스 4개가 공유한다.
// 이 fixture가 이번 버그(lane[0]만 후보로 만드는 문제)의 실제 증거다.
const odsayPathFixture = loadFixture("odsay-search-pub-trans-path-suwon-to-byeongjeom.json");

// 참고용: 실제 Kakao Local API 캡처("수원대학교" 검색 결과). 이 파일 자체는
// kakao-keyword-suwon-university.test.ts류의 Kakao 파싱 전용 테스트에서 쓴다.
// 이 테스트 파일에서는 쓰지 않는다 — 아래 이유를 참고.

// 주의: 위 ODsay 캡처는 "수원대학교(출발) → 병점역후문(도착)" 검색이고,
// 실제 Kakao 캡처(kakao-keyword-suwon-university.json)는 "수원대학교"를 목적지로 지오코딩한 결과다.
// 둘은 서로 다른 실제 검색을 캡처한 것이라 그대로 조합하면 목적지(수원대)와
// 실제 하차 정류장(병점역후문)이 4.94km 떨어져 있어 "0.7km 초과 시 제외" 필터에 걸려
// 후보가 0개가 된다 — 이번에 고치려는 버그(lane 다중 후보 생성)와 무관한 이유로 실패한다.
// 그래서 이 테스트의 Kakao 응답은 ODsay 캡처의 실제 도착 정류장 좌표에 맞춘
// 짝맞춤용 값이다. Kakao 응답의 "형태"(documents[0].x/y 필드)만 실제와 동일하게
// 맞추고, 값 자체는 이 테스트 조합을 위해 구성했다 — 실제 API 캡처가 아니다.
const kakaoNearOdsayDestinationFixture = {
  documents: [
    {
      place_name: "병점역후문 인근 테스트 목적지",
      x: "127.032047",
      y: "37.20601",
    },
  ],
};

function stubKakaoAndODsay(t: import("node:test").TestContext) {
  return t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("dapi.kakao.com")) {
      return { data: kakaoNearOdsayDestinationFixture };
    }
    if (url.includes("api.odsay.com")) {
      return { data: odsayPathFixture };
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });
}

const request = {
  destination: "병점역후문 인근 테스트 목적지",
  latitude: 37.213789,
  longitude: 126.979749,
};

test("한 subPath를 여러 버스가 공유하면 버스마다 별도 후보를 만든다", async (t) => {
  stubKakaoAndODsay(t);

  const candidates = await searchRoutes(request);

  // 캡처된 ODsay 응답의 subPath 하나에 lane이 4개(34, 34-1, 46, 1000) 있다.
  // 지금 코드는 lane[0]만 써서 후보를 1개만 만든다 — 이 단언에서 실패해야 한다.
  assert.equal(
    candidates.length,
    4,
    "subPath.lane에 있는 버스 4개가 각각 별도 후보가 되어야 한다",
  );

  assert.deepEqual(
    candidates.map((c) => c.routeNo),
    ["34", "34-1", "46", "1000"],
  );
  assert.deepEqual(
    candidates.map((c) => c.localBusId),
    ["233000011", "233000012", "200000106", "233000077"],
  );
});

test("같은 subPath에서 나온 후보들은 정류장 정보를 동일하게 공유한다", async (t) => {
  stubKakaoAndODsay(t);

  const candidates = await searchRoutes(request);

  for (const candidate of candidates) {
    assert.equal(candidate.gbisStationId, "233000575");
    assert.deepEqual(candidate.boardingStation, {
      stationName: "수원대학교",
      latitude: 37.213789,
      longitude: 126.979749,
    });
    assert.equal(candidate.stationList.length, 14);
    assert.equal(candidate.stationList[0]?.stationName, "수원대학교");
  }
});

test("candidateId는 1부터 시작하는 연속된 정수다", async (t) => {
  stubKakaoAndODsay(t);

  const candidates = await searchRoutes(request);

  assert.deepEqual(
    candidates.map((c) => c.candidateId),
    [1, 2, 3, 4],
  );
});

test("생성된 각 후보는 공개 계약(RouteCandidateSchema)을 통과한다", async (t) => {
  stubKakaoAndODsay(t);

  const candidates = await searchRoutes(request);

  for (const candidate of candidates) {
    const result = RouteCandidateSchema.safeParse(candidate);
    assert.equal(
      result.success,
      true,
      result.success ? "" : JSON.stringify(result.error.issues),
    );
  }
});

test("boardingStation.stationName은 stationList 첫 항목과 이름이 같다 (계약 5.2)", async (t) => {
  stubKakaoAndODsay(t);

  const candidates = await searchRoutes(request);

  for (const candidate of candidates) {
    assert.equal(candidate.boardingStation.stationName, candidate.stationList[0]?.stationName);
  }
});

// ─────────────────────────────────────────────
// 외부 API 실패를 식별 가능한 형태로 드러내는지 (2026-08-07)
//
// 운영에서 노선 검색이 502로 실패했을 때, Kakao 때문인지 ODsay 때문인지,
// 상태 코드가 무엇이었는지 어디에서도 알 수 없었다. axios 오류가 그대로 전파되고
// 서비스의 catch 가 오류를 버려서 로그에도 아무 흔적이 남지 않았기 때문이다.
// 아래 테스트들은 "어느 upstream이 어떤 상태로 실패했는가"가 남는지를 검증한다.
// ─────────────────────────────────────────────

function axiosErrorWithStatus(status: number, secretInConfig: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
    // 실제 AxiosError 는 요청에 쓴 키를 config 에 그대로 담고 있다.
    // 이 값이 로그로 새지 않는지 확인하기 위해 일부러 넣는다.
    config: {
      headers: { Authorization: `KakaoAK ${secretInConfig}` },
      params: { apiKey: secretInConfig },
    },
  });
}

test("Kakao 지오코딩이 401로 실패하면 어느 upstream이 실패했는지 식별 가능한 오류를 던진다", async (t) => {
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("dapi.kakao.com")) {
      throw axiosErrorWithStatus(401, "kakao-secret-for-test");
    }
    throw new Error(`ODsay 까지 가면 안 된다: ${url}`);
  });

  await assert.rejects(
    () => searchRoutes(request),
    (error: unknown) => {
      const detail = error as { upstream?: unknown; status?: unknown };
      assert.equal(detail.upstream, "KAKAO");
      assert.equal(detail.status, 401);
      return true;
    },
  );
});

test("ODsay 요청이 실패하면 upstream이 ODSAY로 식별되는 오류를 던진다", async (t) => {
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("dapi.kakao.com")) return { data: kakaoNearOdsayDestinationFixture };
    if (url.includes("api.odsay.com")) throw axiosErrorWithStatus(429, "odsay-secret-for-test");
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  await assert.rejects(
    () => searchRoutes(request),
    (error: unknown) => {
      const detail = error as { upstream?: unknown; status?: unknown };
      assert.equal(detail.upstream, "ODSAY");
      assert.equal(detail.status, 429);
      return true;
    },
  );
});

test("upstream 오류 메시지에 API 키 값이 담기지 않는다", async (t) => {
  const secret = "kakao-secret-for-test";
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("dapi.kakao.com")) throw axiosErrorWithStatus(401, secret);
    throw new Error(`ODsay 까지 가면 안 된다: ${url}`);
  });

  await assert.rejects(
    () => searchRoutes(request),
    (error: unknown) => {
      const detail = error as { config?: unknown; cause?: unknown; message?: unknown };
      // AxiosError 의 config 에는 요청에 쓴 키가 그대로 들어 있다.
      // 그 객체를 달고 나가면 상위에서 오류를 통째로 찍는 순간 키가 로그로 샌다.
      assert.equal(detail.config, undefined, "AxiosError의 config를 그대로 달고 나가면 안 된다");
      assert.equal(detail.cause, undefined, "cause로도 원본 AxiosError를 넘기지 않는다");
      assert.ok(!String(detail.message).includes(secret), "메시지에 키가 들어가면 안 된다");
      return true;
    },
  );
});

test("ODsay가 result 없이 error 본문을 돌려주면 후보는 비되 원인을 로그로 남긴다", async (t) => {
  const logged: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(args.map((arg) => String(arg)).join(" "));
  });
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("dapi.kakao.com")) return { data: kakaoNearOdsayDestinationFixture };
    if (url.includes("api.odsay.com")) {
      // 2026-08-07 실제로 확인한 ODsay 인증 실패 응답. HTTP 200 으로 온다.
      return {
        data: {
          error: [{ code: "500", message: "[ApiKeyAuthFailed] ApiKey authentication failed." }],
        },
      };
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  const candidates = await searchRoutes(request);

  assert.deepEqual(candidates, [], "기존 계약대로 후보는 빈 배열이다");

  const line = logged.join("\n");
  assert.match(line, /ODSAY/, "어느 upstream이었는지 남아야 한다");
  assert.match(line, /ApiKeyAuthFailed/, "ODsay가 준 실패 사유가 남아야 한다");
});

// ─────────────────────────────────────────────
// GBIS 도착정보 → arrivals(최대 2대) + occupancy 변환 (계약 5.2-A)
//
// 아래 fixture 는 2026-08-06 stationId=233000575 로 실제 GBIS 를 호출해 캡처한 원본이다.
// 계약이 요구하는 세 가지 해석 케이스가 전부 실물로 들어 있다.
// - 일반시내버스(routeTypeCd 13): crowded=1 이면서 remainSeatCnt=0
// - 마을버스(routeTypeCd 30): crowded=0, remainSeatCnt=-1
// - 직행좌석(routeTypeCd 11): remainSeatCnt 가 실제 좌석 수
// ─────────────────────────────────────────────
const gbisArrivalFixture = loadFixture("gbis-bus-arrival-list-station-233000575.json");

// 2026-08-20 실제 GBIS getBusRouteStationListv2 호출로 캡처한 노선 전체 정류장 순서.
// 205(233000281)·200(233000268) 둘 다 수원대학교(233000575)를 회차 전/후로 두 번
// 지난다. Task 24(중복 routeId 방향 판별) 테스트의 근거 fixture다.
const gbisRouteStations205Fixture = loadFixture("gbis-bus-route-station-list-233000281.json");
const gbisRouteStations200Fixture = loadFixture("gbis-bus-route-station-list-233000268.json");

const GBIS_STATION_ID = "233000575";

function stubGbisArrival(t: import("node:test").TestContext) {
  return t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) {
      return { data: gbisArrivalFixture };
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });
}

// 중복 routeId 방향 판별 테스트용: busarrivalservice 는 고정 fixture, busrouteservice
// 는 routeId 별로 다른 fixture를 돌려준다. 예상 밖의 routeId 조회는 실패시켜
// 어떤 노선을 조회했는지 테스트에서 바로 드러나게 한다.
function stubGbisArrivalAndRoute(t: import("node:test").TestContext) {
  const routeFixturesByRouteId: Record<string, unknown> = {
    "233000281": gbisRouteStations205Fixture,
    "233000268": gbisRouteStations200Fixture,
  };

  return t.mock.method(axios, "get", async (url: string, config?: { params?: { routeId?: string } }) => {
    if (url.includes("busarrivalservice")) {
      return { data: gbisArrivalFixture };
    }
    if (url.includes("busrouteservice")) {
      const routeId = config?.params?.routeId ?? "";
      const fixture = routeFixturesByRouteId[routeId];
      if (!fixture) {
        throw new Error(`이 테스트에서 예상하지 못한 routeId 의 busrouteservice 호출: ${routeId}`);
      }
      return { data: fixture };
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });
}

function arrivalCandidate(localBusId: string) {
  return { gbisStationId: GBIS_STATION_ID, localBusId };
}

// 병점역사거리: 205·200 둘 다 회차 전(동탄파크릭스/반도10차 방향) 구간에 있는 정류장.
const DESTINATION_TOWARD_TURN_POINT = {
  stationName: "병점역사거리",
  latitude: 37.2069833,
  longitude: 127.0356333,
};

// 일진산업단지: 205·200 둘 다 노선 전체에서 회차 후(경기고속차고지 방향, 복귀)
// 구간에만 유일하게 나오는 정류장이다. 회차 전 구간에도 같은 정류장이 있는
// "융건릉입구" 같은 이름은 방향을 하나로 확정할 수 없어 테스트 목적지로 못 쓴다.
const DESTINATION_AFTER_TURN_POINT = {
  stationName: "일진산업단지",
  latitude: 37.1959,
  longitude: 126.9978,
};

test("도착 예정 차량이 두 대면 도착 순서대로 arrivals 두 개를 반환한다", async (t) => {
  stubGbisArrival(t);

  // routeId 234000021 = 700-2, predictTime1=4 / predictTime2=7
  const info = await getArrivalInfo(arrivalCandidate("234000021"));

  assert.equal(info.gbisStationId, GBIS_STATION_ID);
  assert.equal(info.localBusId, "234000021");
  assert.deepEqual(
    info.arrivals.map((arrival) => arrival.predictedArrivalMinutes),
    [4, 7],
  );
});

// 회귀 테스트 (이번 변경의 핵심)
// 일반시내버스(routeTypeCd 13)는 GBIS 공식 문서상 remainSeatCnt 필드의 대상이
// 아니다 — crowded 로 혼잡도만 보고한다. remainSeatCnt=0 은 값 자체가 유효한지와
// 무관하게 이 노선유형에서는 애초에 읽지 않는다(routeTypeCd 기반 분기).
test("시내버스(routeTypeCd 13)의 remainSeatCnt 는 노선유형이 대상이 아니므로 무시하고 crowded 만 본다", async (t) => {
  stubGbisArrival(t);

  // routeId 234000021 = 700-2: crowded1=1, crowded2=1, remainSeatCnt1=0, remainSeatCnt2=0
  const info = await getArrivalInfo(arrivalCandidate("234000021"));

  assert.deepEqual(info.arrivals, [
    {
      predictedArrivalMinutes: 4,
      occupancy: { type: "CONGESTION", congestionLevel: 1, remainingSeats: null },
    },
    {
      predictedArrivalMinutes: 7,
      occupancy: { type: "CONGESTION", congestionLevel: 1, remainingSeats: null },
    },
  ]);

  for (const arrival of info.arrivals) {
    assert.notEqual(
      arrival.occupancy.remainingSeats,
      0,
      "routeTypeCd 13은 remainSeatCnt 대상이 아니므로 값이 0이어도 좌석 정보로 흘려보내면 안 된다",
    );
  }
});

test("직행좌석(routeTypeCd 11)은 잔여좌석 정보를 REMAINING_SEATS 로 반환한다", async (t) => {
  stubGbisArrival(t);

  // routeId 233000326 = 1006, routeTypeCd 11(좌석형 집합): crowded1=0 + remainSeatCnt1=70, crowded2=1 + remainSeatCnt2=23
  const info = await getArrivalInfo(arrivalCandidate("233000326"));

  assert.deepEqual(info.arrivals, [
    {
      predictedArrivalMinutes: 1,
      occupancy: { type: "REMAINING_SEATS", congestionLevel: null, remainingSeats: 70 },
    },
    {
      predictedArrivalMinutes: 40,
      occupancy: { type: "REMAINING_SEATS", congestionLevel: null, remainingSeats: 23 },
    },
  ]);
});

// routeTypeCd 11(직행좌석, 좌석형 집합)은 remainSeatCnt 만 유효하고 crowded 는
// 애초에 무시 대상이다. crowded1=1 이 채워져 있는 것은 "혼잡도도 유효한데
// 잔여좌석을 우선한 것"이 아니라, 이 노선유형이 안 주는 필드에 남은 노이즈다.
test("routeTypeCd 11(직행좌석)은 crowded 값이 있어도 무시하고 remainSeatCnt 만 본다", async (t) => {
  stubGbisArrival(t);

  // routeId 234000015 = 1007, routeTypeCd 11: crowded1=1 + remainSeatCnt1=36, crowded2=1 + remainSeatCnt2=37
  const info = await getArrivalInfo(arrivalCandidate("234000015"));

  assert.deepEqual(info.arrivals, [
    {
      predictedArrivalMinutes: 24,
      occupancy: { type: "REMAINING_SEATS", congestionLevel: null, remainingSeats: 36 },
    },
    {
      predictedArrivalMinutes: 36,
      occupancy: { type: "REMAINING_SEATS", congestionLevel: null, remainingSeats: 37 },
    },
  ]);
});

test("routeTypeCd 가 혼잡도·잔여좌석 어느 집합에도 속하지 않으면 UNAVAILABLE 이고, 두 번째 차량이 없으면 arrivals 는 한 개다", async (t) => {
  stubGbisArrival(t);

  // routeId 241244036 = 6-4(마을버스, routeTypeCd 30): 어느 집합에도 속하지 않아
  // crowded1=0, remainSeatCnt1=-1 값과 무관하게 UNAVAILABLE. predictTime1=65, predictTime2=""
  const info = await getArrivalInfo(arrivalCandidate("241244036"));

  assert.deepEqual(info.arrivals, [
    {
      predictedArrivalMinutes: 65,
      occupancy: { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null },
    },
  ]);
});

// ─────────────────────────────────────────────
// 합성 테스트 (2026-08-11) — GBIS 공식 문서 기반 routeTypeCd 분기 (fixture 에 없는 사례)
//
// 실물 fixture 에는 좌석형 노선유형(11)이 만석(remainSeatCnt=0)인 사례가 없어서
// 직접 구성한 busArrivalList 항목으로 검증한다.
// ─────────────────────────────────────────────

function stubGbisArrivalWith(t: import("node:test").TestContext, items: unknown[]) {
  return t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) {
      // 실제 GBIS 응답은 항상 msgHeader 를 포함한다. resultCode 를 빠뜨리면
      // 어댑터가 응답 오류로 간주하므로 정상값을 함께 준다.
      return {
        data: {
          response: {
            msgHeader: { resultCode: 0, resultMessage: "정상적으로 처리되었습니다." },
            msgBody: { busArrivalList: items },
          },
        },
      };
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });
}

function syntheticArrivalItem(overrides: Record<string, unknown>) {
  return {
    routeId: 999000001,
    routeTypeCd: 13,
    predictTime1: "5",
    predictTime2: "",
    crowded1: "",
    crowded2: "",
    remainSeatCnt1: "",
    remainSeatCnt2: "",
    ...overrides,
  };
}

test("합성: 좌석형 노선유형(14)이 remainSeatCnt1=0 이면 REMAINING_SEATS + remainingSeats:0(만석)이다", async (t) => {
  stubGbisArrivalWith(t, [
    syntheticArrivalItem({ routeTypeCd: 14, remainSeatCnt1: "0", crowded1: "1" }),
  ]);

  const info = await getArrivalInfo(arrivalCandidate("999000001"));

  assert.deepEqual(info.arrivals, [
    {
      predictedArrivalMinutes: 5,
      occupancy: { type: "REMAINING_SEATS", congestionLevel: null, remainingSeats: 0 },
    },
  ]);
});

test("합성: 좌석형 노선유형(14)이 remainSeatCnt1=-1 이면 UNAVAILABLE 이다", async (t) => {
  stubGbisArrivalWith(t, [syntheticArrivalItem({ routeTypeCd: 14, remainSeatCnt1: "-1" })]);

  const info = await getArrivalInfo(arrivalCandidate("999000001"));

  assert.deepEqual(info.arrivals, [
    {
      predictedArrivalMinutes: 5,
      occupancy: { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null },
    },
  ]);
});

test("합성: 시내버스형(13)은 remainSeatCnt1=0 이 와도 여전히 crowded 만 보고 remainSeatCnt 는 무시한다(회귀 방지)", async (t) => {
  stubGbisArrivalWith(t, [
    syntheticArrivalItem({ routeTypeCd: 13, crowded1: "2", remainSeatCnt1: "0" }),
  ]);

  const info = await getArrivalInfo(arrivalCandidate("999000001"));

  assert.deepEqual(info.arrivals, [
    {
      predictedArrivalMinutes: 5,
      occupancy: { type: "CONGESTION", congestionLevel: 2, remainingSeats: null },
    },
  ]);
});

test("합성: routeTypeCd 30(마을버스)은 두 필드에 유효값을 넣어도 UNAVAILABLE 이다", async (t) => {
  stubGbisArrivalWith(t, [
    syntheticArrivalItem({ routeTypeCd: 30, crowded1: "2", remainSeatCnt1: "10" }),
  ]);

  const info = await getArrivalInfo(arrivalCandidate("999000001"));

  assert.deepEqual(info.arrivals, [
    {
      predictedArrivalMinutes: 5,
      occupancy: { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null },
    },
  ]);
});

test("합성: routeTypeCd 를 파싱할 수 없으면(빈 문자열/null/범위 밖 숫자) UNAVAILABLE 이다", async (t) => {
  stubGbisArrivalWith(t, [
    syntheticArrivalItem({ routeId: 999000002, routeTypeCd: "", crowded1: "2", remainSeatCnt1: "10" }),
    syntheticArrivalItem({ routeId: 999000003, routeTypeCd: null, crowded1: "2", remainSeatCnt1: "10" }),
    syntheticArrivalItem({ routeId: 999000004, routeTypeCd: 999, crowded1: "2", remainSeatCnt1: "10" }),
  ]);

  for (const routeId of ["999000002", "999000003", "999000004"]) {
    const info = await getArrivalInfo(arrivalCandidate(routeId));
    assert.deepEqual(
      info.arrivals,
      [
        {
          predictedArrivalMinutes: 5,
          occupancy: { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null },
        },
      ],
      `routeTypeCd 파싱 불가 케이스(routeId=${routeId})는 UNAVAILABLE 이어야 한다`,
    );
  }
});

test("도착 예정 시간이 비어 있으면 arrivals 는 빈 배열이다", async (t) => {
  stubGbisArrival(t);

  // routeId 233000011 = 34: predictTime1, predictTime2 모두 ""
  const info = await getArrivalInfo(arrivalCandidate("233000011"));

  assert.deepEqual(info.arrivals, []);
});

test("정류장 도착정보에 해당 노선이 없으면 arrivals 는 빈 배열이다", async (t) => {
  stubGbisArrival(t);

  const info = await getArrivalInfo(arrivalCandidate("999999999"));

  assert.deepEqual(info.arrivals, []);
});

test("변환된 arrivals 항목은 모두 공개 계약(ArrivalInfoSchema)을 통과한다", async (t) => {
  stubGbisArrival(t);

  // fixture 안의 여러 차종을 훑어 어떤 차종도 계약을 깨는 값을 만들지 않는지 본다.
  //
  // 233000281(205), 233000268(200)은 일부러 뺐다. 두 routeId 는 fixture 에 각각 두 번
  // 나오는 중복 routeId다(Task 24). 이 테스트의 arrivalCandidate() 는 destinationStation
  // 을 안 넘기므로 방향을 판별하지 않고 arrivals: [] 로 접혀 아래 단언 루프가 한 번도
  // 돌지 않아 검증하는 척만 하게 된다. 중복 routeId 의 방향 판별 자체는
  // "중복 routeId:"로 시작하는 별도 테스트들에서 다룬다.
  const localBusIds = [
    "234000021", // 700-2, 일반시내버스 (CONGESTION)
    "233000326", // 1006, 직행좌석 (REMAINING_SEATS)
    "234000015", // 1007, 직행좌석 (REMAINING_SEATS)
    "241244036", // 6-4, 마을버스 (UNAVAILABLE)
    "241244020", // 26, 마을버스 (UNAVAILABLE)
  ];

  let checkedArrivals = 0;

  for (const localBusId of localBusIds) {
    const info = await getArrivalInfo(arrivalCandidate(localBusId));

    assert.ok(info.arrivals.length <= 2, `${localBusId}: arrivals 는 최대 2개다`);

    for (const arrival of info.arrivals) {
      checkedArrivals += 1;
      const result = ArrivalInfoSchema.safeParse(arrival);
      assert.equal(
        result.success,
        true,
        result.success ? "" : `${localBusId}: ${JSON.stringify(result.error.issues)}`,
      );
    }
  }

  // 단언 루프가 실제로 돌았는지 확인한다. 목록이 전부 [] 를 뱉으면
  // 이 테스트는 아무것도 검증하지 않고 통과해 버린다.
  assert.ok(checkedArrivals > 0, "계약 검증이 한 번도 실행되지 않았다");
});

// Task 24: FIX-GBIS-ARRIVAL-DUPLICATE-ROUTEID
//
// GBIS 응답에는 같은 routeId 가 두 번 나올 수 있다. fixture 의 233000281(205)과
// 233000268(200)이 그렇다 — 회차 노선이 같은 정류장(233000575)을 회차 전/후로
// 두 번 지나기 때문이다. 두 occurrence 는 routeDestName(종점)이 다르고,
// 실측(2026-08-20) 결과 "바로 다음 정류장"만으로는 구분되지 않는다 — 회차 전/후
// 구간이 같은 도로를 그대로 다시 지나 다음 정류장이 완전히 동일하다.
//
// 그래서 목적지가 노선 전체 순서상 어디 있는지로 방향을 가른다. 아래 두 테스트가
// 왕복 방향을 각각 실측 fixture로 검증한다.
test("중복 routeId: 목적지가 회차 전 구간에 있으면 그 방향 도착정보를 쓴다", async (t) => {
  stubGbisArrivalAndRoute(t);

  for (const localBusId of ["233000281", "233000268"]) {
    const info = await getArrivalInfo({
      ...arrivalCandidate(localBusId),
      destinationStation: DESTINATION_TOWARD_TURN_POINT,
    });

    // fixture 캡처 시점에 이 방향(동탄파크릭스/반도10차 행)엔 실제로 오는 차가 없었다.
    // 반대 방향 값이 여기로 새면 안 된다는 것이 이번 수정의 핵심이다.
    assert.deepEqual(
      info.arrivals,
      [],
      `${localBusId}: 회차 전 방향은 fixture 상 도착정보가 없어야 한다`,
    );
  }
});

test("중복 routeId: 목적지가 회차 후 구간에 있으면 그 방향 도착정보를 쓴다", async (t) => {
  stubGbisArrivalAndRoute(t);

  const info205 = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: DESTINATION_AFTER_TURN_POINT,
  });
  assert.deepEqual(info205.arrivals.map((a) => a.predictedArrivalMinutes), [15, 88]);

  const info200 = await getArrivalInfo({
    ...arrivalCandidate("233000268"),
    destinationStation: DESTINATION_AFTER_TURN_POINT,
  });
  assert.deepEqual(info200.arrivals.map((a) => a.predictedArrivalMinutes), [43]);
});

test("중복 routeId: destinationStation 이 없으면 방향을 판별하지 않고 [] 를 반환한다", async (t) => {
  // busrouteservice 를 stub 하지 않는다 — destinationStation 이 없으면
  // resolveDirectionalStaOrder 가 그 전에 null 을 반환해 아예 호출하지 않아야 한다.
  stubGbisArrival(t);

  for (const localBusId of ["233000281", "233000268"]) {
    const info = await getArrivalInfo(arrivalCandidate(localBusId));

    assert.deepEqual(info.arrivals, [], `${localBusId}: destinationStation 없이는 방향을 추측하지 않는다`);
  }
});

test("중복 routeId: 목적지가 노선에 없으면(불일치) [] 를 반환한다", async (t) => {
  stubGbisArrivalAndRoute(t);

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: { stationName: "존재하지 않는 정류장", latitude: 0, longitude: 0 },
  });

  assert.deepEqual(info.arrivals, []);
});

test("중복 routeId: 노선 정류장 목록 조회(GBIS busrouteservice)가 실패해도 예외 없이 [] 를 반환한다", async (t) => {
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) return { data: gbisArrivalFixture };
    if (url.includes("busrouteservice")) throw new Error("network error");
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: DESTINATION_AFTER_TURN_POINT,
  });

  assert.deepEqual(info.arrivals, []);
});

// 예외사항 3번: `arrivals: []` 하나로는 "이 노선 차가 지금 없다"와 "방향을 확인하지
// 못해 fail-closed 로 접었다"를 구분할 수 없다. GET /status 는 사용자가 버스를 놓친
// 직후 호출되므로, 확인 실패를 "차가 없다"로 안내하면 사용자가 잘못된 판단을 한다.
// arrivalStatus 로 두 경우를 갈라 호출자가 서로 다른 안내를 할 수 있게 한다.

test("도착정보에 해당 노선 차량이 실제로 없으면 arrivalStatus 는 NO_VEHICLE 이다", async (t) => {
  stubGbisArrival(t);

  const info = await getArrivalInfo(arrivalCandidate("999999999"));

  assert.deepEqual(info.arrivals, []);
  assert.equal(info.arrivalStatus, "NO_VEHICLE");
});

test("노선 정류장 목록 조회가 실패해 방향을 못 가리면 arrivalStatus 는 UPSTREAM_ERROR 다", async (t) => {
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) return { data: gbisArrivalFixture };
    if (url.includes("busrouteservice")) throw new Error("network error");
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: DESTINATION_AFTER_TURN_POINT,
  });

  assert.deepEqual(info.arrivals, []);
  assert.equal(info.arrivalStatus, "UPSTREAM_ERROR");
});

test("목적지가 노선에 없어 방향을 확정하지 못하면 arrivalStatus 는 UPSTREAM_ERROR 다", async (t) => {
  stubGbisArrivalAndRoute(t);

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: { stationName: "존재하지 않는 정류장", latitude: 0, longitude: 0 },
  });

  assert.deepEqual(info.arrivals, []);
  assert.equal(info.arrivalStatus, "UPSTREAM_ERROR");
});

test("방향이 맞는 도착정보를 찾으면 arrivalStatus 는 AVAILABLE 이다", async (t) => {
  stubGbisArrivalAndRoute(t);

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: DESTINATION_AFTER_TURN_POINT,
  });

  assert.deepEqual(info.arrivals.map((a) => a.predictedArrivalMinutes), [15, 88]);
  assert.equal(info.arrivalStatus, "AVAILABLE");
});

// PR #33 리뷰 지적: 이번 도착정보 응답에 routeId 레코드가 "몇 개 왔는지"만 보고
// 방향 검증 여부를 정하면, 회차 노선인데 GBIS가 이번엔 반대 방향 레코드를 아예
// 안 준 경우(레코드 1개) 그 1개를 검증 없이 그대로 써버려 반대 방향을 안내할 수
// 있다. 지금은 노선 구조(정류장 목록에서 보딩역이 몇 번 나오는지)로 판단하므로
// 레코드가 1개뿐이어도 방향을 확인한다.
function stubGbisArrivalItemsAndRoute(t: import("node:test").TestContext, items: unknown[]) {
  return t.mock.method(axios, "get", async (url: string, config?: { params?: { routeId?: string } }) => {
    if (url.includes("busarrivalservice")) {
      // 실제 GBIS 응답은 항상 msgHeader 를 포함한다. resultCode 를 빠뜨리면
      // 어댑터가 응답 오류로 간주하므로 정상값을 함께 준다.
      return {
        data: {
          response: {
            msgHeader: { resultCode: 0, resultMessage: "정상적으로 처리되었습니다." },
            msgBody: { busArrivalList: items },
          },
        },
      };
    }
    if (url.includes("busrouteservice")) {
      const routeId = config?.params?.routeId ?? "";
      if (routeId === "233000281") return { data: gbisRouteStations205Fixture };
      throw new Error(`이 테스트에서 예상하지 못한 routeId 의 busrouteservice 호출: ${routeId}`);
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });
}

test("중복 routeId 회귀: 반대 방향 레코드 1개만 반환돼도 그대로 쓰지 않고 [] 를 반환한다", async (t) => {
  // 233000281 은 노선 구조상 233000575 를 두 번 지난다(staOrder 11, 128). 이번엔
  // GBIS 가 반대 방향(staOrder 11, 목적지가 있는 128 방향이 아님) 레코드 1개만
  // 줬다고 가정한다 — predictTime 을 일부러 유효값(9분)으로 채워서, 검증 없이
  // 그대로 썼다면 이 값이 새 나갔을 것임을 보인다.
  stubGbisArrivalItemsAndRoute(t, [
    syntheticArrivalItem({ routeId: 233000281, staOrder: 11, predictTime1: "9" }),
  ]);

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: DESTINATION_AFTER_TURN_POINT, // staOrder 128 방향으로 확정되는 목적지
  });

  assert.deepEqual(
    info.arrivals,
    [],
    "반대 방향(staOrder 11)의 도착정보 9분이 검증 없이 새 나가면 안 된다",
  );
});

test("중복 routeId 회귀: 정방향 레코드 1개만 와도 검증을 통과하면 정상 반환한다", async (t) => {
  // 위 테스트와 대비되는 양성 케이스: 레코드가 1개뿐이어도 그 방향이 destinationStation
  // 과 일치하면(staOrder 128) 정상적으로 도착정보를 반환해야 한다 — 방향 검증이
  // "레코드 1개면 무조건 []" 로 과도하게 안전한 쪽으로 치우치지 않았는지 확인한다.
  stubGbisArrivalItemsAndRoute(t, [
    syntheticArrivalItem({ routeId: 233000281, staOrder: 128, predictTime1: "9" }),
  ]);

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: DESTINATION_AFTER_TURN_POINT,
  });

  assert.deepEqual(info.arrivals.map((a) => a.predictedArrivalMinutes), [9]);
});

// PR #33 리뷰 P1: 노선 경유정류소 조회가 실패하거나 빈 응답이면 방향을 검증할 수
// 없다. 이때 실패를 빈 배열로 접으면 "이 노선은 정류장을 한 번만 지난다"로 오해해
// 레코드 1개를 검증 없이 통과시킨다(fail open). 검증 불가는 fail closed 여야 한다.
test("PR #33 리뷰 P1: 경유정류소 조회가 실패하면 레코드가 1개여도 fail closed 로 [] 를 반환한다", async (t) => {
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) {
      return {
        data: {
          response: {
            msgHeader: { resultCode: 0, resultMessage: "정상적으로 처리되었습니다." },
            msgBody: {
              busArrivalList: [
                syntheticArrivalItem({ routeId: 233000281, staOrder: 11, predictTime1: "9" }),
              ],
            },
          },
        },
      };
    }
    if (url.includes("busrouteservice")) throw new Error("network error");
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: DESTINATION_AFTER_TURN_POINT,
  });

  assert.deepEqual(
    info.arrivals,
    [],
    "방향을 확인하지 못한 상태에서 도착정보 9분이 검증 없이 새 나가면 안 된다",
  );
});

test("PR #33 리뷰 P1: 경유정류소 응답이 비어 있으면 레코드가 1개여도 fail closed 로 [] 를 반환한다", async (t) => {
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) {
      return {
        data: {
          response: {
            msgHeader: { resultCode: 0, resultMessage: "정상적으로 처리되었습니다." },
            msgBody: {
              busArrivalList: [
                syntheticArrivalItem({ routeId: 233000281, staOrder: 11, predictTime1: "9" }),
              ],
            },
          },
        },
      };
    }
    // resultCode 는 정상인데 목록만 비어 오는 경우 — 조회 실패와 똑같이 "확인 못 함"이다.
    // msgHeader 를 빠뜨리면 나중에 경유정류소 응답에도 resultCode 검사가 붙었을 때
    // "빈 목록이라 fail closed" 인지 "헤더 누락이라 실패" 인지 구분할 수 없다.
    if (url.includes("busrouteservice")) {
      return {
        data: {
          response: {
            msgHeader: { resultCode: 0, resultMessage: "정상적으로 처리되었습니다." },
            msgBody: {},
          },
        },
      };
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: DESTINATION_AFTER_TURN_POINT,
  });

  assert.deepEqual(info.arrivals, [], "빈 응답을 '한 번만 지나는 노선'으로 오해하면 안 된다");
});

// 벽시계 시간(elapsedMs)으로 병렬성을 판정하면 CI 러너가 느릴 때 병렬인데도
// 임계값을 넘겨 임의로 실패한다(PR #33 리뷰). 시간 대신 호출 순서를 본다 —
// 두 요청이 서로 겹쳐서 진행되면 병렬이고, 하나가 끝난 뒤에야 다음이 시작되면
// 순차다. 이 판정은 실행 속도와 무관하게 결정적이다.
//
// 둘 중 어느 쪽이 먼저 시작되는지는 구현 세부사항이므로 고정하지 않는다.
// 각 stub 은 자기 시작을 알린 뒤 "상대도 시작했다"는 신호를 기다린다(배리어).
// 순차 실행이면 먼저 시작한 쪽이 오지 않을 신호를 기다리다 멈춘다 — 시작 순서가
// 어느 쪽이든 동일하게 검출된다.
function startBarrier() {
  let resolve!: () => void;
  const started = new Promise<void>((r) => {
    resolve = r;
  });
  return { started, resolve };
}

test("PR #33 리뷰 지적: 도착정보 조회와 노선 정류장 조회는 병렬로 실행된다", async (t) => {
  const events: string[] = [];
  const arrival = startBarrier();
  const route = startBarrier();

  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) {
      events.push("arrival:start");
      arrival.resolve();
      await route.started;
      events.push("arrival:end");
      return { data: gbisArrivalFixture };
    }
    if (url.includes("busrouteservice")) {
      events.push("route:start");
      route.resolve();
      await arrival.started;
      events.push("route:end");
      return { data: gbisRouteStations205Fixture };
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  // 순차 실행으로 되돌아가면 배리어가 풀리지 않아 이 await 가 멈춘다.
  // 테스트 러너 타임아웃으로 실패하게 두지 않고, 명시적으로 판정한다.
  const timedOut = Symbol("timedOut");
  let timer: NodeJS.Timeout | undefined;
  const result = await Promise.race([
    getArrivalInfo({
      ...arrivalCandidate("233000281"),
      destinationStation: DESTINATION_AFTER_TURN_POINT,
    }),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(timedOut), 2000);
    }),
  ]);
  // 성공했으면 남은 타이머를 정리한다 — 안 그러면 러너가 2초를 더 기다린다.
  if (timer) clearTimeout(timer);

  assert.notEqual(
    result,
    timedOut,
    "두 요청이 순차로 실행되어 뒤쪽 요청이 시작되지 못했다 — 병렬 실행이 깨졌다",
  );
  assert.ok(events.includes("arrival:start"), "도착정보 조회가 시작되어야 한다");
  assert.ok(events.includes("route:start"), "노선 정류장 조회가 시작되어야 한다");
  assert.ok(
    events.indexOf("route:start") < events.indexOf("arrival:end"),
    `노선 정류장 조회는 도착정보 조회가 끝나기 전에 시작되어야 한다 (관측: ${events.join(" → ")})`,
  );
});

test("GBIS 도착정보 호출에는 5초 timeout 을 지정한다", async (t) => {
  const seenConfigs: Array<{ timeout?: number } | undefined> = [];
  t.mock.method(axios, "get", async (url: string, config?: { timeout?: number }) => {
    if (url.includes("busarrivalservice")) {
      seenConfigs.push(config);
      return { data: gbisArrivalFixture };
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  await getArrivalInfo(arrivalCandidate("234000021"));

  assert.equal(seenConfigs.length, 1);
  assert.equal(
    seenConfigs[0]?.timeout,
    5000,
    "timeout 이 없으면 GBIS 응답 지연이 운행 생성 전체를 붙잡는다",
  );
});

// ─────────────────────────────────────────────
// GBIS 는 요청이 잘못돼도 HTTP 200 으로 응답하고 msgHeader.resultCode 에만 이유를
// 담는다(실측: 없는 정류장 resultCode 4, 파라미터 누락 resultCode 2).
// 이때 busArrivalList 가 없다고 빈 배열로 접으면 "호출 실패"가 "실시간 차량 없음"
// 으로 둔갑해 사용자에게 그대로 전달된다. 두 상태는 반드시 구분되어야 한다.
// ─────────────────────────────────────────────

test("GBIS 가 200 이어도 resultCode 가 정상이 아니면 UPSTREAM_ERROR 로 구분한다", async (t) => {
  // 예외를 그대로 던지면 호출부가 catch 해서 빈 배열로 접고, 그 결과가 "차량 없음"과
  // 구분되지 않는다. 던지는 대신 arrivalStatus 로 올려서 안내 문구를 나눌 수 있게 한다.
  const logged: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(args.map((arg) => String(arg)).join(" "));
  });
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) {
      return {
        data: {
          response: {
            msgHeader: { resultCode: 4, resultMessage: "결과가 존재하지 않습니다." },
            msgBody: {},
          },
        },
      };
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  const info = await getArrivalInfo(arrivalCandidate("234000021"));

  assert.equal(
    info.arrivalStatus,
    "UPSTREAM_ERROR",
    "resultCode 오류를 NO_VEHICLE 로 접으면 '차량 없음'과 구분되지 않는다",
  );
  assert.deepEqual(info.arrivals, []);
  // 상태로 접더라도 원인은 로그에 남아야 한다 — 조용한 실패를 만들지 않는다.
  assert.ok(
    logged.some((line) => line.includes("resultCode=4")),
    `실패 원인이 로그에 남아야 한다 (관측: ${logged.join(" | ")})`,
  );
});

test("GBIS 가 파라미터 오류(resultCode 2)를 줘도 UPSTREAM_ERROR 다", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) {
      return {
        data: {
          response: {
            msgHeader: { resultCode: 2, resultMessage: "필수 요청 Parameter 가 존재하지 않습니다." },
            msgBody: {},
          },
        },
      };
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  const info = await getArrivalInfo(arrivalCandidate("234000021"));

  assert.equal(info.arrivalStatus, "UPSTREAM_ERROR");
  assert.deepEqual(info.arrivals, []);
});

test("resultCode 가 정상인데 목록만 비면 실제로 차량이 없는 것이다", async (t) => {
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) {
      return {
        data: {
          response: {
            msgHeader: { resultCode: 0, resultMessage: "정상적으로 처리되었습니다." },
            msgBody: {},
          },
        },
      };
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  const info = await getArrivalInfo(arrivalCandidate("234000021"));
  assert.deepEqual(info.arrivals, [], "정상 응답의 빈 목록은 예외가 아니라 빈 배열이다");
});

// ─────────────────────────────────────────────
// 예외상황 3번("버스 놓쳤어요") 계약: arrivals 가 빈 배열인 이유를 호출부가
// 구분할 수 있어야 한다. GBIS 장애를 "오는 차가 없음"으로 안내하면 시각장애인
// 사용자가 그 말을 듣고 정류장을 떠나 실제로 오던 버스를 놓친다.
// ─────────────────────────────────────────────

test("3번 계약: 조회 성공하고 차량이 있으면 AVAILABLE 이다", async (t) => {
  stubGbisArrivalAndRoute(t);

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: DESTINATION_AFTER_TURN_POINT,
  });

  assert.equal(info.arrivalStatus, "AVAILABLE");
  assert.ok(info.arrivals.length > 0, "AVAILABLE 이면 안내할 차량이 있어야 한다");
});

test("3번 계약: 조회는 됐는데 이 노선 레코드가 없으면 NO_VEHICLE 이다", async (t) => {
  stubGbisArrival(t);

  // fixture 에 없는 노선 — 정류장 조회는 성공했고 이 노선 차량만 없는 상태다.
  const info = await getArrivalInfo(arrivalCandidate("999999999"));

  assert.equal(info.arrivalStatus, "NO_VEHICLE");
  assert.deepEqual(info.arrivals, []);
});

test("3번 계약: 레코드는 있는데 predictTime 이 비면 NO_VEHICLE 이 아니라 NO_PREDICTION 이다", async (t) => {
  // GBIS 공식 문서에서 빈 predictTime 이 "차량 없음"을 뜻한다고 확인한 적이 없고,
  // 실제 캡처에도 두 순번이 모두 빈 사례가 없다. 확인된 사실은 "도착시간 정보가
  // 없다"까지다. 근거 없이 "오는 버스가 없습니다"라고 안내하면 사용자가 정류장을 떠난다.
  stubGbisArrivalItemsAndRoute(t, [
    syntheticArrivalItem({ routeId: 233000281, staOrder: 128, predictTime1: "", predictTime2: "" }),
  ]);

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: DESTINATION_AFTER_TURN_POINT,
  });

  assert.equal(info.arrivalStatus, "NO_PREDICTION");
  assert.deepEqual(info.arrivals, []);
});

test("3번 계약: 경유정류소 응답이 비어도 UPSTREAM_ERROR 이고 원인이 로그에 남는다", async (t) => {
  // lookupRouteStations 가 예외를 던지는 경우 말고, 정상 응답인데 목록만 빈 경우다.
  // 둘 다 "방향을 확인하지 못함"이라 같은 상태여야 한다.
  const logged: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(args.map((arg) => String(arg)).join(" "));
  });
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) return { data: gbisArrivalFixture };
    if (url.includes("busrouteservice")) {
      return {
        data: {
          response: {
            msgHeader: { resultCode: 0, resultMessage: "정상적으로 처리되었습니다." },
            msgBody: {},
          },
        },
      };
    }
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: DESTINATION_AFTER_TURN_POINT,
  });

  assert.equal(info.arrivalStatus, "UPSTREAM_ERROR");
  assert.deepEqual(info.arrivals, []);
  assert.ok(
    logged.some((line) => line.includes("경유정류소를 확인하지 못해")),
    `방향 검증 불가도 원인이 남아야 한다 (관측: ${logged.join(" | ")})`,
  );
});

test("3번 계약: 네트워크 오류는 NO_VEHICLE 이 아니라 UPSTREAM_ERROR 다", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) throw new Error("network error");
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  const info = await getArrivalInfo(arrivalCandidate("233000281"));

  assert.equal(info.arrivalStatus, "UPSTREAM_ERROR");
  assert.deepEqual(info.arrivals, []);
});

test("3번 계약: 경유정류소를 확인하지 못해 fail closed 된 경우도 UPSTREAM_ERROR 다", async (t) => {
  // 방향을 검증하지 못한 것이지 차가 없는 것이 아니다.
  t.mock.method(console, "error", () => {});
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("busarrivalservice")) return { data: gbisArrivalFixture };
    if (url.includes("busrouteservice")) throw new Error("network error");
    throw new Error(`이 테스트에서 예상하지 못한 axios.get 호출: ${url}`);
  });

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: DESTINATION_AFTER_TURN_POINT,
  });

  assert.equal(info.arrivalStatus, "UPSTREAM_ERROR");
  assert.deepEqual(info.arrivals, []);
});

test("3번 계약: 목적지가 노선에 없어 방향을 확정하지 못하면 UPSTREAM_ERROR 다", async (t) => {
  t.mock.method(console, "error", () => {});
  stubGbisArrivalAndRoute(t);

  const info = await getArrivalInfo({
    ...arrivalCandidate("233000281"),
    destinationStation: { stationName: "존재하지 않는 정류장", latitude: 0, longitude: 0 },
  });

  assert.equal(
    info.arrivalStatus,
    "UPSTREAM_ERROR",
    "방향을 확인하지 못한 것을 '차가 없다'로 안내하면 안 된다",
  );
  assert.deepEqual(info.arrivals, []);
});

// ── 진단 로그 ─────────────────────────────────────────────────────────
// "캐시는 MISS인데 GBIS를 실제로 불렀나, 불렀다면 뭘 받았나"를 로그로 갈라야 한다.
// serviceKey 와 전체 URL(query string 포함)은 절대 남기지 않는다.
test("GBIS 도착정보 조회의 시작과 완료를 안전한 필드만으로 남긴다", async (t) => {
  const lines: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  stubGbisArrival(t);

  await getArrivalInfo(arrivalCandidate("234000021"));

  const start = lines.find((line) => line.includes("[server/gbis] arrival request start"));
  const complete = lines.find((line) => line.includes("[server/gbis] arrival request complete"));

  assert.ok(start, `시작 로그가 없다: ${JSON.stringify(lines)}`);
  assert.match(start, /gbisStationId=233000575/);
  assert.match(start, /localBusId=234000021/);

  assert.ok(complete, `완료 로그가 없다: ${JSON.stringify(lines)}`);
  assert.match(complete, /durationMs=\d+/);
  assert.match(complete, /resultCode=0/);
  assert.match(complete, /predictedArrivalMinutes=\[4,7\]/);
  assert.match(complete, /arrivalStatus=AVAILABLE/);

  for (const line of [start, complete]) {
    assert.doesNotMatch(line, /serviceKey/i, "API 키 이름조차 남기지 않는다");
    assert.doesNotMatch(line, /https?:\/\//, "외부 URL 전체를 남기지 않는다");
  }
});
