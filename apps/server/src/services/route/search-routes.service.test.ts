import assert from "node:assert/strict";
import test from "node:test";
import type { Route } from "@bus-ta/shared";
import { searchRoutes } from "./search-routes.service.js";
import { mockSearchRoutes } from "../../adapters/routes/mock-route-search.adapter.js";

const validRequest = {
  destination: "수원대",
  latitude: 37.49,
  longitude: 127.03,
};

test("returns guided route candidates for a valid request", async () => {
  const result = await searchRoutes(validRequest, {
    searchRoutes: mockSearchRoutes,
    generateRouteGuide: async () => ({
      selectedCandidates: [
        { candidateId: 2, guideMessage: "2번 후보 안내입니다." },
        { candidateId: 1, guideMessage: "1번 후보 안내입니다." },
      ],
    }),
    now: () => "2026-07-01T15:10:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.success, true);
  assert.deepEqual(
    result.body.routes.map((route) => route.candidateId),
    [1, 2],
  );
  assert.deepEqual(
    result.body.routes.map((route) => route.guideMessage),
    ["1번 후보 안내입니다.", "2번 후보 안내입니다."],
  );
  assert.equal(result.body.routes[0]?.recommendationReason, undefined);
});

test("returns the top 5 routes in ranked order and guides only the top 2", async () => {
  const baseRoutes = await mockSearchRoutes(validRequest);
  const firstRoute = baseRoutes[0];
  assert.ok(firstRoute);

  const routes: Route[] = Array.from({ length: 6 }, (_, index) => ({
    ...firstRoute,
    candidateId: index + 1,
    routeNo: String(index + 1),
    guideMessage: "stale guide should not leak",
  }));
  let searchCallCount = 0;
  let guidedCandidateIds: number[] = [];

  const result = await searchRoutes(validRequest, {
    searchRoutes: async () => {
      searchCallCount += 1;
      return routes;
    },
    generateRouteGuide: async ({ candidates }) => {
      guidedCandidateIds = candidates.map((candidate) => candidate.candidateId);
      return {
        selectedCandidates: [
          { candidateId: 1, guideMessage: "1번 후보 안내입니다." },
          { candidateId: 2, guideMessage: "2번 후보 안내입니다." },
        ],
      };
    },
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.routes.length, 5);
  assert.deepEqual(
    result.body.routes.map((route) => route.candidateId),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(guidedCandidateIds, [1, 2]);
  assert.equal(searchCallCount, 1);
  assert.deepEqual(
    result.body.routes.map((route) => route.guideMessage),
    ["1번 후보 안내입니다.", "2번 후보 안내입니다.", undefined, undefined, undefined],
  );
});

test("falls back to the first 2 routes when guide selection is empty", async () => {
  const result = await searchRoutes(validRequest, {
    searchRoutes: mockSearchRoutes,
    generateRouteGuide: async () => ({ selectedCandidates: [] }),
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.deepEqual(
    result.body.routes.map((route) => route.candidateId),
    [1, 2],
  );
});

test("falls back when guide returns unknown candidate ids", async () => {
  const result = await searchRoutes(validRequest, {
    searchRoutes: mockSearchRoutes,
    generateRouteGuide: async () => ({
      selectedCandidates: [{ candidateId: 999, guideMessage: "없는 후보입니다." }],
    }),
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.deepEqual(
    result.body.routes.map((route) => route.candidateId),
    [1, 2],
  );
});

test("returns 400 for an invalid request", async () => {
  const result = await searchRoutes(
    { destination: "", latitude: 37.49, longitude: 127.03 },
    { searchRoutes: mockSearchRoutes, now: () => "2026-07-01T15:10:01+09:00" },
  );

  assert.equal(result.httpStatus, 400);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "INVALID_REQUEST");
});

test("returns 502 when the route search provider throws", async (t) => {
  // 실패 원인은 console.error 로 남는다. 테스트 출력이 지저분해지지 않도록 가로챈다.
  t.mock.method(console, "error", () => {});

  const result = await searchRoutes(validRequest, {
    searchRoutes: async () => {
      throw new Error("provider down");
    },
    now: () => "2026-07-01T15:10:02+09:00",
  });

  assert.equal(result.httpStatus, 502);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "ROUTE_SEARCH_FAILED");
});

test("502로 응답할 때 어느 upstream이 어떤 상태로 실패했는지 로그로 남긴다", async (t) => {
  const logged: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(args.map((arg) => String(arg)).join(" "));
  });

  const result = await searchRoutes(validRequest, {
    searchRoutes: async () => {
      throw Object.assign(new Error("Request failed with status code 401"), {
        upstream: "KAKAO",
        status: 401,
      });
    },
    now: () => "2026-07-01T15:10:04+09:00",
  });

  assert.equal(result.httpStatus, 502);

  const line = logged.join("\n");
  assert.match(line, /KAKAO/, "실패한 upstream 이름이 남아야 한다");
  assert.match(line, /401/, "상태 코드가 남아야 한다");
});

test("실패 로그에 AxiosError가 들고 있는 API 키가 섞이지 않는다", async (t) => {
  const secret = "service-test-secret-key";
  const logged: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(args.map((arg) => String(arg)).join(" "));
  });

  await searchRoutes(validRequest, {
    searchRoutes: async () => {
      throw Object.assign(new Error("Request failed with status code 401"), {
        upstream: "KAKAO",
        status: 401,
        config: { headers: { Authorization: `KakaoAK ${secret}` }, params: { apiKey: secret } },
      });
    },
    now: () => "2026-07-01T15:10:05+09:00",
  });

  assert.ok(logged.length > 0, "실패 원인이 최소한 한 줄은 남아야 한다");
  assert.ok(
    !logged.join("\n").includes(secret),
    "오류 객체를 통째로 찍으면 config 에 실린 키가 로그로 샌다",
  );
});

test("returns an empty candidate list message when the provider has no matches", async () => {
  const result = await searchRoutes(validRequest, {
    searchRoutes: async () => [],
    now: () => "2026-07-01T15:10:03+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.routes.length, 0);
  assert.equal(result.body.message, "조건에 맞는 노선 후보가 없습니다.");
});
