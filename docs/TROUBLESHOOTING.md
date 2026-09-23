# 오류 해결 기록

이 문서는 팀 개발 중 발생한 오류와 해결 방법을 누적하기 위한 문서입니다. 같은 오류가 반복될 때 원인을 빠르게 찾을 수 있도록 기록합니다.

## 2026-09-22 리허설: 진동 감쇠·재접근·하차 후 마무리

- 사용자 관측: 가까우면 진동했지만 멀어질 때 갑자기 끊겼고, 탑승 발화 전 재접근해도 돌아오지 않았다. 수동 탑승 뒤 1정류장 전 물리 벨은 울렸지만 목적지 이후 종료 안내가 없었다. 당시 실행 버전은 미확인이다.
- 수정 전 소스에서 확인한 지팡이 원인 후보: 상태/신호 누락 때 즉시 OFF, 상태 변화 때만 평균 RSSI Notify, 스캔과 모터 대기가 함께 진행되는 구조. 느린 재접근에서 이전 상태가 유지될 수 있었다. 이 분석만으로 당시 장비의 단일 원인을 확정하지 않는다.
- 수정 전 앱에서 확인한 원인 후보: Riding→Alight 이동 시 위치 구독을 중지하고 하차 화면에서 재개하지 않았다. 서버의 목적지 판정 코드는 있었지만 도착까지의 위치가 전달되지 않았다. 별도로 자동 탑승 감지 함수와 cane Notify 구독의 실제 소비 연결도 빠져 있었다.
- 수정·검증의 현재 상태는 [실행 결과](superpowers/plans/2026-09-22-rehearsal-results.md)에 기록한다. 지팡이 제어기/명령 경합, 화면 전환 후 위치, 완료 음성 재생 종료, 자동 탑승 연결을 각각 검증한다.
- 재발 방지: 펌웨어/앱/서버 버전을 같은 운행 기록에 적고, [현장 시험표](DEMO_SCENARIO.md)의 탑승 발화 전 거리 왕복·자동/수동 구분·2/1/0정류장 흐름을 수행한다. 실제 하차와 목적지 도착 판정을 혼동하지 않는다.

## Windows 한글 작업 경로에서 검증 도구 실행 실패

- Arduino-ESP32 3.3.12 첫 빌드는 컴파일 뒤 링커가 한글 출력 경로의 ELF를 열지 못했다. PostgreSQL 15.19 초기화도 한글 경로에서 인코딩 오류가 났다. 해당 실행만으로 제품 소스 오류라고 판정하지 않는다.
- 이번 작업의 도구/데이터는 격리된 임시 영문 경로 또는 작업 폴더의 임시 드라이브 별칭으로 실행한다. 기존 개인 Arduino 설정·운영 DB·Docker 데이터를 초기화하지 않는다.
- 하위 프로세스 실행이 `spawn EPERM`으로 거절되면 같은 명령을 허용된 권한에서 재실행하고 결과를 구분한다. 실패한 실행을 성공으로 기록하지 않는다.
- 정확한 버전·체크섬·명령·실제 종료코드는 실행 결과와 `.agent-loop/T1-testing.md`에 남긴다. 임시 서버와 드라이브 별칭은 검증 종료 후 정리한다.

## 스마트지팡이 연결 후 GATT 명령이 이어지지 않음

- 증상: 앱이 `White_cane`을 발견해도 ESP32 시리얼 모니터에 `SET_TARGET_BEACON`, `START_BEACON_SCAN`이 연속해서 나타나지 않고 진동 시험이 시작되지 않았다.
- 원인: 준비 흐름은 `SET_TARGET_BEACON`까지만 전송하고 `START_BEACON_SCAN`을 서버의 `shouldScanBeacon` 신호가 올 때까지 미뤘다. 따라서 연결 성공 자체가 실제 스캔 시작을 보장하지 않았다.
- 수정: 지팡이 연결과 서비스 탐색 후 `SET_TARGET_BEACON` Write 성공을 기다린 다음 `START_BEACON_SCAN`을 즉시 Write한다. 두 명령이 모두 성공해야 앱의 스캔 상태를 활성화하며, 각 GATT Write의 시작·성공·실패를 로그로 남긴다.
- 실물 확인: 앱 로그에서 두 명령의 `GATT Write 성공` 순서를 확인하고, ESP32 시리얼 모니터에서 `[설정] 타겟 비콘` 다음 `[제어] 스캔 시작`이 출력되는지 확인한다.

