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

export class HaneumRealtimeSession {
  readonly context: RealtimeGuideContext;
  private transport: RealtimeTransport | null = null;

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
    if (!isRealtimeFunctionCallEvent(event)) return;

    const clientEvents = await dispatchRealtimeFunctionCall(event, this.context);
    for (const clientEvent of clientEvents) {
      transport.send(clientEvent);
    }
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
      this.transport?.send({
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
      // Function 결과 처리와 마찬가지로 response.create를 이어서 보내야 음성 안내가 생성된다.
      this.transport?.send({
        type: "response.create",
        response: {
          instructions:
            "방금 전달된 운행 상태 변화만 근거로 사용자에게 짧고 명확한 한국어 음성 안내를 생성한다. 내부 식별자와 오류 코드는 그대로 읽지 않는다.",
        },
      });
    });
  }
}