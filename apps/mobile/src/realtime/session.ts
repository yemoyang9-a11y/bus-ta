import { apiClient } from "../api/client";
import { dispatchRealtimeFunctionCall, isRealtimeFunctionCallEvent } from "./function-dispatcher";
import { checkAndDispatchStatusChange } from "./event-dispatcher";
import {
  createRealtimeReadyResponseEvent,
  createRealtimeSessionUpdateEvent,
} from "./guide";
import type {
  CreateRealtimeSessionResponse,
  RealtimeGuideContext,
  RealtimeTransport,
  TripStatusChangedEvent,
  TripStatusSnapshot,
} from "./types";
import { getRealtimeSharedSecret } from "./runtime-config";
import { RealtimeWebRTCTransport } from "./webrtc-transport";
import { RealtimeResponseQueue, type PendingResponse } from "./response-queue";
import { getRealtimeErrorDetails } from "./server-event";
import {
  DEFAULT_REALTIME_CONNECTION_TIMEOUT_MS,
  runWithRealtimeConnectionTimeout,
} from "./connection-timeout";

// OpenAI Realtime은 동시에 하나의 active response만 허용한다.
const RESPONSE_CREATE_EVENT_TYPE = "response.create";
const ACTIVE_RESPONSE_ERROR_CODE = "conversation_already_has_active_response";
const STATUS_RESPONSE_INSTRUCTIONS =
  "방금 전달된 운행 상태 변화만 근거로 사용자에게 짧고 명확한 한국어 음성 안내를 생성한다. tripStatus가 WAITING_BUS이면 탑승 정류장에서 버스를 기다리는 상태이며, 절대 '탑승했습니다', '탑승 중입니다', '운행을 시작합니다'라고 말하지 않는다. tripStatus가 ON_BUS으로 실제 확인되고 아직 탑승 확인 안내를 하지 않은 경우에만 선택된 실제 routeNo를 사용해 'OO번 버스 탑승이 확인되었습니다.'라고 안내한다. routeNo의 숫자 부분이 네 자리 이상이면 각 숫자를 한 자리씩 읽고, 세 자리 이하면 일반적인 한국어 수 읽기 방식으로 읽는다. 알파벳, 하이픈 뒤 숫자, 괄호 안 표시는 생략하지 않으며, 하이픈(-)은 반드시 '다시'라고 읽는다. routeNo를 확인할 수 없으면 번호를 만들지 말고 '버스 탑승이 확인되었습니다.'라고 안내한다. 내부 식별자와 오류 코드는 그대로 읽지 않는다.";

export class HaneumRealtimeSession {
  readonly context: RealtimeGuideContext;
  private transport: RealtimeTransport | null = null;
  private isResponseActive = false;
  private isOutputAudioActive = false;
  private responseQueue = new RealtimeResponseQueue();
  private activeResponse: PendingResponse | null = null;
  private awaitingRetry: PendingResponse | null = null;
  private eventIdCounter = 0;
  private hasSentReadyResponse = false;

  // context는 RealtimeProvider가 TripContext와 연결해서 만든 것을 그대로 받는다.
  // (2026-08-12, 예모님 확정: TripContext를 운행 상태의 유일한 원본으로 사용)
  constructor(context: RealtimeGuideContext) {
    this.context = context;
  }

  async createClientSecret(
    sharedSecret?: string,
    signal?: AbortSignal,
  ): Promise<CreateRealtimeSessionResponse> {
    return apiClient.realtime.createSession(
      sharedSecret ?? getRealtimeSharedSecret(),
      signal,
    );
  }

  sendSessionUpdate(transport: RealtimeTransport) {
    transport.send(createRealtimeSessionUpdateEvent());
  }

  async connectWebRTC(
    sharedSecret?: string,
    totalTimeoutMs = DEFAULT_REALTIME_CONNECTION_TIMEOUT_MS,
  ): Promise<RealtimeWebRTCTransport> {
    let pendingTransport: RealtimeWebRTCTransport | null = null;

    try {
      return await runWithRealtimeConnectionTimeout(async (signal) => {
        const { clientSecret } = await this.createClientSecret(sharedSecret, signal);
        const transport = new RealtimeWebRTCTransport({
          clientSecret,
          signal,
          onServerEvent: (event) => {
            this.handleServerEvent(event, transport).catch(() => {});
          },
        });
        pendingTransport = transport;

        await transport.connect();
        this.transport = transport;
        this.hasSentReadyResponse = false;
        this.sendSessionUpdate(transport);
        return transport;
      }, totalTimeoutMs);
    } catch (error) {
      pendingTransport?.close();
      throw error;
    }
  }

  async handleServerEvent(event: unknown, transport: RealtimeTransport) {
    this.trackResponseLifecycle(event);

    if (
      event != null &&
      typeof event === "object" &&
      (event as Record<string, unknown>).type === "session.updated" &&
      !this.hasSentReadyResponse
    ) {
      // 세션 instructions와 tools가 적용된 것을 확인한 뒤 시작 안내를 한 번만 생성한다.
      this.hasSentReadyResponse = true;
      this.send(createRealtimeReadyResponseEvent(), transport);
    }

    if (isRealtimeFunctionCallEvent(event)) {
      const clientEvents = await dispatchRealtimeFunctionCall(event, this.context);
      for (const clientEvent of clientEvents) {
        this.send(clientEvent, transport);
      }
      return;
    }
  }

