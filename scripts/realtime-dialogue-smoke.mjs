import { randomBytes, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tls from "node:tls";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(repoRoot);

const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";
const apiKey = process.env.OPENAI_API_KEY?.trim();
const userText =
  process.argv.slice(2).join(" ").trim() ||
  "너는 한이음 버스 안내 AI야. 실제 사용자를 처음 만났을 때처럼 짧게 인사하고, 목적지를 물어봐.";

if (!apiKey) {
  console.error("OPENAI_API_KEY가 필요합니다. /Users/iyuna/Documents/한이음/.env에 넣어 주세요.");
  process.exit(1);
}

const instructions = readRealtimeInstructions();
const socket = await openRealtimeWebSocket(apiKey, model);
let finalText = "";
let closed = false;

socket.on("text", (raw) => {
  const event = parseJson(raw);
  if (!event) return;

  if (event.type === "error") {
    console.error("\n[Realtime error]", event.error?.message ?? event.message ?? event);
    closeAndExit(1);
    return;
  }

  if (
    event.type === "response.text.delta" ||
    event.type === "response.output_text.delta" ||
    event.type === "response.audio_transcript.delta" ||
    event.type === "response.output_audio_transcript.delta"
  ) {
    const delta = event.delta ?? "";
    finalText += delta;
    process.stdout.write(delta);
    return;
  }

  if (event.type === "response.text.done" || event.type === "response.output_text.done") {
    finalText = event.text ?? finalText;
    return;
  }

  if (event.type === "response.function_call_arguments.done") {
    console.log(`\n[Function call] ${event.name} ${event.arguments}`);
    return;
  }

  if (event.type === "response.done") {
    const fallbackText = extractResponseText(event.response);
    if (!finalText && fallbackText) {
      finalText = fallbackText;
      process.stdout.write(fallbackText);
    }
    closeAndExit(0);
  }
});

socket.on("close", () => {
  if (!closed) closeAndExit(finalText ? 0 : 1);
});

sendJson(socket, {
  type: "session.update",
  session: {
    type: "realtime",
    instructions,
    output_modalities: ["text"],
  },
});

sendJson(socket, {
  type: "conversation.item.create",
  item: {
    type: "message",
    role: "user",
    content: [
      {
        type: "input_text",
        text: userText,
      },
    ],
  },
});

sendJson(socket, {
  type: "response.create",
  response: {
    output_modalities: ["text"],
  },
});

setTimeout(() => {
  if (!closed) {
    console.error("\n응답 대기 시간이 초과됐습니다.");
    closeAndExit(1);
  }
}, 30000);

function readRealtimeInstructions() {
  const guidePath = resolve(repoRoot, "apps/mobile/src/realtime/guide.ts");
  const guideSource = readFileSync(guidePath, "utf8");
  const match = guideSource.match(/HANEUM_REALTIME_INSTRUCTIONS = `([\s\S]*?)`\\.trim\\(\\)/);
  return match?.[1]?.trim() || "짧고 명확한 한국어로 버스 이용을 안내한다.";
}

function loadEnvFiles(startDir) {
  const envPaths = [];
  let currentDir = resolve(startDir);

  while (true) {
    const envPath = resolve(currentDir, ".env");
    if (existsSync(envPath)) envPaths.push(envPath);

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  for (const envPath of envPaths.reverse()) {
    const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) continue;

      const separatorIndex = trimmedLine.indexOf("=");
      if (separatorIndex < 0) continue;

      const key = trimmedLine.slice(0, separatorIndex).trim();
      const value = trimmedLine.slice(separatorIndex + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  }
}

function openRealtimeWebSocket(openAiApiKey, realtimeModel) {
  return new Promise((resolveSocket, rejectSocket) => {
    const host = "api.openai.com";
    const path = `/v1/realtime?model=${encodeURIComponent(realtimeModel)}`;
    const websocketKey = randomBytes(16).toString("base64");
    const socket = tls.connect(443, host, { servername: host });
    let handshakeBuffer = Buffer.alloc(0);
    let frameBuffer = Buffer.alloc(0);
    let handshakeDone = false;
    const listeners = { text: [], close: [] };

    socket.once("secureConnect", () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: ${host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${websocketKey}`,
          "Sec-WebSocket-Version: 13",
          `Authorization: Bearer ${openAiApiKey}`,
          "",
          "",
        ].join("\r\n"),
      );
    });

    socket.on("data", (chunk) => {
      if (!handshakeDone) {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const headerEnd = handshakeBuffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        const headerText = handshakeBuffer.slice(0, headerEnd).toString("utf8");
        const acceptKey = createHash("sha1")
          .update(`${websocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64");

        if (!headerText.startsWith("HTTP/1.1 101") || !headerText.includes(acceptKey)) {
          rejectSocket(new Error(`Realtime WebSocket handshake failed:\n${headerText}`));
          socket.end();
          return;
        }

        handshakeDone = true;
        frameBuffer = handshakeBuffer.slice(headerEnd + 4);
        resolveSocket(createClient(socket, listeners));
      } else {
        frameBuffer = Buffer.concat([frameBuffer, chunk]);
      }

      while (true) {
        const frame = readFrame(frameBuffer);
        if (!frame) break;
        frameBuffer = frame.remaining;

        if (frame.opcode === 0x1) {
          listeners.text.forEach((listener) => listener(frame.payload.toString("utf8")));
        }
        if (frame.opcode === 0x8) {
          listeners.close.forEach((listener) => listener());
          socket.end();
        }
      }
    });

    socket.on("error", rejectSocket);
    socket.on("close", () => {
      listeners.close.forEach((listener) => listener());
    });
  });
}

function createClient(socket, listeners) {
  return {
    send(data) {
      socket.write(writeFrame(Buffer.from(data, "utf8")));
    },
    close() {
      socket.end();
    },
    on(eventName, listener) {
      listeners[eventName]?.push(listener);
    },
  };
}

function sendJson(socket, event) {
  socket.send(JSON.stringify(event));
}

function readFrame(buffer) {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const opcode = firstByte & 0x0f;
  let offset = 2;
  let length = secondByte & 0x7f;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("WebSocket frame is too large.");
    }
    length = Number(bigLength);
    offset += 8;
  }

  if (buffer.length < offset + length) return null;

  return {
    opcode,
    payload: buffer.slice(offset, offset + length),
    remaining: buffer.slice(offset + length),
  };
}

function writeFrame(payload) {
  const mask = randomBytes(4);
  const header = [];
  header.push(0x81);

  if (payload.length < 126) {
    header.push(0x80 | payload.length);
  } else if (payload.length < 65536) {
    header.push(0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    const lengthBuffer = Buffer.alloc(8);
    lengthBuffer.writeBigUInt64BE(BigInt(payload.length));
    header.push(0x80 | 127, ...lengthBuffer);
  }

  const maskedPayload = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    maskedPayload[index] = payload[index] ^ mask[index % 4];
  }

  return Buffer.concat([Buffer.from(header), mask, maskedPayload]);
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractResponseText(response) {
  if (!response?.output) return "";

  return response.output
    .flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? content.transcript ?? "")
    .join("");
}

function closeAndExit(code) {
  if (closed) return;
  closed = true;
  console.log();
  socket.close();
  process.exit(code);
}
