import OpenAI from "openai";
import type { ArrivalInfo, Route } from "@bus-ta/shared";

type GuideMessageResult = {
  guideMessage: string;
};

export type SelectedRouteGuide = {
  candidateId: number;
  guideMessage: string;
};

export type RouteGuideResult = {
  selectedCandidates: SelectedRouteGuide[];
};

export type GenerateRouteGuideInput = {
  destination?: string;
  candidates: Route[];
};

export type GenerateTripStartGuideInput = {
  selectedRoute?: Pick<Route, "routeNo" | "boardingStation" | "destinationStation">;
  tripStatus?: string;
  // create_trip 응답의 arrivals. 탑승 대기 안내는 가장 먼저 오는 차량만 사용한다.
  arrivals?: ArrivalInfo[];
};

export type GenerateMovingGuideInput = {
  currentStation?: Route["boardingStation"];
  nextStation?: Route["boardingStation"];
  remainingStations?: number | null;
  tripStatus?: string;
};

type OpenAIRouteGuideResponse = {
  selectedCandidates?: Array<{
    candidateId?: unknown;
    guideMessage?: unknown;
  }>;
};

const ROUTE_NOT_FOUND_MESSAGE = "이동 가능한 버스 노선을 찾지 못했어요. 다시 검색해 주세요.";
const TRIP_START_FALLBACK_MESSAGE =
  "선택한 버스를 기다리고 있어요. 버스가 도착하면 탑승을 준비해 주세요.";
const MOVING_FALLBACK_MESSAGE = "현재 이동 상태를 확인하고 있어요.";
const GENERIC_ERROR_MESSAGE = "일시적인 오류가 발생했어요. 다시 시도해 주세요.";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const systemMessage = {
  role: "system" as const,
  content: `
너는 시각장애인을 위한 버스 승하차 보조 앱의 안내 문장을 생성하는 AI야.
공통 규칙:
- 항상 한국어 존댓말로 말해.
- TTS로 읽기 쉽게 짧고 명확하게 말해.
- 특수문자나 복잡한 기호는 사용하지 마.
- 백엔드가 전달한 정보만 사용해.
- 경로 후보를 안내할 때는 제공된 총 소요시간과 배차 간격을 각 후보의 버스 번호와 함께 말해.
- 노선 번호의 숫자 부분이 네 자리 이상이면 각 숫자를 한 자리씩 읽고, 세 자리 이하면 일반적인 한국어 수 읽기 방식으로 읽어.
- 노선 번호의 알파벳, 하이픈 뒤 숫자, 괄호 안 표시는 생략하지 마. 하이픈은 음성으로 "다시"라고 읽어.
- 제공되지 않은 시간은 추측하지 마.
- create_trip 성공과 WAITING_BUS는 실제 탑승 완료가 아니라 탑승 정류장에서 버스를 기다리는 상태야.
- WAITING_BUS에서는 절대 "탑승했습니다", "탑승 중입니다", "운행을 시작합니다"라고 말하지 마.
- 실제 탑승 사실은 운행 상태가 ON_BUS일 때만 안내해.
- 하차벨 성공 또는 실패 여부는 말하지 마.
- 목적지명과 실제 하차 정류장명을 항상 구분해서 안내해. 같더라도 반드시 하차 정류장을 명시해.
  예: "수원대학교를 목적지로 하면 쌍용아파트 정류장에서 하차합니다."
- 사용자가 바로 이해할 수 있는 표현을 사용해.
  `.trim(),
};

async function createGuideMessage(prompt: string, fallbackMessage: string): Promise<string> {
  if (!client) {
    return fallbackMessage;
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [systemMessage, { role: "user", content: prompt }],
    });

    return response.choices[0]?.message?.content?.trim() || fallbackMessage;
  } catch (error) {
    console.error("[guide] OpenAI guide generation failed", error);
    return fallbackMessage;
  }
}

