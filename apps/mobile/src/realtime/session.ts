import { apiClient } from "../api/client";
import { dispatchRealtimeFunctionCall, isRealtimeFunctionCallEvent } from "./function-dispatcher";
import { checkAndDispatchStatusChange } from "./event-dispatcher";
import { createRealtimeSessionUpdateEvent } from "./guide";
import type {
  CreateRealtimeSessionResponse,
  RealtimeGuideContext,
  RealtimeTransport,
  TripStatusChangedEvent,
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
   * TripContext의 최신 상태를 확인해서, 변화가 있으면 세션에 시스템 이벤트를 주입한다.
   * RidingScreen 등에서 GPS 응답을 받을 때마다 호출한다.
   * 연결 전(this.transport가 없음)이면 아무것도 하지 않는다.
   */
  notifyStatusChange() {
    if (!this.transport) return;

    checkAndDispatchStatusChange(this.context, (event: TripStatusChangedEvent) => {
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
    });
  }
}