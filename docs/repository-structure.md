# 레포지토리 구조

```
bus-ta/
├── apps/
│   ├── mobile/          # Expo + TypeScript 앱
│   │   ├── src/
│   │   │   ├── api/     # API_PATHS 기반 클라이언트 래퍼
│   │   │   └── demo/    # mock 좌표 전송 순서 제어
│   │   └── App.tsx
│   └── server/          # Node.js + Express + TypeScript 서버
│       └── src/
│           ├── routes/          # API 라우터 (API_PATHS 기반)
│           ├── services/trip/   # 정류장 계산 서비스
│           ├── repositories/    # DB 접근 인터페이스
│           └── adapters/bell/   # 하차벨 어댑터 (mock 포함)
├── packages/
│   └── shared/          # @bus-ta/shared — 타입/상수/스키마/픽스처 단일 출처
│       └── src/
│           ├── constants/   # api-paths, trip-status, bell-status, bell-command, beacon-id
│           ├── types/       # ids, station, route, trip, location, bell, beacon
│           ├── schemas/     # Zod 검증 스키마
│           └── fixtures/    # 시연용 mock 데이터
├── hardware/
│   ├── bus-beacon/      # ESP32 버스 비콘 펌웨어 자리
│   ├── smart-cane/      # 스마트지팡이 펌웨어 자리
│   └── smart-bell/      # 스마트 하차벨 펌웨어 자리
├── supabase/
│   └── migrations/      # SQL 마이그레이션
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── database/
│   └── demo-scenario/
├── scripts/             # 개발/시연 보조 스크립트
└── .github/
    ├── workflows/ci.yml
    └── pull_request_template.md
```

## Mock 책임 구분

| 역할 | 위치 |
|---|---|
| 시연 데이터 단일 출처 | `packages/shared/src/fixtures/` |
| mock 좌표 전송 순서 제어 | `apps/mobile/src/demo/` |
| 정류장 계산 (좌표→상태) | `apps/server/src/services/trip/` |
| mock 하차벨 결과 생성 | `apps/server/src/adapters/bell/mock-bell.adapter.ts` |
