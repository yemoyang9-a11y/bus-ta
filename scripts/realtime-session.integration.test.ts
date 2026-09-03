import assert from "node:assert/strict";
import test from "node:test";
import { HaneumRealtimeSession } from "../apps/mobile/src/realtime/session.js";
import type {
  AppAction,
  AppTripState,
  RealtimeGuideContext,
  RealtimeTransport,
} from "../apps/mobile/src/realtime/types.js";

type SessionHarness = {
  transport: RealtimeTransport | null;
  send(event: unknown, transport: RealtimeTransport): void;
};

function createSessionHarness() {
  const actions: AppAction[] = [];
  const sentEvents: unknown[] = [];
  const state: AppTripState = {
    destination: "수원대학교",
    routeCandidates: null,
    announcedCandidateIds: [],
    selectedRoute: null,
    tripId: null,
    tripStatus: null,
    boardingMethod: null,
    boardingConfirmedAt: null,
    currentStation: null,
    nextStation: null,
    remainingStations: null,
    guideMessage: null,
    bellStatus: "NOT_REQUESTED",
    bellRequestId: null,
    command: null,
    lastFunctionResult: null,
    lastInjectedStatus: null,
  };
  const context: RealtimeGuideContext = {
    getAppState: () => state,
    getCurrentLocation: () => undefined,
    refreshCurrentLocation: async () => {},
    dispatchAppAction: (action) => {
      actions.push(action);

      if (action.type === "MARK_CANDIDATES_ANNOUNCED") {
        state.announcedCandidateIds = [
          ...new Set([
            ...state.announcedCandidateIds,
            ...action.candidateIds,
          ]),
        ];
      }
    },
  };
  const transport: RealtimeTransport = {
    send: (event) => sentEvents.push(event),
  };
  const session = new HaneumRealtimeSession(context);
  const harness = session as unknown as SessionHarness;
  harness.transport = transport;

  const queueCandidateResponse = (candidateIds: number[]) => {
    harness.send(
      {
        type: "response.create",
        response: { instructions: "후보를 안내한다." },
        candidateIdsToMark: candidateIds,
      },
      transport,
    );
  };

  return {
    actions,
    queueCandidateResponse,
    session,
    state,
    transport,
  };
}

function markedCandidateActions(actions: AppAction[]) {
  return actions.filter(
    (action): action is Extract<
      AppAction,
      { type: "MARK_CANDIDATES_ANNOUNCED" }
    > => action.type === "MARK_CANDIDATES_ANNOUNCED",
  );
}

test("후보는 response.done 뒤 실제 오디오 출력까지 끝나야 안내 완료로 기록한다", async () => {
  const { actions, queueCandidateResponse, session, transport } =
    createSessionHarness();

  queueCandidateResponse([1, 2]);
  await session.handleServerEvent(
    { type: "output_audio_buffer.started" },
    transport,
  );
  await session.handleServerEvent(
    {
      type: "response.done",
      response: { status: "completed" },
    },
    transport,
  );

  assert.deepEqual(markedCandidateActions(actions), []);

  await session.handleServerEvent(
    { type: "output_audio_buffer.stopped" },
    transport,
  );

  assert.deepEqual(markedCandidateActions(actions), [
    {
      type: "MARK_CANDIDATES_ANNOUNCED",
      candidateIds: [1, 2],
    },
  ]);
});

test("실패한 후보 응답은 오디오가 끝나도 안내 완료로 기록하지 않는다", async () => {
  const { actions, queueCandidateResponse, session, transport } =
    createSessionHarness();

  queueCandidateResponse([3, 4]);
  await session.handleServerEvent(
    { type: "output_audio_buffer.started" },
    transport,
  );
  await session.handleServerEvent(
    {
      type: "response.done",
      response: { status: "failed" },
    },
    transport,
  );
  await session.handleServerEvent(
    { type: "output_audio_buffer.stopped" },
    transport,
  );

  assert.deepEqual(markedCandidateActions(actions), []);
});

test("중단된 후보 음성은 기록하지 않고 같은 후보의 재안내를 허용한다", async () => {
  const { actions, queueCandidateResponse, session, transport } =
    createSessionHarness();

  queueCandidateResponse([5, 6]);
  await session.handleServerEvent(
    { type: "output_audio_buffer.started" },
    transport,
  );
  await session.handleServerEvent(
    {
      type: "response.done",
      response: { status: "cancelled" },
    },
    transport,
  );
  await session.handleServerEvent(
    { type: "output_audio_buffer.stopped" },
    transport,
  );

  assert.deepEqual(markedCandidateActions(actions), []);

  queueCandidateResponse([5, 6]);
  await session.handleServerEvent(
    {
      type: "response.done",
      response: { status: "completed" },
    },
    transport,
  );

  assert.deepEqual(markedCandidateActions(actions), [
    {
      type: "MARK_CANDIDATES_ANNOUNCED",
      candidateIds: [5, 6],
    },
  ]);
});

test("중복 get_next 후보 응답은 같은 candidateId를 두 번 기록하지 않는다", async () => {
  const { actions, queueCandidateResponse, session, state, transport } =
    createSessionHarness();

  queueCandidateResponse([7, 8]);
  queueCandidateResponse([7, 8]);

  await session.handleServerEvent(
    {
      type: "response.done",
      response: { status: "completed" },
    },
    transport,
  );
  await session.handleServerEvent(
    {
      type: "response.done",
      response: { status: "completed" },
    },
    transport,
  );

  assert.deepEqual(state.announcedCandidateIds, [7, 8]);
  assert.equal(markedCandidateActions(actions).length, 1);
});
