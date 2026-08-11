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
- 최저요금, 전체 이동 소요시간은 말하지 마.
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

function uniqueRoutesByRouteNo(candidates: Route[]): Route[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const routeKey = candidate.routeNo || String(candidate.candidateId);
    if (seen.has(routeKey)) return false;
    seen.add(routeKey);
    return true;
  });
}

function buildRouteGuideFallback(candidates: Route[]): RouteGuideResult {
  return {
    selectedCandidates: uniqueRoutesByRouteNo(candidates)
      .slice()
      .sort((a, b) => {
        const timeDiff = (a.totalTime ?? Number.MAX_SAFE_INTEGER) - (b.totalTime ?? Number.MAX_SAFE_INTEGER);
        if (timeDiff !== 0) return timeDiff;

        const intervalDiff =
          (a.intervalTime ?? Number.MAX_SAFE_INTEGER) - (b.intervalTime ?? Number.MAX_SAFE_INTEGER);
        if (intervalDiff !== 0) return intervalDiff;

        return (a.totalWalk ?? Number.MAX_SAFE_INTEGER) - (b.totalWalk ?? Number.MAX_SAFE_INTEGER);
      })
      .slice(0, 2)
      .map((candidate) => ({
        candidateId: candidate.candidateId,
        guideMessage: buildBasicRouteGuide(candidate),
      })),
  };
}

function buildBasicRouteGuide(candidate: Route): string {
  const routeNo = candidate.routeNo || "선택한";
  const boardingStation = candidate.boardingStation.stationName || "탑승 정류장";
  const destinationStation = candidate.destinationStation.stationName || "하차 정류장";

  return `${routeNo}번 버스를 ${boardingStation}에서 탑승하시면 환승 없이 이동합니다. ${destinationStation} 정류장에서 하차해 주세요.`;
}

function parseOpenAIRouteGuide(raw: string): OpenAIRouteGuideResponse | null {
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim()) as OpenAIRouteGuideResponse;
  } catch {
    return null;
  }
}

function validateRouteGuideResponse(raw: string, candidates: Route[]): RouteGuideResult | null {
  const parsed = parseOpenAIRouteGuide(raw);
  if (!parsed?.selectedCandidates || !Array.isArray(parsed.selectedCandidates)) {
    return null;
  }

  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const seen = new Set<number>();
  const selectedCandidates = parsed.selectedCandidates
    .filter((candidate): candidate is { candidateId: number; guideMessage: string } => {
      const candidateId = candidate.candidateId;
      const isValid =
        typeof candidateId === "number" &&
        candidateIds.has(candidateId) &&
        !seen.has(candidateId) &&
        typeof candidate.guideMessage === "string" &&
        candidate.guideMessage.trim().length > 0;

      if (isValid) {
        seen.add(candidateId);
      }

      return isValid;
    })
    .slice(0, 2)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      guideMessage: candidate.guideMessage.trim(),
    }));

  return selectedCandidates.length > 0 ? { selectedCandidates } : null;
}

export async function generateRouteGuide({
  destination,
  candidates,
}: GenerateRouteGuideInput): Promise<RouteGuideResult> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { selectedCandidates: [] };
  }

  const dedupedCandidates = uniqueRoutesByRouteNo(candidates);
  const fallbackResult = buildRouteGuideFallback(dedupedCandidates);
  if (!client) {
    return fallbackResult;
  }

  const candidateInfos = dedupedCandidates
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
다음 버스 후보 중 시각장애인에게 가장 적합한 최대 2개를 골라줘.
목적지: ${destination || "정보 없음"}
후보 목록:
${candidateInfos}
선택 기준:
1. 총 소요시간이 짧은 경로
2. 배차 간격이 짧은 경로
3. 도보 이동 거리가 짧은 경로
조건:
- 반드시 후보 목록에 있는 candidateId만 사용해.
- selectedCandidates는 최대 2개만 반환해.
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

  return validateRouteGuideResponse(raw, dedupedCandidates) ?? fallbackResult;
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
- 버스 도착 예정 시간 정보가 있으면 약 N분 후 도착 예정이라고 안내해.
- 버스 도착 예정 시간 정보가 없으면 도착 시간 언급을 생략해.
- 하차벨 상태나 운행 상태값 자체를 말하지 마.
- 두 문장 이내로 말해.
  `.trim();

  const guideMessage = await createGuideMessage(prompt, TRIP_START_FALLBACK_MESSAGE);
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
