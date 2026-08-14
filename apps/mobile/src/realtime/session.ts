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

// 예모님 코멘트 4번(2026-08-13): OpenAI Realtime은 동시에 하나의 active response만 허용한다.
// 상태 변화(3초 주기)와 Function 결과가 겹치면 response.create가 거부될 수 있어,
// 지금 응답이 진행 중인지 추적해서 큐로 순서를 보장한다.
const RESPONSE_CREATE_EVENT_TYPE = "response.create";

export class HaneumRealtimeSession {
  readonly context: RealtimeGuideContext;
  private transport: RealtimeTransport | null = null;
  private isResponseActive = false;
  private pendingResponseInstructions: string[] = [];

  // context는 RealtimeProvider가 TripContext와 연결해서 만든 것을 그대로 받는다.
  // (2026-08-12, 예모님 확정: TripContext를 운행 상태의 유일한 원본으로 사용)
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
   * response.created면 진행 중으로 표시하고, response.done이면 해제하고
   * 대기 중인 response.create가 있으면 이어서 보낸다.
   */
  private trackResponseLifecycle(event: unknown) {
    if (event == null || typeof event !== "object") return;
    const value = event as Record<string, unknown>;

    if (value.type === "response.created") {
      this.isResponseActive = true;
      return;
    }

    if (value.type === "response.done") {
      // 예모님 코멘트 4번(2026-08-13): 원인 파악을 위해 로그로 남긴다.
      console.log("[Realtime] response.done:", JSON.stringify(value));
      this.isResponseActive = false;
      this.flushPendingResponse();
      return;
    }

    if (value.type === "error") {
      console.log("[Realtime] error event:", JSON.stringify(value));
      this.isResponseActive = false;
      this.flushPendingResponse();
    }
  }

  /**
   * 대기열에 쌓인 응답 요청 중 가장 오래된 것을 하나 보낸다.
   * 여러 개가 쌓여 있어도 한 번에 하나만 보내고, 나머지는 response.done을 기다린다.
   */
  private flushPendingResponse() {
    if (this.isResponseActive || !this.transport) return;
    const instructions = this.pendingResponseInstructions.shift();
    if (instructions === undefined) return;

    this.isResponseActive = true;
    this.transport.send({
      type: RESPONSE_CREATE_EVENT_TYPE,
      response: { instructions },
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

      if (this.isResponseActive) {
        this.pendingResponseInstructions.push(instructions);
        return;
      }

      this.isResponseActive = true;
      transport.send(event);
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

      // 예모님 코멘트 3번(2026-08-13): 상태 메시지만 보내면 AI가 응답을 생성하지 않는다.
      // 예모님 코멘트 4번(2026-08-13): 이미 응답이 진행 중이면 send()가 대기열에 넣어
      // response.done 이후 자동으로 전송하도록 한다.
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