require("dotenv").config();
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────
// 공통 system message
// ─────────────────────────────────────────────
const systemMessage = {
  role: "system",
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

// ─────────────────────────────────────────────
// 공통 OpenAI 호출 함수
// ─────────────────────────────────────────────
async function createGuideMessage(prompt, fallbackMessage) {
  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        systemMessage,
        { role: "user", content: prompt },
      ],
    });
    const message = response.choices[0]?.message?.content;
    if (!message) return fallbackMessage;
    return message.trim();
  } catch (error) {
    console.error("[createGuideMessage 오류]", error.message);
    return fallbackMessage;
  }
}

// ─────────────────────────────────────────────
// generateRouteGuide
// POST /api/routes/search 에서 호출
// ─────────────────────────────────────────────
async function generateRouteGuide({ destination, candidates }) {
  // 배열 검증
  if (!Array.isArray(candidates)) {
    return { guideMessage: "이동 가능한 버스 노선을 찾지 못했어요. 다시 검색해 주세요." };
  }

  // routeNo 기준 중복 제거
  const dedupedCandidates = candidates.filter((c, index, self) =>
    index === self.findIndex((r) => r.routeNo === c.routeNo)
  );

  // 후보 없음
  if (dedupedCandidates.length === 0) {
    return { guideMessage: "이동 가능한 버스 노선을 찾지 못했어요. 다시 검색해 주세요." };
  }

  // 단일 노선
  if (dedupedCandidates.length === 1) {
    const candidate = dedupedCandidates[0];
    const prompt = `
아래 버스 노선 정보를 바탕으로 시각장애인 사용자를 위한 안내 문장을 만들어줘.
목적지: ${destination || "정보 없음"}
버스 번호: ${candidate.routeNo}
탑승 정류장: ${candidate.boardingStation?.stationName || "정보 없음"}
실제 하차 정류장: ${candidate.destinationStation?.stationName || "정보 없음"}
총 소요시간: ${candidate.totalTime || "정보 없음"}분
도보 거리: ${candidate.totalWalk || "정보 없음"}m
환승: 없음
버스 도착 예정 시간: ${candidate.predictedArrivalMinutes != null ? candidate.predictedArrivalMinutes + "분" : ""}
조건:
- "[버스번호]번 버스를 [탑승정류장]에서 탑승하시면 환승 없이 [소요시간]분 만에 도착합니다." 형식으로 자연스럽게 한 문장으로 말해.
- 실제 하차 정류장을 "[목적지]를 목적지로 하면 [하차 정류장]에서 하차합니다." 형식으로 안내해.
- 버스 도착 예정 시간이 있으면 약 N분 후 도착 예정이라고 안내해.
- 질문 문장 없이 안내 문장만 만들어줘.
    `.trim();

    const guideMessage = await createGuideMessage(
      prompt,
      "안내 문장을 생성할 수 없어요. 다시 시도해 주세요."
    );
    return { selectedCandidates: [{ candidateId: candidate.candidateId, guideMessage }] };
  }

  // 여러 노선 — AI가 최대 2개 선택
  const candidateInfos = dedupedCandidates.map((c) => `
candidateId: ${c.candidateId}
버스 번호: ${c.routeNo}
탑승 정류장: ${c.boardingStation?.stationName || "정보 없음"}
실제 하차 정류장: ${c.destinationStation?.stationName || "정보 없음"}
총 소요시간: ${c.totalTime || "정보 없음"}분
도보 거리: ${c.totalWalk || "정보 없음"}m
환승: 없음
배차 간격: ${c.intervalTime || "정보 없음"}분
  `.trim()).join("\n---\n");

  const prompt = `
다음 버스 후보 중 시각장애인에게 가장 적합한 최대 2개를 골라줘.
목적지: ${destination || "정보 없음"}
후보 목록:
${candidateInfos}
선택 기준 (우선순위 순서대로):
1. 총 소요시간이 짧은 경로 우선
2. 배차 간격이 짧은 경로 우선 (자주 오는 버스)
3. 도보 이동 거리가 짧은 경로 우선
각 후보에 대해 다음을 포함한 안내 문장을 만들어줘:
- "[버스번호]번 버스를 [탑승정류장]에서 탑승하시면 환승 없이 [소요시간]분 만에 도착합니다." 형식으로 자연스럽게 한 문장으로 말해.
- 실제 하차 정류장 ("[목적지]를 목적지로 하면 [하차 정류장]에서 하차합니다" 형식으로)
- 질문 문장 없이 안내 문장만 만들어줘
JSON으로만 반환해. 백틱이나 마크다운 없이 순수 JSON만:
{
  "selectedCandidates": [
    { "candidateId": 숫자, "guideMessage": "문장" },
    { "candidateId": 숫자, "guideMessage": "문장" }
  ]
}
  `.trim();

  try {
    const raw = await createGuideMessage(prompt, null);
    if (!raw) throw new Error("응답 없음");
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (error) {
    console.error("[generateRouteGuide 여러노선 파싱 오류]", error.message);
    return {
      selectedCandidates: [
        {
          candidateId: dedupedCandidates[0].candidateId,
          guideMessage: "안내 문장을 생성할 수 없어요. 다시 시도해 주세요.",
        },
      ],
    };
  }
}

// ─────────────────────────────────────────────
// generateTripStartGuide
// POST /api/trips 에서 호출
// ─────────────────────────────────────────────
async function generateTripStartGuide({ selectedRoute, tripStatus, predictedArrivalMinutes }) {
  if (!selectedRoute?.routeNo) {
    return { guideMessage: "선택한 버스를 기다리고 있어요. 버스가 도착하면 탑승을 준비해 주세요." };
  }

  const prompt = `
사용자가 아래 버스 노선을 선택했어.
시각장애인 사용자가 탑승 정류장에서 기다릴 수 있도록 안내 문장을 만들어줘.
버스 번호: ${selectedRoute?.routeNo || "정보 없음"}
탑승 정류장: ${selectedRoute?.boardingStation?.stationName || "정보 없음"}
실제 하차 정류장: ${selectedRoute?.destinationStation?.stationName || "정보 없음"}
버스 도착 예정 시간: ${predictedArrivalMinutes != null ? predictedArrivalMinutes + "분" : ""}
운행 상태: ${tripStatus || "WAITING_BUS"}
조건:
- 사용자가 선택한 버스 번호를 반드시 안내해.
- 탑승 정류장 이름이 있으면 해당 정류장에서 기다리라고 안내해.
- 목적지 정류장 이름이 있으면 함께 안내할 수 있어.
- 버스 도착 예정 시간 정보가 있으면 약 N분 후 도착 예정이라고 안내해.
- 버스 도착 예정 시간 정보가 없으면 도착 시간 언급을 생략해.
- 하차벨 상태나 운행 상태값 자체를 말하지 마.
- 두 문장 이내로 말해.
  `.trim();

  const guideMessage = await createGuideMessage(
    prompt,
    "선택한 버스를 기다리고 있어요. 버스가 도착하면 탑승을 준비해 주세요."
  );
  return { guideMessage };
}

// ─────────────────────────────────────────────
// generateMovingGuide
// PATCH /api/trips/{tripId}/status 에서 호출
// ─────────────────────────────────────────────
async function generateMovingGuide({ currentStation, nextStation, remainingStations, tripStatus }) {
  // 입력값 부족
  if (remainingStations == null) {
    return { guideMessage: "현재 이동 상태를 확인하고 있어요." };
  }

  // 오류 상태
  if (tripStatus === "ERROR") {
    return { guideMessage: "현재 이동 상태를 확인하고 있어요." };
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

  const guideMessage = await createGuideMessage(
    prompt,
    "현재 이동 상태를 확인하고 있어요."
  );
  return { guideMessage };
}

// ─────────────────────────────────────────────
// generateErrorGuide
// OpenAI API 호출 없이 고정 fallback 반환
// ─────────────────────────────────────────────
function generateErrorGuide({ errorType } = {}) {
  const messages = {
    NO_ROUTE: "이동 가능한 버스 노선을 찾지 못했어요. 다시 검색해 주세요.",
    LOCATION_ERROR: "현재 위치를 확인할 수 없어요. 위치 정보를 다시 확인해 주세요.",
    API_ERROR: "일시적인 오류가 발생했어요. 다시 시도해 주세요.",
    AI_ERROR: "일시적인 오류가 발생했어요. 다시 시도해 주세요.",
    MISSING_DATA: "일시적인 오류가 발생했어요. 다시 시도해 주세요.",
  };
  const guideMessage = messages[errorType] || "일시적인 오류가 발생했어요. 다시 시도해 주세요.";
  return { guideMessage };
}

// ─────────────────────────────────────────────
// export
// ─────────────────────────────────────────────
module.exports = {
  generateRouteGuide,
  generateTripStartGuide,
  generateMovingGuide,
  generateErrorGuide,
};
