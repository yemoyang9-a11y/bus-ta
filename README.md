# bus-ta

**AI·BLE 기반 시각장애인 대중교통 탑승·하차 보조 시스템** — 한이음 프로젝트

BLE 비콘으로 버스를 감지하고, GPS로 경로를 추적하며, 스마트 하차벨을 자동 제어해 시각장애인의 대중교통 이용을 돕습니다.

## 구조

```
apps/mobile     Expo 앱 (시각장애인 사용자 인터페이스)
apps/server     Node.js + Express API 서버
packages/shared 공유 타입 · 상수 · 스키마 · 시연 데이터
hardware/       ESP32 펌웨어 (버스 비콘, 스마트지팡이, 스마트 하차벨)
docs/           설계 문서 · API 명세 · 시연 가이드
supabase/       DB 마이그레이션
```

## 빠른 시작

```bash
pnpm install
# 서버
cd apps/server && cp .env.example .env  # 환경변수 편집 후
pnpm dev
# 앱
cd apps/mobile && cp .env.example .env
pnpm start
```

## 문서

- [프로젝트 배경](docs/project-context.md)
- [레포지토리 구조](docs/repository-structure.md)
- [API 명세](docs/api/api-spec.md)
- [시스템 개요](docs/architecture/system-overview.md)
- [시연 시나리오](docs/demo-scenario/call-order.md)
- [DB 스키마](docs/database/schema.md)

## 개발 규칙

[CLAUDE.md](CLAUDE.md) 참고 — API 경로 단일 출처, 상태값 규칙, 브랜치 정책 등.
