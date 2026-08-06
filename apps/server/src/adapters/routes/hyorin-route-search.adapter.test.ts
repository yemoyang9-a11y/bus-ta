import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import axios from "axios";
import { RouteCandidateSchema } from "@bus-ta/shared";
import { searchRoutes } from "./hyorin-route-search.adapter.js";

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
