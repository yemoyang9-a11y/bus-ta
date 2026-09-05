/**
 * 노선 번호를 음성으로 읽을 문자열로 바꾼다.
 *
 * 2026-09-05 시연에서 AI 가 35번을 "셋다섯", 15-2번을 "일번", 82-1번을 "팔십이번"으로
 * 말했다. 시각장애인 사용자는 이 음성만으로 버스를 고르므로, 번호가 잘리면 다른 버스를
 * 탄다. 프롬프트의 발음 규칙을 세 차례 조였는데도 계속 틀렸다 — 지시만으로 발음을
 * 통제하는 방식은 신뢰할 수 없다.
 *
 * 그래서 발음을 여기서 확정하고 Function 결과에 실어 보낸다. 모델에게는 "이 문자열을
 * 그대로 읽어라"만 시키면 되므로, 지시 따르기 문제가 결정적인 변환 문제로 바뀐다.
 *
 * 규칙(docs/REALTIME_GUIDE.md 의 기존 계약과 같다):
 * - 하이픈은 "다시"로 읽는다. 700-2 → "칠백 다시 이"
 * - 하이픈으로 나뉜 각 숫자 덩어리를 독립적으로 읽는다. 이어 붙여 자릿수를 세지 않는다.
 * - 각 덩어리가 네 자리 이상이면 한 자리씩, 세 자리 이하면 일반적인 수 읽기로 읽는다.
 * - 알파벳과 괄호 안 표시는 생략하지 않는다. 괄호 기호 자체는 읽지 않는다.
 */

const SINO_DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
/** 한 자리씩 끊어 읽을 때는 0 을 "영"이 아니라 "공"으로 읽는다(번호 읽기 관행). */
const SPOKEN_DIGITS = ["공", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];

const LETTER_NAMES: Record<string, string> = {
  A: "에이", B: "비", C: "씨", D: "디", E: "이", F: "에프", G: "지",
  H: "에이치", I: "아이", J: "제이", K: "케이", L: "엘", M: "엠",
  N: "엔", O: "오", P: "피", Q: "큐", R: "알", S: "에스", T: "티",
  U: "유", V: "브이", W: "더블유", X: "엑스", Y: "와이", Z: "지",
};

/** 네 자리 이상은 한 자리씩 끊어 읽는다. 1551 → "일 오 오 일" */
const DIGIT_BY_DIGIT_FROM = 4;

/** 세 자리 이하를 일반적인 한국어 수 읽기로. 205 → "이백오", 10 → "십" */
function readSmallNumber(digits: string): string {
  const value = Number(digits);
  if (value === 0) return SPOKEN_DIGITS[0]!;

  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const ones = value % 10;

  // 1 은 "일백"·"일십"이 아니라 "백"·"십"으로 읽는다.
  const hundredsPart = hundreds === 0 ? "" : `${hundreds === 1 ? "" : SINO_DIGITS[hundreds]}백`;
  const tensPart = tens === 0 ? "" : `${tens === 1 ? "" : SINO_DIGITS[tens]}십`;
  const onesPart = ones === 0 ? "" : SINO_DIGITS[ones]!;

  return `${hundredsPart}${tensPart}${onesPart}`;
}

function readDigits(digits: string): string {
  if (digits.length >= DIGIT_BY_DIGIT_FROM) {
    return digits
      .split("")
      .map((digit) => SPOKEN_DIGITS[Number(digit)] ?? digit)
      .join(" ");
  }

  return readSmallNumber(digits);
}

/** 숫자 덩어리와 알파벳 덩어리를 순서대로 읽는다. 1551B → "일 오 오 일 비" */
function readSegment(segment: string): string {
  const tokens: string[] = [];

  for (const match of segment.matchAll(/\d+|[A-Za-z]|[^\dA-Za-z]+/g)) {
    const token = match[0];

    if (/^\d+$/.test(token)) {
      tokens.push(readDigits(token));
      continue;
    }

    if (/^[A-Za-z]$/.test(token)) {
      tokens.push(LETTER_NAMES[token.toUpperCase()] ?? token);
      continue;
    }

    // 숫자도 알파벳도 아닌 부분(한글 등)은 발음을 지어내지 않고 그대로 둔다.
    const rest = token.trim();
    if (rest) tokens.push(rest);
  }

  return tokens.join(" ");
}

export function toSpokenRouteNo(routeNo: string): string {
  if (!routeNo) return routeNo;

  // 괄호 기호 자체는 읽지 않지만 안의 표시는 반드시 읽는다. 35-2(A) → "삼십오 다시 이 에이"
  const withoutBrackets = routeNo.replace(/[()[\]]/g, " ");

  const spoken = withoutBrackets
    .split("-")
    .map((segment) => readSegment(segment))
    .filter((segment) => segment.length > 0)
    .join(" 다시 ")
    .replace(/\s+/g, " ")
    .trim();

  // 바꿀 근거가 없으면 원래 표기를 그대로 돌려준다. 지어낸 발음이 실제 노선과
  // 다르면 사용자가 다른 버스를 탄다.
  return spoken || routeNo;
}
