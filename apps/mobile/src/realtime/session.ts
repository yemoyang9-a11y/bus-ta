import { apiClient } from "../api/client";
import { createRealtimeGuideContext } from "./context";
import { dispatchRealtimeFunctionCall, isRealtimeFunctionCallEvent } from "./function-dispatcher";
import { createRealtimeSessionUpdateEvent } from "./guide";
import type {
  CreateRealtimeSessionResponse,
  RealtimeGuideContext,
  RealtimeTransport,
} from "./types";
import { getRealtimeSharedSecret } from "./runtime-config";
import { RealtimeWebRTCTransport } from "./webrtc-transport";

export class HaneumRealtimeSession {
  readonly context: RealtimeGuideContext;

  constructor(context: RealtimeGuideContext = createRealtimeGuideContext()) {
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