/**
 * 같은 노선 번호를 하나만 남긴다. 앞에 오는 후보를 남기므로, 점수순으로 정렬한
 * 뒤에 호출해야 노선별로 가장 좋은 후보가 살아남는다.
 */
function uniqueRoutesByRouteNo(candidates: Route[]): Route[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const routeKey = candidate.routeNo || String(candidate.candidateId);
    if (seen.has(routeKey)) return false;
    seen.add(routeKey);
    return true;
  });
}

/**
 * 이동시간과 배차간격을 순차 비교하면, 배차간격이 아무리 길어도 이동시간이
 * 조금이라도 짧은 경로가 항상 이겨버린다. 버스가 균등한 간격으로 온다고 가정하면
 * 평균 대기시간은 배차간격의 절반이므로, "이동시간 + 배차간격/2"를 하나의 예상
 * 총 소요시간으로 합쳐서 비교한다.
 *
 * 소요시간이나 배차간격을 확인할 수 없는 후보를 0분으로 취급하면 정보가 없다는
 * 이유로 오히려 가장 유리해진다. 누락 값은 기존 정렬과 동일하게 후순위로 보낸다.
 */
function expectedTotalMinutes(route: Route): number {
  if (route.totalTime == null || route.intervalTime == null) {
    return Number.MAX_SAFE_INTEGER;
  }
  return route.totalTime + route.intervalTime / 2;
}

/**
 * 안내할 후보 선택은 서버가 끝낸다. OpenAI 경로에서도 모델이 다시 고르지 않게
 * 해서, 모델의 계산 편차와 무관하게 같은 입력이면 항상 같은 후보가 나오게 한다.
 *
 * 중복 제거보다 정렬을 먼저 한다. 같은 노선 번호가 여러 번 올라오는 경우
 * (ODsay 가 같은 노선을 서로 다른 경로로 돌려주는 경우) 순서를 뒤집으면
 * 점수 비교도 받지 못한 채 느린 후보가 남을 수 있다.
 */
export function selectRouteCandidates(candidates: Route[]): Route[] {
  const sorted = candidates.slice().sort((a, b) => {
    const expectedDiff = expectedTotalMinutes(a) - expectedTotalMinutes(b);
    if (expectedDiff !== 0) return expectedDiff;

    return (a.totalWalk ?? Number.MAX_SAFE_INTEGER) - (b.totalWalk ?? Number.MAX_SAFE_INTEGER);
  });

  return uniqueRoutesByRouteNo(sorted).slice(0, 2);
}

function buildRouteGuideFallback(selectedRoutes: Route[]): RouteGuideResult {
  return {
    selectedCandidates: selectedRoutes.map((candidate) => ({
      candidateId: candidate.candidateId,
      guideMessage: buildBasicRouteGuide(candidate),
    })),
  };
}

function buildBasicRouteGuide(candidate: Route): string {
  const routeNo = candidate.routeNo || "선택한";
  const totalTime =
    candidate.totalTime != null ? `${candidate.totalTime}분` : "확인할 수 없습니다";
  const intervalTime =
    candidate.intervalTime != null ? `${candidate.intervalTime}분` : "확인할 수 없습니다";

  return `${routeNo}번은 예상 소요시간이 ${totalTime}이고 배차 간격은 ${intervalTime}입니다.`;
}

function parseOpenAIRouteGuide(raw: string): OpenAIRouteGuideResponse | null {
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim()) as OpenAIRouteGuideResponse;
  } catch {
    return null;
  }
}

/**
 * 서버가 정한 후보는 그대로 두고 안내 문장만 모델 결과로 채운다. 모델이 문장을
 * 빠뜨리거나 형식을 어겨도 후보 구성과 순서는 흔들리지 않는다.
 */
