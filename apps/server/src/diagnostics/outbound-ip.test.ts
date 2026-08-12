import assert from "node:assert/strict";
import test from "node:test";
import { logOutboundIp } from "./outbound-ip.js";

test("logs the outbound IPv4 address reported by the lookup service", async () => {
  const messages: string[] = [];

  await logOutboundIp({
    fetchOutboundIp: async () => "74.220.52.10",
    log: (message) => messages.push(message),
  });

  assert.deepEqual(messages, ["[startup] outbound ip=74.220.52.10"]);
});

test("trims surrounding whitespace so a trailing newline does not break the log line", async () => {
  const messages: string[] = [];

  await logOutboundIp({
    fetchOutboundIp: async () => "  74.220.60.3\n",
    log: (message) => messages.push(message),
  });

  assert.deepEqual(messages, ["[startup] outbound ip=74.220.60.3"]);
});

test("never rejects when the lookup fails so server startup is not blocked", async () => {
  const errors: string[] = [];

  await assert.doesNotReject(
    logOutboundIp({
      fetchOutboundIp: async () => {
        throw new Error("network unreachable");
      },
      logError: (message) => errors.push(message),
    }),
  );

  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /^\[startup\] outbound ip 조회 실패/);
});

/**
 * 조회 서비스의 응답은 외부 입력이다. 그대로 찍으면 응답에 심은 개행으로
 * 가짜 로그 줄을 만들 수 있다. IPv4 형태가 아니면 원문을 남기지 않는다.
 */
test("never logs the raw response body when it is not an IPv4 address", async () => {
  const messages: string[] = [];

  await logOutboundIp({
    fetchOutboundIp: async () => "<html>error</html>\n[startup] outbound ip=203.0.113.9",
    log: (message) => messages.push(message),
    logError: (message) => messages.push(message),
  });

  const logged = messages.join("\n");
  assert.ok(!logged.includes("<html>"), "원문 HTML 이 로그에 남았다");
  assert.ok(!logged.includes("203.0.113.9"), "응답에 심은 가짜 IP 가 로그에 남았다");
  assert.match(logged, /^\[startup\] outbound ip 응답 형식이 예상과 다르다/);
});
