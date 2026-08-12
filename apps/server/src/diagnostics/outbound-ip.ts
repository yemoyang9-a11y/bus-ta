import axios from "axios";

/**
 * 서버가 외부로 나갈 때 쓰는 공인 IP 를 부팅 시 1회 조회해 로그로 남긴다.
 *
 * ODsay 는 애플리케이션에 등록된 IP 에서 온 호출만 허용하는데, Render 대시보드는
 * 개별 주소가 아니라 대역(`74.220.52.0/24`, `74.220.60.0/24`)만 알려준다.
 * 등록에 필요한 구체적인 주소를 확인할 수 있는 곳이 이 로그뿐이다.
 *
 * Render 무료 인스턴스는 15분 무활동으로 잠들었다 깨며 매번 재시작하므로
 * cold start 마다 이 줄이 새로 남는다. 값이 계속 같은지 보면 그 IP 를 등록해
 * 쓸 수 있는지, 아니면 고정 IP 가 필요한지 판단할 수 있다.
 */

const LOOKUP_URL = "https://api.ipify.org";
const LOOKUP_TIMEOUT_MS = 3000;

/**
 * 옥텟 범위까지 엄밀히 보지는 않는다. 이 검사의 목적은 잘못된 주소를 가려내는 것이
 * 아니라, 응답에 섞인 개행이나 HTML 이 로그에 그대로 실리는 것을 막는 것이다.
 */
const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export interface LogOutboundIpDependencies {
  fetchOutboundIp: () => Promise<string>;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

export async function fetchOutboundIpFromIpify(): Promise<string> {
  const response = await axios.get(LOOKUP_URL, {
    timeout: LOOKUP_TIMEOUT_MS,
    responseType: "text",
  });

  return String(response.data);
}

export async function logOutboundIp(dependencies: LogOutboundIpDependencies): Promise<void> {
  const log = dependencies.log ?? console.log;
  const logError = dependencies.logError ?? console.error;

  let response: string;
  try {
    response = await dependencies.fetchOutboundIp();
  } catch (error) {
    // 조회 실패는 진단 정보를 못 얻는 것일 뿐이다. 서버 부팅을 막지 않는다.
    const message = error instanceof Error ? error.message : "unknown";
    logError(`[startup] outbound ip 조회 실패 message=${message}`);
    return;
  }

  const outboundIp = response.trim();
  if (!IPV4_PATTERN.test(outboundIp)) {
    // 조회 서비스의 응답은 외부 입력이다. 원문 대신 길이만 남긴다.
    logError(`[startup] outbound ip 응답 형식이 예상과 다르다 length=${outboundIp.length}`);
    return;
  }

  log(`[startup] outbound ip=${outboundIp}`);
}
