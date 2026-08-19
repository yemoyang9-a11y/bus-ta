import { apiClient } from "../api/client";
import { dispatchRealtimeFunctionCall, isRealtimeFunctionCallEvent } from "./function-dispatcher";
import { checkAndDispatchStatusChange } from "./event-dispatcher";
import { createRealtimeSessionUpdateEvent } from "./guide";
import type {
  CreateRealtimeSessionResponse,
  RealtimeGuideContext,
  RealtimeTransport,
  TripStatusChangedEvent,
  TripStatusSnapshot,
} from "./types";
import { getRealtimeSharedSecret } from "./runtime-config";
import { RealtimeWebRTCTransport } from "./webrtc-transport";

// OpenAI Realtime은 동시에 하나의 active response만 허용한다.
const RESPONSE_CREATE_EVENT_TYPE = "response.create";

// 유나님 확인(2026-08-15): conversation_already_has_active_response는 "응답 종료"가 아니다.
// 이 에러 코드일 때는 isResponseActive를 유지하고, 실패한 요청을 버리지 않고 대기열 맨 앞에
// 다시 넣어서 진짜 response.done이 온 뒤에만 재전송한다. 다른 종류의 에러는 무한 재전송을
// 막기 위해 응답 진행 상태를 해제하고 넘어간다.
const ACTIVE_RESPONSE_ERROR_CODE = "conversation_already_has_active_response";

type PendingResponse = {
  eventId: string;
  instructions: string;
};

export class HaneumRealtimeSession {
  readonly context: RealtimeGuideContext;
  private transport: RealtimeTransport | null = null;
  private isResponseActive = false;
  private pendingResponses: PendingResponse[] = [];
  private eventIdCounter = 0;
  // 이미 전송을 시도했지만 conversation_already_has_active_response로 실패한 요청.
  // 진짜 response.done이 오기 전까지는 이 요청을 최우선으로 다시 보낸다.
  private awaitingRetry: PendingResponse | null = null;

  // context는 RealtimeProvider가 TripContext와 연결해서 만든 것을 그대로 받는다.
  // (2026-08-12, 예모님 확정 구조: TripContext를 운행 상태의 유일한 원본으로 사용)
  constructor(context: RealtimeGuideContext) {
    this.context = context;
  }

  async createClientSecret(sharedSecret?: string): Promise<CreateRealtimeSessionResponse> {
    return apiClient.realtime.createSession(sharedSecret ?? getRealtimeSharedSecret());
  }

  sendSessionUpdate(transport: RealtimeTransport) {
    transport.send(createRealtimeSessionUpdateEvent());
  }

  async connectWebRTC(sharedSecret?: string): Promise<RealtimeWebRTCTransport> {
    const { clientSecret } = await this.createClientSecret(sharedSecret);
    let transport: RealtimeWebRTCTransport;
    transport = new RealtimeWebRTCTransport({
      clientSecret,
      onServerEvent: (event) => {
        this.handleServerEvent(event, transport).catch(() => {});
      },
    });

    await transport.connect();
    this.sendSessionUpdate(transport);
    this.transport = transport;
    return transport;
  }

  async handleServerEvent(event: unknown, transport: RealtimeTransport) {
    this.trackResponseLifecycle(event);

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
   */
  private trackResponseLifecycle(event: unknown) {
    if (event == null || typeof event !== "object") return;
    const value = event as Record<string, unknown>;

    if (value.type === "response.created") {
      this.isResponseActive = true;
      return;
    }

    if (value.type === "response.done") {
      console.log("[Realtime] response.done:", JSON.stringify(value));
      this.isResponseActive = false;
      // 진짜로 응답이 끝났으니, 재시도 대기 중이던 요청이 있으면 그걸 최우선으로 다시 보낸다.
      this.flushPendingResponse();
      return;
    }

    if (value.type === "error") {
      console.log("[Realtime] error event:", JSON.stringify(value));
      this.handleErrorEvent(value);
    }
  }

  /**
   * 유나님 확인(2026-08-15): conversation_already_has_active_response는 응답이 끝난 게
   * 아니라 "아직 안 끝났다"는 신호다. isResponseActive를 계속 true로 유지하고,
   * 방금 실패한 요청을 awaitingRetry에 보관해서 진짜 response.done 이후에만 재전송한다.
   * 그 외 에러는 무한 재전송을 막기 위해 응답 상태를 해제하고 다음 대기 요청으로 넘어간다.
   */
  private handleErrorEvent(value: Record<string, unknown>) {
    const error = value.error as Record<string, unknown> | undefined;
    const code = error?.code;
    const eventId = typeof value.event_id === "string" ? value.event_id : undefined;

    if (code === ACTIVE_RESPONSE_ERROR_CODE) {
      // isResponseActive는 그대로 true로 둔다 — 실제로는 아직 응답이 진행 중이라는 뜻이므로.
      const failed = eventId ? this.takeSentRequest(eventId) : undefined;
      if (failed && !this.awaitingRetry) {
        this.awaitingRetry = failed;
      }
      return;
    }

    // 그 외 에러는 응답이 실질적으로 끝난 것으로 간주하고, 다음 대기 요청으로 넘어간다.
    this.isResponseActive = false;
    this.flushPendingResponse();
  }

  private sentRequests: Map<string, PendingResponse> = new Map();

  private takeSentRequest(eventId: string): PendingResponse | undefined {
    const request = this.sentRequests.get(eventId);
    this.sentRequests.delete(eventId);
    return request;
  }

  /**
   * 대기열에서 다음 응답을 하나 보낸다. awaitingRetry(재시도 대기 요청)가 있으면 그걸 최우선으로 보낸다.
   */
  private flushPendingResponse() {
    if (this.isResponseActive || !this.transport) return;

    const next = this.awaitingRetry ?? this.pendingResponses.shift();
    if (!next) return;

    this.awaitingRetry = null;
    this.dispatchResponseCreate(next);
  }

  private dispatchResponseCreate(pending: PendingResponse) {
    if (!this.transport) return;

    this.isResponseActive = true;
    this.sentRequests.set(pending.eventId, pending);
    this.transport.send({
      type: RESPONSE_CREATE_EVENT_TYPE,
      event_id: pending.eventId,
      response: { instructions: pending.instructions },
    });
  }

  /**
   * response.create는 진행 중인 응답이 있으면 대기열에 쌓고, 없으면 바로 보낸다.
   * 그 외 이벤트는 그대로 전송한다.
   */
  private send(event: unknown, transport: RealtimeTransport) {
    if (event != null && typeof event === "object" && (event as Record<string, unknown>).type === RESPONSE_CREATE_EVENT_TYPE) {
      const instructions =
        ((event as { response?: { instructions?: string } }).response?.instructions) ?? "";
      const pending: PendingResponse = {
        eventId: `resp_${++this.eventIdCounter}`,
        instructions,
      };

      if (this.isResponseActive) {
        this.pendingResponses.push(pending);
        return;
      }

      this.dispatchResponseCreate(pending);
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
    const transport = this.transport;

    checkAndDispatchStatusChange(this.context, nextStatus, (event: TripStatusChangedEvent) => {
      transport.send({
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
      });

      this.send(
        {
          type: RESPONSE_CREATE_EVENT_TYPE,
          response: {
            instructions:
              "방금 전달된 운행 상태 변화만 근거로 사용자에게 짧고 명확한 한국어 음성 안내를 생성한다. 내부 식별자와 오류 코드는 그대로 읽지 않는다.",
          },
        },
        transport,
      );
    });
  }
}