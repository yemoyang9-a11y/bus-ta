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
  // 예모님 코멘트 1번(2026-08-13): 데이터 채널이 열릴 때까지 기다리는 타임아웃(ms). 기본 10초.
  connectTimeoutMs?: number;
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

const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

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
    let mediaStream: MediaStream | null = null;

    try {
      mediaStream = await mediaDevices.getUserMedia({ audio: true, video: false });
      const dataChannel = peerConnection.createDataChannel("oai-events") as unknown as RealtimeDataChannel;

      mediaStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, mediaStream as MediaStream);
      });

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

      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Accept: "application/sdp",
          Authorization: `Bearer ${this.options.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp ?? "",
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

      // 예모님 코멘트 1번 핵심 수정: setRemoteDescription이 끝났다고 채널이 열린 게 아니다.
      // ICE/DTLS 협상이 끝나야 dataChannel.onopen이 호출되므로, 그때까지 기다린 뒤 반환한다.
      await this.waitForDataChannelOpen(dataChannel);

      this.peerConnection = peerConnection;
      this.dataChannel = dataChannel;
      this.mediaStream = mediaStream;

      this.options.onOpen?.();
    } catch (error) {
      // 예모님 코멘트 1번 추가 사항: 실패 시 만들어둔 리소스를 정리한다.
      // 지금까지는 예외 경로에서 close()가 실행되지 않아 peer connection·마이크 stream이 남아있었다.
      mediaStream?.getTracks().forEach((track) => track.stop());
      peerConnection.close();
      throw error;
    }
  }

  private waitForDataChannelOpen(dataChannel: RealtimeDataChannel): Promise<void> {
    const timeoutMs = this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      if (dataChannel.readyState === "open") {
        resolve();
        return;
      }

      const timeoutId = setTimeout(() => {
        dataChannel.onopen = null;
        reject(new Error(`Realtime data channel이 ${timeoutMs}ms 내에 열리지 않았습니다.`));
      }, timeoutMs);

      dataChannel.onopen = () => {
        clearTimeout(timeoutId);
        resolve();
      };
    });
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