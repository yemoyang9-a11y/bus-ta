-- 목적: trips.candidate_id 제약을 「공통 데이터 모델 및 상태 명세서」 5.2 계약
--       (candidateId = positive integer, 필수)에 맞춘다.
--
-- 배경: 20260701_create_backend_mvp_tables.sql 은 candidate_id 를 nullable 로 두고
--       CHECK 를 `candidate_id is null or candidate_id >= 0` 으로 걸어 0 과 NULL 을 허용한다.
--       반면 packages/shared/src/schemas/route.schema.ts 의 Zod 는 int().positive() 로
--       0 과 누락을 거부한다. 계약과 코드는 같고 DB 만 느슨하므로 DB 를 좁힌다.
--
-- 적용 상태: 2026-08-04 Supabase 원격 프로젝트 적용 완료.
--       적용 시점 위반 행 0건, 적용 후 candidate_id NOT NULL + trips_candidate_id_positive 확인.
--       로컬/신규 환경에 적용할 때는 아래 사전 점검을 먼저 수행한다.
--
-- 사전 점검 (대상 행이 0건이어야 한다):
--   select trip_id, candidate_id
--   from public.trips
--   where candidate_id is null or candidate_id <= 0;
--
-- 위반 행이 있으면 아래 DO 블록이 명시적으로 실패한다. 그 경우 데이터를 보정할지,
-- 계약을 nullable 로 완화할지 팀이 먼저 결정한 뒤 다시 실행한다. 조용히 값을 채우지 않는다.
--
-- 롤백:
--   alter table public.trips alter column candidate_id drop not null;
--   alter table public.trips drop constraint if exists trips_candidate_id_positive;
--   alter table public.trips add constraint trips_candidate_id_nonnegative
--     check (candidate_id is null or candidate_id >= 0);

do $$
declare
  invalid_count integer;
begin
  select count(*) into invalid_count
  from public.trips
  where candidate_id is null or candidate_id <= 0;

  if invalid_count > 0 then
    raise exception
      'trips.candidate_id 제약을 강화할 수 없습니다: 위반 행 %건. 사전 점검 쿼리로 대상을 확인하고 데이터를 보정한 뒤 다시 실행하세요.',
      invalid_count;
  end if;
end $$;

alter table public.trips
  drop constraint if exists trips_candidate_id_nonnegative;

alter table public.trips
  add constraint trips_candidate_id_positive
    check (candidate_id > 0);

alter table public.trips
  alter column candidate_id set not null;
