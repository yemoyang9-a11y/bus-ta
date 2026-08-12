#!/usr/bin/env bash
# 노선 검색 후보 0건 진단용 프로브. 본문은 파일(UTF-8)로 넘긴다 —
# Windows Git Bash에서 명령줄 인자로 한글을 넘기면 CP949로 깨진다(handoff 8절).
set -u

API="https://bus-ta.onrender.com/api/routes/search"
TMP="$(mktemp -d)"

probe() {
  local label="$1" body="$2"
  printf '%s' "$body" > "$TMP/body.json"
  printf '\n--- %s ---\n' "$label"
  printf 'sent(UTC): %s\n' "$(date -u +%H:%M:%S)"
  curl -s -m 60 -X POST "$API" -H "Content-Type: application/json" -d @"$TMP/body.json"
  printf '\n'
}

probe "수원대 -> 수원역" '{"destination":"수원역","latitude":37.213789,"longitude":126.979749}'
probe "수원대 -> 병점역" '{"destination":"병점역","latitude":37.213789,"longitude":126.979749}'
probe "수원역 -> 아주대학교" '{"destination":"아주대학교","latitude":37.265640,"longitude":126.999780}'
probe "아주대 -> 수원역" '{"destination":"수원역","latitude":37.280300,"longitude":127.043500}'
probe "강남역 -> 양재역" '{"destination":"양재역","latitude":37.497940,"longitude":127.027600}'
probe "병점역 -> 수원역" '{"destination":"수원역","latitude":37.205800,"longitude":127.032300}'

rm -rf "$TMP"
