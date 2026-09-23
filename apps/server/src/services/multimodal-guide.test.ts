import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { DEMO_ROUTE, type Route } from "@bus-ta/shared";

const previous = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = "test-only";
const { generateRouteGuide, selectRouteCandidates } = await import("./guide.js");
if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
const route: Route = { ...DEMO_ROUTE, candidateId: 1, routeNo: "1551", routeMode: "MULTIMODAL", tripSupported: false, totalTime: 40,
  segments: [
    { mode: "WALK", startName: "출발지", endName: "첫역", lineNames: [], routeNumbers: [] },
    { mode: "SUBWAY", startName: "첫역", endName: "환승역", lineNames: ["1호선"], routeNumbers: [] },
    { mode: "BUS", startName: "환승정류장", endName: "마지막정류장", lineNames: [], routeNumbers: ["1551"] },
    { mode: "WALK", startName: "마지막정류장", endName: "최종목적지", lineNames: [], routeNumbers: [] },
  ] };

test("guide prompt contains ordered mixed journey and explicit guidance-only status", async (t) => {
  let prompt = "";
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (input: { messages: Array<{ content: string }> }) => {
    prompt = input.messages.map(m => m.content).join("\n");
    // Deliberately incomplete model output: the returned guide must still contain every leg.
    return { choices: [{ message: { content: JSON.stringify({ selectedCandidates: [{ candidateId: 1, guideMessage: "1551번 버스를 이용하세요." }] }) } }] };
  });
  const result = await generateRouteGuide({ destination: "최종목적지", candidates: [route] });
  assert.match(prompt, /routeMode: MULTIMODAL/);
  assert.match(prompt, /tripSupported: false/);
  assert.match(prompt, /도보.*첫역.*1호선.*환승역.*일 오 오 일.*마지막정류장.*도보.*최종목적지/s);
  assert.match(result.selectedCandidates[0]!.guideMessage, /안내 전용/);
  assert.match(result.selectedCandidates[0]!.guideMessage, /도보.*첫역.*1호선.*환승역.*일 오 오 일.*마지막정류장.*도보.*최종목적지/s);
});

test("empty model response falls back to all segments without announcing trip selection", async (t) => {
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async () => ({ choices: [] }));
  const result = await generateRouteGuide({ candidates: [route] });
  const guide = result.selectedCandidates[0]!.guideMessage;
  assert.match(guide, /첫역.*1호선.*환승역.*일 오 오 일.*마지막정류장.*최종목적지.*40분/s);
  assert.match(guide, /안내 전용/);
  assert.doesNotMatch(guide, /선택했습니다|운행을 시작/);
});

test("different subway journeys sharing a bus number remain separate candidates", () => {
  const other = { ...route, candidateId: 2, segments: route.segments!.map(s => s.mode === "SUBWAY" ? { ...s, lineNames: ["2호선"] } : s) };
  assert.equal(selectRouteCandidates([route, other]).length, 2);
});

test("supported transfer candidate offers segment guidance instead of guidance-only wording", async (t) => {
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async () => ({ choices: [] }));
  const result = await generateRouteGuide({ candidates: [{ ...route, journeySupported: true }] });
  const guide = result.selectedCandidates[0]!.guideMessage;
  assert.match(guide, /구간별 환승 안내/);
  assert.doesNotMatch(guide, /안내 전용/);
});