## 기록 규칙

- 팀 전체에 도움이 되는 오류만 기록합니다.
- 실제 원인을 모르면 `확인 필요`로 남깁니다.
- 임시 해결 방법과 최종 해결 방법을 구분합니다.
- 관련 커밋 또는 Pull Request가 있으면 함께 남깁니다.

## 오류 기록 양식

```md
## 오류 제목

- 발생 날짜:
- 담당자:
- 발생 환경:
- 증상:
- 원인:
- 해결 방법:
- 수정 파일:
- 재발 방지 방법:
- 관련 커밋 또는 Pull Request:
```

## 예시

```md
## BIS API 응답 지연으로 도착 정보 조회 실패

- 발생 날짜: 확인 필요
- 담당자: 확인 필요
- 발생 환경: 백엔드 개발 서버
- 증상: 도착 정보 조회 요청 후 응답 시간이 길어짐
- 원인: 외부 API 응답 지연 또는 네트워크 문제
- 해결 방법: 확인 필요
- 수정 파일: 확인 필요
- 재발 방지 방법: 타임아웃과 재시도 정책 추가 검토
- 관련 커밋 또는 Pull Request: 확인 필요
```

## GET /api/health 의 dbStatus 가 NOT_CONFIGURED 로 나옴

- 발생 날짜: 2026-06-27
- 담당자: 예모
- 발생 환경: 백엔드 로컬 개발 (apps/server)
- 증상: `apps/server/.env` 에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 를 넣었는데도
  `GET /api/health` 응답이 `dbStatus: "NOT_CONFIGURED"` 로 나온다.
- 원인: 서버가 `.env` 파일을 자동으로 읽지 않았다. `tsx watch src/index.ts` 와
  `node dist/index.js` 는 `.env` 를 자동 로드하지 않으므로 `process.env` 에 값이 들어가지 않았다.
- 임시 해결 방법: 서버를 실행하는 셸에서 환경변수를 직접 주입한 뒤 실행
  (`$env:SUPABASE_URL=...; $env:SUPABASE_SERVICE_ROLE_KEY=...; pnpm --filter @bus-ta/server dev`).
- 최종 해결 방법: `apps/server/src/index.ts` 시작 시 실행 디렉터리의 `.env` 를
  `process.loadEnvFile` 로 자동 로드한다. 파일이 없으면 건너뛰고, 셸에 이미 설정된 변수가 우선한다.
- 수정 파일: `apps/server/src/index.ts`
- 재발 방지 방법: `.env` 는 `.gitignore` 로 커밋 금지, 변수 이름은 `apps/server/.env.example` 에만 유지.
- 관련 커밋 또는 Pull Request: yemo-develop 브랜치 커밋

## Supabase Data API가 백엔드 외부에서 접근되지 않음

