import { apiClient } from "../api/client";
import { createRealtimeGuideContext } from "./context";
import { dispatchRealtimeFunctionCall, isRealtimeFunctionCallEvent } from "./function-dispatcher";
import { createRealtimeSessionUpdateEvent, HANEUM_REALTIME_MODEL } from "./guide";
import type {
  CreateRealtimeSessionResponse,
  RealtimeGuideContext,
  RealtimeTransport,
} from "./types";
import { RealtimeWebRTCTransport } from "./webrtc-transport";

export class HaneumRealtimeSession {
  readonly context: RealtimeGuideContext;

  constructor(context: RealtimeGuideContext = createRealtimeGuideContext()) {
    this.context = context;
  }

  async createClientSecret(sharedSecret?: string): Promise<CreateRealtimeSessionResponse> {
    return apiClient.realtime.createSession(sharedSecret);
  }

  sendSessionUpdate(transport: RealtimeTransport) {
    transport.send(createRealtimeSessionUpdateEvent());
  }

  async connectWebRTC(sharedSecret?: string): Promise<RealtimeWebRTCTransport> {
    const { clientSecret, model } = await this.createClientSecret(sharedSecret);
    let transport: RealtimeWebRTCTransport;
    transport = new RealtimeWebRTCTransport({
      clientSecret,
      model: model || HANEUM_REALTIME_MODEL,
      onServerEvent: (event) => {
        this.handleServerEvent(event, transport).catch(() => {});
      },
    });

    await transport.connect();
    this.sendSessionUpdate(transport);
    return transport;
  }

  async handleServerEvent(event: unknown, transport: RealtimeTransport) {
    if (!isRealtimeFunctionCallEvent(event)) return;

    const clientEvents = await dispatchRealtimeFunctionCall(event, this.context);
    for (const clientEvent of clientEvents) {
      transport.send(clientEvent);
    }
  }
}
