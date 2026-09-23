import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { DEMO_ROUTE, type Route } from "@bus-ta/shared";
import { dispatchRealtimeFunctionCall } from "../../../mobile/src/realtime/function-dispatcher.js";
import { createRealtimeSessionUpdateEvent } from "../../../mobile/src/realtime/guide.js";
import type { AppAction, AppTripState, RealtimeGuideContext } from "../../../mobile/src/realtime/types.js";

const mixed: Route = { ...DEMO_ROUTE, candidateId: 71, routeMode: "MULTIMODAL", tripSupported: false,
  segments: [
    { mode: "BUS", startName: "첫탑승", endName: "첫하차", lineNames: [], routeNumbers: ["1551"] },
    { mode: "SUBWAY", startName: "환승역", endName: "최종역", lineNames: ["1호선"], routeNumbers: [] },
    { mode: "WALK", startName: "최종역", endName: "최종목적지", lineNames: [], routeNumbers: [] },
  ] };
function context(route: Route, actions: AppAction[]): RealtimeGuideContext {
  const state = { destination: "최종목적지", routeCandidates: [route], routeCandidatesExpiresAt: Date.now() + 60000,
    announcedCandidateIds: [], tripId: null, selectedRoute: null } as unknown as AppTripState;
  return { getAppState: () => state, getCurrentLocation: () => undefined, refreshCurrentLocation: async () => {}, dispatchAppAction: action => actions.push(action) };
}
function output(events: Awaited<ReturnType<typeof dispatchRealtimeFunctionCall>>) {
  const event = events.find(e => e.type === "conversation.item.create");
  assert.ok(event && event.type === "conversation.item.create");
  return JSON.parse(event.item.output);
}

for (const marker of [{ routeMode: "MULTIMODAL" as const }, { tripSupported: false }, { busTransitCount: 2 }]) {
  test(`voice create_trip rejects stored guidance-only candidate even when model omits metadata: ${JSON.stringify(marker)}`, async (t) => {
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => { requests++; throw Error("must not request"); });
    const actions: AppAction[] = [];
    const events = await dispatchRealtimeFunctionCall({ type: "response.function_call_arguments.done", call_id: "unsupported", name: "create_trip", arguments: JSON.stringify({ candidateId: 71 }) }, context({ ...DEMO_ROUTE, candidateId: 71, ...marker }, actions));
    assert.equal(requests, 0);
    const result = output(events);
    assert.equal(result.success, false); assert.match(result.message, /안내 전용/);
    assert.equal(actions.some(a => a.type === "START_TRIP" || a.type === "SELECT_ROUTE"), false);
    const response = events.find(e => e.type === "response.create");
    assert.ok(response && response.type === "response.create");
    const instructions = response.response?.instructions;
    assert.ok(instructions);
    assert.match(instructions, /success가 false/);
  });
}

test("next-candidate output preserves the entire journey and adds each bus pronunciation", async () => {
  const events = await dispatchRealtimeFunctionCall({ type: "response.function_call_arguments.done", call_id: "mixed-next", name: "get_next_route_candidates", arguments: "{}" }, context(mixed, []));
  const candidate = output(events).candidates[0];
  assert.equal(candidate.tripSupported, false); assert.equal(candidate.routeMode, "MULTIMODAL");
  assert.deepEqual(candidate.segments.map((s: { mode: string }) => s.mode), ["BUS", "SUBWAY", "WALK"]);
  assert.equal(candidate.segments.at(-1).endName, "최종목적지");
  assert.deepEqual(candidate.segments[0].routeNumbersSpoken, ["일 오 오 일"]);
  const response = events.find(e => e.type === "response.create");
  assert.ok(response && response.type === "response.create");
  const instructions = response.response?.instructions;
  assert.ok(instructions);
  assert.match(instructions, /segments/);
  assert.match(instructions, /안내 전용/);
});

test("session guide permits returned mixed routes but prohibits subway-only and mixed trip creation", () => {
  const guide = createRealtimeSessionUpdateEvent().session.instructions;
  assert.match(guide, /지하철 단독/); assert.match(guide, /MULTIMODAL/);
  assert.match(guide, /segments/); assert.match(guide, /안내 전용/);
  assert.doesNotMatch(guide, /다른 이동 수단은 제안하지 않는다/);
});

// Execute the actual screen render/onPress. Only RN and IO boundaries are stubbed.
function screen(route: Route) {
  const calls = { requests: [] as unknown[], actions: [] as any[], navigation: [] as unknown[], stops: 0 };
  const exports: any = {};
  const React = { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }), useState: () => [false, () => {}] };
  const modules: Record<string, unknown> = {
    react: React,
    "react-native": { View: "View", Text: "Text", TouchableOpacity: "TouchableOpacity", FlatList: "FlatList", StyleSheet: { create: (x: unknown) => x } },
    "../state/TripContext": { useTrip: () => ({ state: { destination: "최종목적지", routeCandidates: [route], routeCandidatesExpiresAt: Date.now() + 60000, beaconScanActive: true }, dispatch: (action: any) => calls.actions.push(action) }) },
    "../api/client": { ApiError: class extends Error {}, apiClient: { trips: { create: async (request: unknown) => { calls.requests.push(request); return { tripId: "direct-trip" }; } } } },
    "../ble/bleManager": { stopBeaconScan: async () => { calls.stops++; } },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL("../../../mobile/src/screens/RouteListScreen.js", import.meta.url), "utf8"), {
    fileName: "RouteListScreen.jsx", compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, Date, require: (name: string) => { if (!(name in modules)) throw Error(`Unexpected module ${name}`); return modules[name]; } });
  const tree = exports.default({ navigation: { navigate: (...args: unknown[]) => calls.navigation.push(args) } });
  const list = tree.children.find((child: any) => child?.type === "FlatList");
  const card = list.props.renderItem({ item: route, index: 0 });
  return { calls, card };
}
function renderedText(node: any): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  return (Array.isArray(node) ? node : node.children ?? []).map(renderedText).join(" ");
}

for (const marker of [{ routeMode: "MULTIMODAL" as const }, { tripSupported: false }, { busTransitCount: 2 }]) {
  test(`RouteList actual card and selection callback block guidance-only marker ${JSON.stringify(marker)}`, async () => {
    const app = screen({ ...DEMO_ROUTE, ...marker });
    assert.equal(app.card.props.disabled, true);
    await app.card.props.onPress();
    assert.deepEqual(app.calls, { requests: [], actions: [], navigation: [], stops: 0 });
  });
}

test("RouteList renders every mixed segment through the final destination", () => {
  const text = renderedText(screen(mixed).card);
  assert.match(text, /안내 전용/);
  assert.match(text, /첫탑승.*첫하차.*환승역.*최종역.*최종목적지/s);
  assert.doesNotMatch(text, /하차 정류장:.*병점역후문/);
});

test("legacy direct RouteList candidate still stops prior scan, creates and navigates", async () => {
  const app = screen({ ...DEMO_ROUTE });
  assert.notEqual(app.card.props.disabled, true);
  await app.card.props.onPress();
  assert.equal(app.calls.stops, 1); assert.equal(app.calls.requests.length, 1);
  assert.ok(app.calls.actions.some(a => a.type === "START_TRIP"));
  assert.equal((app.calls.navigation[0] as unknown[])[0], "Riding");
});
