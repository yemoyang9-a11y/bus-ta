import {
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
  type MediaStream,
} from "react-native-webrtc";
import type { RealtimeTransport } from "./types";

type RealtimeWebRTCTransportOptions = {
  clientSecret: string;
  onServerEvent?: (event: unknown) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: unknown) => void;
};

type RealtimeDataChannel = {
  readyState: string;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((error: unknown) => void) | null;
  onmessage: ((message: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
};

export class RealtimeWebRTCTransport implements RealtimeTransport {
  private readonly options: RealtimeWebRTCTransportOptions;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RealtimeDataChannel | null = null;
  private mediaStream: MediaStream | null = null;

  constructor(options: RealtimeWebRTCTransportOptions) {
    this.options = options;
  }

  async connect() {
    const peerConnection = new RTCPeerConnection();
    const mediaStream = await mediaDevices.getUserMedia({ audio: true, video: false });
    const dataChannel = peerConnection.createDataChannel("oai-events") as RealtimeDataChannel;

    mediaStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, mediaStream);
    });

    dataChannel.onopen = () => {
      this.options.onOpen?.();
    };
    dataChannel.onclose = () => {
      this.options.onClose?.();
    };
    dataChannel.onerror = (error) => {
      this.options.onError?.(error);
    };
    dataChannel.onmessage = (message) => {
      this.handleMessage(message);
    };

    const offer = await peerConnection.createOffer({});
    await peerConnection.setLocalDescription(offer);

    const formData = new FormData();
    formData.append("sdp", offer.sdp ?? "");

    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Accept: "application/sdp",
        Authorization: `Bearer ${this.options.clientSecret}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Realtime WebRTC 연결에 실패했습니다. status=${response.status}`);
    }

    const answerSdp = await response.text();
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription({
        type: "answer",
        sdp: answerSdp,
      }),
    );

    this.peerConnection = peerConnection;
    this.dataChannel = dataChannel;
    this.mediaStream = mediaStream;
  }

  send(event: unknown) {
    if (this.dataChannel?.readyState !== "open") {
      throw new Error("Realtime data channel이 아직 열리지 않았습니다.");
    }

    this.dataChannel.send(JSON.stringify(event));
  }

  close() {
    this.dataChannel?.close();
    this.mediaStream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.peerConnection?.close();

    this.dataChannel = null;
    this.mediaStream = null;
    this.peerConnection = null;
  }

  private handleMessage(message: { data: unknown }) {
    try {
      const serverEvent = JSON.parse(String(message.data));
      this.options.onServerEvent?.(serverEvent);
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}