  /**
   * 서버 이벤트를 보고 응답 진행 상태(isResponseActive)를 갱신한다.
   * response.done 뒤 실제 출력 버퍼까지 비워진 후 다음 대기 응답을 전송한다.
   */
  private trackResponseLifecycle(event: unknown) {
    if (event == null || typeof event !== "object") return;
    const value = event as Record<string, unknown>;
    const eventType = value.type;

    if (
      eventType === "input_audio_buffer.speech_started" ||
      eventType === "input_audio_buffer.speech_stopped"
    ) {
      console.log(
        `[Realtime] ${eventType} responseActive=${this.isResponseActive}`,
      );
      return;
    }

    if (
      eventType === "output_audio_buffer.started" ||
      eventType === "output_audio_buffer.stopped"
    ) {
      this.isOutputAudioActive = eventType === "output_audio_buffer.started";
      console.log(`[Realtime] ${eventType}`);
      if (!this.isOutputAudioActive) {
        this.flushPendingResponse();
      }
      return;
    }

    if (eventType === "session.updated") {
      const session = value.session as Record<string, unknown> | undefined;
      const audio = session?.audio as Record<string, unknown> | undefined;
      const input = audio?.input as Record<string, unknown> | undefined;
      console.log(
        "[Realtime] session.updated turn_detection:",
        JSON.stringify(input?.turn_detection ?? null),
      );
      return;
    }

    if (eventType === "response.created") {
      this.isResponseActive = true;
      return;
    }

    if (eventType === "response.done") {
      const response = value.response as Record<string, unknown> | undefined;
      const statusDetails = response?.status_details as
        | Record<string, unknown>
        | undefined;
      console.log(
        `[Realtime] response.done status=${String(response?.status ?? "unknown")} reason=${String(statusDetails?.reason ?? "none")}`,
      );
      this.isResponseActive = false;
      this.activeResponse = null;
      this.flushPendingResponse();
      return;
    }

    if (eventType === "error") {
      const { code, clientEventId } = getRealtimeErrorDetails(value);
      console.log(
        `[Realtime] error code=${code ?? "unknown"} clientEventId=${clientEventId ?? "none"}`,
      );
      this.handleErrorEvent(value);
    }
  }

  /**
   * active response 오류는 응답 종료가 아니므로 실제 response.done 뒤에 재시도한다.
   * 그 외 오류는 해당 response.create 요청의 오류일 때만 다음 요청으로 넘어간다.
   */
  private handleErrorEvent(value: Record<string, unknown>) {
    const { code, clientEventId } = getRealtimeErrorDetails(value);
    const isActiveRequestError =
      this.activeResponse != null &&
      (clientEventId === undefined || clientEventId === this.activeResponse.eventId);

    if (code === ACTIVE_RESPONSE_ERROR_CODE) {
      if (isActiveRequestError && !this.awaitingRetry) {
        this.awaitingRetry = {
          ...this.activeResponse!,
          // 상태 시스템 이벤트는 이미 전달했으므로 response.create만 다시 보낸다.
          precedingEvents: [],
        };
        this.activeResponse = null;
      }
      this.isResponseActive = true;
      return;
    }

    if (!isActiveRequestError) return;

    this.activeResponse = null;
    this.isResponseActive = false;
    this.flushPendingResponse();
  }

  private flushPendingResponse() {
    if (this.isResponseActive || this.isOutputAudioActive || !this.transport) return;

    const next = this.awaitingRetry ?? this.responseQueue.dequeue();
    if (!next) return;

    this.awaitingRetry = null;
    this.dispatchResponseCreate(next);
  }

  private dispatchResponseCreate(pending: PendingResponse) {
    if (!this.transport) return;

    for (const event of pending.precedingEvents) {
      this.transport.send(event);
    }

    const dispatched = { ...pending, precedingEvents: [] };
    this.activeResponse = dispatched;
    this.isResponseActive = true;
    this.transport.send({
      type: RESPONSE_CREATE_EVENT_TYPE,
      event_id: pending.eventId,
      response: { instructions: pending.instructions },
    });
  }

  private createPendingResponse(
    instructions: string,
    precedingEvents: unknown[] = [],
  ): PendingResponse {
    return {
      eventId: `resp_${++this.eventIdCounter}`,
      instructions,
      precedingEvents,
    };
  }

  /**
   * response.create는 진행 중인 응답이 있으면 대기열에 쌓고, 없으면 바로 보낸다.
   * 그 외 이벤트는 그대로 전송한다.
   */
  private send(event: unknown, transport: RealtimeTransport) {
    if (event != null && typeof event === "object" && (event as Record<string, unknown>).type === RESPONSE_CREATE_EVENT_TYPE) {
      const instructions =
        ((event as { response?: { instructions?: string } }).response?.instructions) ?? "";
      this.responseQueue.enqueueDirect(this.createPendingResponse(instructions));
      this.flushPendingResponse();
      return;
    }

    transport.send(event);
  }

  /**
   * 방금 서버에서 받은 최신 상태(nextStatus)를 세션에 알린다.
   * RidingScreen이 PATCH /status 응답(data)을 받는 즉시, dispatch 결과를 기다리지 않고
   * 이 값을 직접 넘겨서 호출한다. (2026-08-13, 예모님 코멘트 2번 반영)
   *
   * 연결 전(this.transport가 없음)이면 아무것도 하지 않는다.
   */
  notifyStatusChange(nextStatus: TripStatusSnapshot) {
    if (!this.transport) return;

    checkAndDispatchStatusChange(this.context, nextStatus, (event: TripStatusChangedEvent) => {
      const statusEvent = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(event),
            },
          ],
        },
      };

      this.responseQueue.enqueueStatus(
        this.createPendingResponse(STATUS_RESPONSE_INSTRUCTIONS, [statusEvent]),
        event,
        this.context.getAppState().tripId,
      );
      this.flushPendingResponse();
    });
  }
}
