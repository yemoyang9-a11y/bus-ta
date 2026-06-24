## 변경 요약

<!-- 이 PR이 무엇을 변경하는지 간략히 설명해 주세요 -->

## 체크리스트

- [ ] 관련 `docs/` 문서를 먼저 읽었다
- [ ] API 경로는 `packages/shared/src/constants/api-paths.ts`에서만 참조했다
- [ ] 폐기된 API(`GET /trips/{id}/bell`, `POST /api/ble/result`)를 사용하지 않았다
- [ ] `requestId`(위치 업데이트용)와 `bellRequestId`(하차벨용)를 혼용하지 않았다
- [ ] 비밀키·실제 환경변수 값을 코드에 넣지 않았다
- [ ] `main` 브랜치에 직접 push하지 않았다
