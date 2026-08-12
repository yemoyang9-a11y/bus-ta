// Realtime 세션 연결 관리 모듈
//
// 13. 세션 키 발급 — clientSecret은 메모리에만 보관한다.
//     AsyncStorage, 로그, 파일에 저장하지 않는다.
//
// 공유 시크릿(REALTIME_SHARED_SECRET)은 EAS 빌드타임 비공개 환경변수로 주입되며,
// EXPO_PUBLIC_ 접두사를 쓰지 않는다 (노션 「공통 API 및 Function Calling 명세서」 6.1, 2026-07-27 확정).
// app.config.ts의 extra를 통해 런타임에서 읽는다.

import Constants from 'expo-constants';

let currentClientSecret = null; // 모듈 스코프 메모리에만 보관, 절대 로그 남기지 않음
let currentExpiresAt = null;

/**
 * 백엔드에서 Realtime 세션 단기 키를 발급받는다.
 * POST /api/realtime/session — 헤더에 공유 시크릿, Body 없음.
 * 이 API는 아직 백엔드에 구현되지 않았을 수 있다 — 그 경우 그대로 에러를 던진다.
 */
export async function fetchRealtimeSession() {
  const sharedSecret = Constants.expoConfig?.extra?.realtimeSharedSecret;
  const BASE_URL = process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

  const res = await fetch(`${BASE_URL}/api/realtime/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Realtime-Shared-Secret': sharedSecret ?? '',
    },
  });

  if (!res.ok) {
    let errorCode = 'UNKNOWN_ERROR';
    let message = `Realtime 세션 발급 실패: ${res.status}`;
    try {
      const body = await res.json();
      errorCode = body.errorCode ?? errorCode;
      message = body.message ?? message;
    } catch {
      // 응답이 JSON이 아닌 경우 (예: 404 HTML 페이지 — 아직 라우터 자체가 없을 때)
    }
    throw new Error(`[${errorCode}] ${message}`);
  }

  const data = await res.json();
  // data: { success, clientSecret, model, expiresAt, message, timestamp }

  currentClientSecret = data.clientSecret;
  currentExpiresAt = data.expiresAt;

  return data;
}

export function getCurrentClientSecret() {
  return currentClientSecret;
}

export function getCurrentExpiresAt() {
  return currentExpiresAt;
}

export function clearClientSecret() {
  currentClientSecret = null;
  currentExpiresAt = null;
}

/**
 * 세션 키가 곧 만료되는지 확인한다 (16번: 만료·재연결 처리 대비).
 * @param {number} bufferSeconds - 만료 전 여유 시간(초). 기본 30초.
 */
export function isSessionExpiringSoon(bufferSeconds = 30) {
  if (!currentExpiresAt) return true;
  const expiresAtMs = new Date(currentExpiresAt).getTime();
  const nowMs = Date.now();
  return expiresAtMs - nowMs < bufferSeconds * 1000;
}