function mergeGuideMessages(selectedRoutes: Route[], raw: string): RouteGuideResult {
  const parsed = parseOpenAIRouteGuide(raw);
  const messageByCandidateId = new Map<number, string>();

  for (const candidate of parsed?.selectedCandidates ?? []) {
    const candidateId = candidate.candidateId;
    const guideMessage = candidate.guideMessage;

    if (typeof candidateId !== "number" || messageByCandidateId.has(candidateId)) continue;
    if (typeof guideMessage !== "string" || guideMessage.trim().length === 0) continue;

    messageByCandidateId.set(candidateId, guideMessage.trim());
  }

  return {
    selectedCandidates: selectedRoutes.map((route) => ({
      candidateId: route.candidateId,
      guideMessage: messageByCandidateId.get(route.candidateId) ?? buildBasicRouteGuide(route),
    })),
  };
}

export async function generateRouteGuide({
  destination,
  candidates,
}: GenerateRouteGuideInput): Promise<RouteGuideResult> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { selectedCandidates: [] };
  }

  const selectedRoutes = selectRouteCandidates(candidates);
  const fallbackResult = buildRouteGuideFallback(selectedRoutes);
  if (!client) {
    return fallbackResult;
  }

  const candidateInfos = selectedRoutes
    .map((candidate) =>
      `
candidateId: ${candidate.candidateId}
버스 번호: ${candidate.routeNo}
탑승 정류장: ${candidate.boardingStation.stationName}
실제 하차 정류장: ${candidate.destinationStation.stationName}
총 소요시간: ${candidate.totalTime ?? "정보 없음"}분
도보 거리: ${candidate.totalWalk ?? "정보 없음"}m
환승: 없음
배차 간격: ${candidate.intervalTime ?? "정보 없음"}분
      `.trim(),
    )
    .join("\n---\n");

  const prompt = `
아래 버스 노선 각각에 대해 시각장애인을 위한 안내 문장을 만들어줘.
후보 선택은 이미 끝났으니 노선을 고르거나 제외하거나 순서를 바꾸지 마.
목적지: ${destination || "정보 없음"}
후보 목록:
${candidateInfos}
조건:
- 후보 목록에 있는 candidateId 전부에 대해 각각 안내 문장을 하나씩 만들어줘.
- candidateId는 후보 목록에 있는 값을 그대로 사용해.
- 각 guideMessage에는 해당 버스 번호, 총 소요시간, 배차 간격을 반드시 포함해.
- 시간 정보가 없으면 숫자를 추측하지 말고 해당 정보를 확인할 수 없다고 안내해.
- recommendationReason은 반환하지 마.
- 질문 문장 없이 안내 문장만 만들어줘.
- JSON으로만 반환해. 백틱이나 마크다운 없이 순수 JSON만:
{
  "selectedCandidates": [
    { "candidateId": 숫자, "guideMessage": "문장" }
  ]
}
  `.trim();

  const raw = await createGuideMessage(prompt, "");
  if (!raw) {
    return fallbackResult;
  }

  return mergeGuideMessages(selectedRoutes, raw);
}

