# 시스템 개요

## 컴포넌트 관계

```
[스마트지팡이 / 사용자 앱]
        │  BLE 스캔
        ▼
[ESP32 버스 비콘] ──── 버스에 장착
        │
        ▼
[apps/mobile] ─── HTTPS ──→ [apps/server]
        │                         │
        │                    [Supabase DB]
        │
        │  앱이 STOP_REQUEST 전달
        ▼
[스마트 하차벨]
        │
        └─── 음성/햅틱 피드백 → 사용자
```

## 외부 API

| API | 용도 |
|---|---|
| 카카오 로컬 API | 정류장 좌표 검색 |
| 경기도 GBIS API | 버스 노선·정류장 정보 |
| OpenAI API | 음성 안내 또는 경로 요약 (예정) |

## 데이터 흐름

자세한 내용은 [`architecture/data-flow.md`](./data-flow.md) 참고.
