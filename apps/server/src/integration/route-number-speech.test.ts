import assert from "node:assert/strict";
import test from "node:test";
import { toSpokenRouteNo } from "@bus-ta/shared";

// ─────────────────────────────────────────────
// 노선 번호 발음.
//
// 2026-09-05 시연에서 AI 가 35번을 "셋다섯", 15-2번을 "일번", 82-1번을 "팔십이번"으로
// 말했다. 시각장애인 사용자는 이 음성만으로 버스를 고르므로, 번호가 잘리거나 다르게
// 들리면 다른 버스를 탄다. guide.ts 의 발음 규칙을 세 차례 조였는데도 계속 틀렸다 —
// 프롬프트로 발음을 통제하는 방식 자체가 신뢰할 수 없다는 뜻이다.
//
// 그래서 발음을 코드로 확정해 Function 결과에 실어 보내고, 모델에는 "이 문자열을
// 그대로 읽어라"만 시킨다. 지시 따르기 문제를 결정적인 변환 문제로 바꾼다.
// ─────────────────────────────────────────────

test("세 자리 이하 숫자는 일반적인 한국어 수 읽기로 읽는다", () => {
  assert.equal(toSpokenRouteNo("35"), "삼십오");
  assert.equal(toSpokenRouteNo("65"), "육십오");
  assert.equal(toSpokenRouteNo("205"), "이백오");
  assert.equal(toSpokenRouteNo("34"), "삼십사");
  assert.equal(toSpokenRouteNo("10"), "십");
  assert.equal(toSpokenRouteNo("100"), "백");
  assert.equal(toSpokenRouteNo("7"), "칠");
});

test("네 자리 이상 숫자는 한 자리씩 끊어 읽는다", () => {
  assert.equal(toSpokenRouteNo("1551"), "일 오 오 일");
  assert.equal(toSpokenRouteNo("1006"), "일 공 공 육");
  assert.equal(toSpokenRouteNo("1000"), "일 공 공 공");
});

test("하이픈은 '다시'로 읽고 뒤 숫자를 절대 생략하지 않는다", () => {
  // 시연에서 실제로 틀린 두 번호. 뒤 숫자가 빠지면 다른 노선이 된다.
  assert.equal(toSpokenRouteNo("15-2"), "십오 다시 이");
  assert.equal(toSpokenRouteNo("82-1"), "팔십이 다시 일");

  assert.equal(toSpokenRouteNo("700-2"), "칠백 다시 이");
  assert.equal(toSpokenRouteNo("720-1"), "칠백이십 다시 일");
  assert.equal(toSpokenRouteNo("33-2"), "삼십삼 다시 이");
  assert.equal(toSpokenRouteNo("34-1"), "삼십사 다시 일");
  assert.equal(toSpokenRouteNo("100-1"), "백 다시 일");
});

test("하이픈 양쪽 숫자를 이어 붙여 자릿수를 세지 않는다", () => {
  // "15-2" 를 네 자리로 보면 "일 오 이" 같은 엉뚱한 발음이 된다.
  assert.equal(toSpokenRouteNo("15-2"), "십오 다시 이");
  // 반대로 각 덩어리가 네 자리면 그 덩어리만 한 자리씩 읽는다.
  assert.equal(toSpokenRouteNo("1004-1"), "일 공 공 사 다시 일");
});

test("알파벳과 괄호 안 표시를 생략하지 않는다", () => {
  assert.equal(toSpokenRouteNo("1551B"), "일 오 오 일 비");
  assert.equal(toSpokenRouteNo("35-2(A)"), "삼십오 다시 이 에이");
  assert.equal(toSpokenRouteNo("M5107"), "엠 오 일 공 칠");
  assert.equal(toSpokenRouteNo("N15"), "엔 십오");
});

test("숫자 부분이 비슷해도 서로 다른 노선은 다르게 읽힌다", () => {
  // 1551 과 1551B, 34 와 34-1 은 다른 노선이다. 발음이 같으면 사용자가 구분할 수 없다.
  assert.notEqual(toSpokenRouteNo("1551"), toSpokenRouteNo("1551B"));
  assert.notEqual(toSpokenRouteNo("34"), toSpokenRouteNo("34-1"));
});

test("모든 숫자와 문자가 발음 결과에 남는다", () => {
  // 시연의 실제 결함은 "잘못 읽음"이 아니라 "일부를 통째로 빼먹음"이었다.
  for (const routeNo of ["15-2", "82-1", "35-2(A)", "1551B", "700-2"]) {
    const spoken = toSpokenRouteNo(routeNo);
    assert.ok(spoken.length > 0, `${routeNo} 발음이 비었다`);
    const chunkCount = routeNo.split("-").length;
    if (chunkCount > 1) {
      assert.equal(
        spoken.split("다시").length,
        chunkCount,
        `${routeNo}: 하이픈 개수만큼 '다시'가 있어야 한다 (${spoken})`,
      );
    }
  }
});

test("알 수 없는 형태는 지어내지 않고 원래 표기를 돌려준다", () => {
  // 발음을 확신할 수 없는 값을 억지로 바꾸면 실제 노선과 다른 안내가 된다.
  assert.equal(toSpokenRouteNo(""), "");
  assert.equal(toSpokenRouteNo("마을"), "마을");
});