export async function generateTripStartGuide({
  selectedRoute,
  tripStatus,
  arrivals,
}: GenerateTripStartGuideInput): Promise<GuideMessageResult> {
  if (!selectedRoute?.routeNo) {
    return { guideMessage: TRIP_START_FALLBACK_MESSAGE };
  }

  const predictedArrivalMinutes = arrivals?.[0]?.predictedArrivalMinutes ?? null;
  const boardingStationName = selectedRoute.boardingStation.stationName || "탑승 정류장";
  const tripStartFallbackMessage =
    predictedArrivalMinutes != null
      ? `${selectedRoute.routeNo}번 버스를 선택했습니다. ${boardingStationName} 정류장에서 기다려 주세요. 버스는 약 ${predictedArrivalMinutes}분 후 도착합니다.`
      : `${selectedRoute.routeNo}번을 선택했습니다. ${boardingStationName} 정류장에서 기다려 주세요. 현재 실시간 버스 도착정보를 확인할 수 없습니다.`;

  const prompt = `
사용자가 아래 버스 노선을 선택했어.
시각장애인 사용자가 탑승 정류장에서 기다릴 수 있도록 안내 문장을 만들어줘.
버스 번호: ${selectedRoute.routeNo}
탑승 정류장: ${selectedRoute.boardingStation.stationName}
실제 하차 정류장: ${selectedRoute.destinationStation.stationName}
버스 도착 예정 시간: ${predictedArrivalMinutes != null ? `${predictedArrivalMinutes}분` : ""}
운행 상태: ${tripStatus || "WAITING_BUS"}
조건:
- 사용자가 선택한 버스 번호를 반드시 안내해.
- 탑승 정류장 이름이 있으면 해당 정류장에서 기다리라고 안내해.
- 현재 상태는 탑승 완료가 아니라 탑승 대기 상태야. "탑승했습니다", "탑승 중입니다", "운행을 시작합니다"라고 말하지 마.
- 버스 도착 예정 시간 정보가 있으면 "버스는 약 N분 후 도착합니다"라고 반드시 안내해.
- 버스 도착 예정 시간 정보가 없으면 도착 시간 언급을 생략하지 말고 "현재 실시간 버스 도착정보를 확인할 수 없습니다"라고 반드시 안내해.
- 하차벨 상태나 운행 상태값 자체를 말하지 마.
- 세 문장 이내로 말해.
  `.trim();

  const guideMessage = await createGuideMessage(prompt, tripStartFallbackMessage);
  return { guideMessage };
}

export async function generateMovingGuide({
  currentStation,
  nextStation,
  remainingStations,
  tripStatus,
}: GenerateMovingGuideInput): Promise<GuideMessageResult> {
  if (remainingStations == null || tripStatus === "ERROR") {
    return { guideMessage: MOVING_FALLBACK_MESSAGE };
  }

  const prompt = `
아래 버스 이동 상태를 바탕으로 시각장애인 사용자를 위한 안내 문장을 만들어줘.
현재 정류장: ${currentStation?.stationName || "정보 없음"}
다음 정류장: ${nextStation?.stationName || "정보 없음"}
남은 정류장 수: ${remainingStations}
운행 상태: ${tripStatus || "정보 없음"}
조건:
- 현재 정류장과 다음 정류장 이름이 있으면 함께 안내해.
- 운행 상태가 WAITING_BUS이면 탑승 정류장에서 버스를 기다리는 상태로만 안내하고, "탑승했습니다", "탑승 중입니다", "운행을 시작합니다"라고 말하지 마.
- 버스 탑승이 확인됐다는 안내는 운행 상태가 ON_BUS일 때만 할 수 있어.
- 하차벨 성공, 실패, 요청 완료 여부는 절대 말하지 마.
- 하차벨이 눌렸다고 말하지 마.
- 임의로 도착 시간을 예측하거나 말하지 마.
- 남은 정류장 수가 2이면 목적지까지 두 정류장 남았다고 안내하고 미리 하차 준비를 안내해.
- 남은 정류장 수가 1이면 하차까지 한 정류장 남았다고 안내하고 다음 정류장에서 하차하라고 안내해.
- 남은 정류장 수가 0이거나 운행 상태가 TRIP_DONE이면 목적지에 도착했다고 안내하고 안전하게 하차하도록 안내해.
- 두 문장 이내로 말해.
  `.trim();

  const guideMessage = await createGuideMessage(prompt, MOVING_FALLBACK_MESSAGE);
  return { guideMessage };
}

export function generateErrorGuide({ errorType }: { errorType?: string } = {}): GuideMessageResult {
  const messages: Record<string, string> = {
    NO_ROUTE: ROUTE_NOT_FOUND_MESSAGE,
    LOCATION_ERROR: "현재 위치를 확인할 수 없어요. 위치 정보를 다시 확인해 주세요.",
    API_ERROR: GENERIC_ERROR_MESSAGE,
    AI_ERROR: GENERIC_ERROR_MESSAGE,
    MISSING_DATA: GENERIC_ERROR_MESSAGE,
  };

  return { guideMessage: (errorType && messages[errorType]) || GENERIC_ERROR_MESSAGE };
}