- 발생 날짜: 2026-08-04
- 담당자: 예모
- 발생 환경: Render `bus-ta` 및 로컬 백엔드
- 증상: 백엔드가 Supabase 테이블·RPC를 호출하지 못하거나 anon 키를 사용하는 것처럼 보인다.
- 원인: 백엔드는 서버 전용 `SUPABASE_SERVICE_ROLE_KEY`만 사용한다. `SUPABASE_ANON_KEY`는 지원하지 않으며, 대상 테이블과 RPC는 anon/authenticated 역할에 공개하지 않는다.
- 해결 방법: `SUPABASE_URL`에는 `/rest/v1/`가 붙지 않은 프로젝트 기본 URL을 설정하고, `SUPABASE_SERVICE_ROLE_KEY`는 Render/server secret에만 설정한다. 모바일 앱과 `EXPO_PUBLIC_*` 환경변수에는 service-role 키를 넣지 않는다.
- 수정 파일: `apps/server/src/config/supabase.ts`, `.env.example`, `apps/server/.env.example`, `supabase/migrations/20260804112643_secure_data_api_access.sql`
- 재발 방지 방법: 배포 환경에 service-role 키 설정 여부를 확인하고, anon 키를 사용한 직접 Data API 접근과 Supabase security advisor 결과를 별도로 점검한다.
- 관련 커밋 또는 Pull Request: [PR #5](https://github.com/yemoyang9-a11y/bus-ta/pull/5)

## POST /api/routes/search 가 502 인데 원인을 어디에서도 알 수 없음

- 발생 날짜: 2026-08-07
- 담당자: 예모
- 발생 환경: Render `bus-ta` 운영 (`claude/nice-archimedes-iv7iu0` 배포 후)
- 증상: `POST /api/routes/search` 가 `502 ROUTE_SEARCH_FAILED` 를 돌려주는데,
  Kakao 때문인지 ODsay 때문인지, 상태 코드가 무엇이었는지 알 수 없다.
  Render 로그를 아무리 뒤져도 `AxiosError` 가 나오지 않는다.
- 원인: 두 곳에서 실패 정보가 사라지고 있었다.
  1. `search-routes.service.ts` 의 `catch { ... }` 가 오류 객체를 바인딩조차 하지 않아
     AxiosError 가 그대로 소멸했다. 서버에는 요청 로거도 없어 흔적이 남지 않는다.
  2. `hyorin-route-search.adapter.ts` 의 ODsay 호출이 `if (!res.data.result) return []`
     이라, ODsay 가 인증 실패를 **HTTP 200 + error 본문**으로 돌려줘도
     "조건에 맞는 후보 없음"과 구분되지 않았다.
- 해결 방법: 실패 지점을 로그로 드러낸다. 공개 API 계약(502 / 200+빈 배열)은 바꾸지 않았다.
  - 외부 호출 실패는 `upstream`(`KAKAO`/`ODSAY`)과 HTTP 상태를 담은 오류로 감싼다.
  - 서비스는 502 로 응답하기 전에 `[routes/search] 외부 API 요청 실패 upstream=... status=... message=...` 를 남긴다.
  - ODsay 응답에 `result` 가 없으면 `[routes/search] ODSAY 응답에 result 가 없다 code=... message=...` 를 남긴다.
- 로그 읽는 법:
  - `upstream=KAKAO status=401` → Kakao 키가 무효하거나 `KAKAO_REST_API_KEY` 이름이 다르다.
  - `upstream=KAKAO status=429` → Kakao 쿼터·스로틀.
  - `message=[ApiKeyAuthFailed] ...` → `ODSAY_API_KEY` 문제. 후보 0건은 필터 탓이 아니다.
  - `upstream=UNKNOWN` 인데 `message=목적지를 찾을 수 없습니다: ...` → Kakao 는 정상이고 검색어가 없는 장소다.
- 주의: 오류 객체를 통째로 로그에 찍으면 안 된다. `AxiosError.config` 에 요청에 쓴 API 키가
  그대로 들어 있다. 그래서 원본 AxiosError 는 `cause` 로도 넘기지 않는다.
- 수정 파일: `apps/server/src/services/route/search-routes.service.ts`,
  `apps/server/src/adapters/routes/hyorin-route-search.adapter.ts`
- 재발 방지 방법: 외부 API 호출을 새로 추가할 때 실패를 삼키지 않는다.
  `catch {}` 와 "오류를 빈 결과로 바꿔 반환"은 운영에서 진단을 불가능하게 만든다.
- 남은 문제: `getBusArrivalByStationId`(GBIS)는 아직 같은 처리가 되어 있지 않다.
  `predictedArrivalMinutes` 가 `null` 로 나올 때 원인을 여전히 알 수 없다.

## CI의 탑승 판정 스크립트가 Node 22에서 모듈 export 오류로 실패

- 발생 날짜: 2026-09-23
- 발생 환경: PR #57 GitHub Actions, Node 22.17.0, `pnpm test:scripts`
- 증상: `boarding-detector.test.mjs`가 `boardingDetector.js`의 `createBoardingDetector` 이름 export를 찾지 못해 실패했다. 같은 테스트는 로컬 Node 24에서 통과했다.
- 원인: `apps/mobile`은 모듈 타입을 선언하지 않는다. Node 22의 `tsx` 테스트 실행에서는 모바일 JS 파일이 CommonJS 기본 export 형태로 노출되어 `.mjs` 테스트의 정적 이름 import와 맞지 않았다.
- 해결 방법: 테스트에서 모듈 namespace를 가져와 ESM 이름 export 또는 CommonJS 기본 export의 함수를 확인한다. 모바일 앱 모듈 형식과 판정 로직은 바꾸지 않는다.
- 수정 파일: `scripts/boarding-detector.test.mjs`
- 검증: 로컬 `pnpm test:scripts` 68/68 통과. PR CI의 동일 Node 22 단계는 후속 실행 결과로 확인한다.

## Windows에서 API를 curl로 테스트하면 한글 목적지가 깨져 502가 난다

- 발생 날짜: 2026-08-08
- 담당자: 예모
- 발생 환경: Windows Git Bash에서 운영/로컬 백엔드로 `POST /api/routes/search` 호출
- 증상: 실재하는 목적지("병점역후문", "수원역")를 보내도 `502 ROUTE_SEARCH_FAILED` 가 난다.
  같은 목적지가 어떤 때는 되고 어떤 때는 안 돼서 서버 장애처럼 보인다.
  서버 로그에는 이렇게 찍힌다.

  ```text
  [routes/search] 외부 API 요청 실패 upstream=UNKNOWN status=unknown message=목적지를 찾을 수 없습니다: <깨진 문자열>
  ```

- 원인: **서버 문제가 아니라 클라이언트(curl) 인코딩 문제다.**
  Windows Git Bash에서 **명령줄 인자**로 넘긴 한글은 프로세스에 전달되는 과정에서
  CP949 로 변환돼 깨진다. 서버는 깨진 문자열을 그대로 Kakao 로 검색하고,
  Kakao 가 `documents: []` 를 돌려주면 어댑터가 `목적지를 찾을 수 없습니다` 를 던진다.
  `upstream=UNKNOWN` 은 **Kakao 호출 자체는 성공했다**는 신호다
  (호출이 실패했다면 `upstream=KAKAO status=401` 처럼 찍힌다).
- 해결 방법: non-ASCII 가 포함된 요청 본문은 **stdin 으로 넘긴다.**
  아래 예제는 그대로 복사해서 쓸 수 있다. heredoc 종료 표시 `EOF` 는
  들여쓰기 없이 줄 맨 앞에 와야 heredoc 이 닫힌다.

```bash
# OK — heredoc 이 원본 UTF-8 바이트를 그대로 전달한다
curl -X POST "$URL" -H "Content-Type: application/json" -d @- <<'EOF'
{"destination":"병점역후문","latitude":37.213789,"longitude":126.979749}
EOF

# NG — 인자로 넘기면 한글이 깨진다
curl -X POST "$URL" -H "Content-Type: application/json" \
  -d '{"destination":"병점역후문","latitude":37.213789,"longitude":126.979749}'
```

- UTF-8 로 저장한 파일을 `-d @body.json` 으로 넘겨도 안전하다.
- 검증: 같은 초에 두 형태를 나란히 보내 확인했다(2026-08-08 00:02 KST, 운영).
  heredoc → `{"success":true,"destination":"병점역후문",...}`,
  인라인 인자 → `{"success":false,"errorCode":"ROUTE_SEARCH_FAILED",...}`
- 재발 방지 방법: 한글 목적지로 API 를 테스트할 때는 항상 stdin 또는 파일로 본문을 넘긴다.
  "같은 요청인데 결과가 달라졌다"고 판단하기 전에, 요청을 보낸 **명령 형태가 정말 같았는지**
  먼저 대조한다.
