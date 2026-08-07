# 포켓몬 피규어 아카이브 v5.1 UI 개선판

v5 Online Beta의 서버 구조와 기존 로컬 데이터를 유지하면서 모바일 UI와 친구 기능을 다듬은 버전입니다.

## 주요 변경점

- 친구 코드를 누르거나 `복사` 버튼으로 즉시 복사
- iPhone 공유 시트를 이용한 친구 코드 공유
- 친구/요청 탭 분리
- 받은 요청과 보낸 요청 구분
- 친구 카드에 피규어 수·포켓몬 종 수 표시
- 친구 비교 버튼과 빈 화면 안내 개선
- 프로필 누락 시 업로드 오류 방지
- 온라인 화면의 흰 배경·흰 글자 대비 오류 수정
- 자동완성 입력창과 select 메뉴 명암 보정
- 세대별 완성률, 최근 획득, 제조사·시리즈 도감 접기/펼치기
- 접기 상태를 기기에 기억
- 서비스 워커 캐시 버전 갱신

## 기존 v5 사이트 업데이트

`pokemon-figure-archive-v5.1-ui-update.zip` 안의 파일만 GitHub 저장소 최상단에 덮어씁니다.

- `index.html`
- `app.js`
- `online.js`
- `styles.css`
- `sw.js`

기존 `supabase-config.js`는 실제 Project URL과 Publishable key가 들어 있으므로 덮어쓰지 마세요.

배포 후 이전 화면이 남으면 홈 화면 앱과 Safari 탭을 완전히 닫고 사이트를 다시 열어 서비스 워커를 갱신합니다.

## 신규 설치

전체 압축파일을 사용한 뒤 `supabase-config.js`의 URL과 Publishable key를 직접 입력하고 `supabase-schema.sql`을 Supabase SQL Editor에서 실행합니다.
