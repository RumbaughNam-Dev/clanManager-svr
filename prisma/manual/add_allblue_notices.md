# AllBlue 공지사항 배포

1. 개발·운영 서버가 함께 사용하는 공용 AllBlue DB에 `add_allblue_notices.sql`을 한 번만 적용합니다. DB는 개발·운영으로 나뉘지 않습니다. 다른 서비스 DB용 `prisma/migrations`와 혼용하지 않습니다.
2. `prisma generate --schema=prisma/allblue.prisma` 후 백엔드를 빌드·배포합니다.
3. 모바일 변경을 배포합니다. 공지사항 자체는 새 네이티브 모듈을 사용하지 않습니다.

서버는 모든 조회에 JWT 인증을 요구하며, 등록·수정·삭제마다 DB의 프로필 등급 `A`를 확인합니다.
삭제는 `deleted` 플래그만 설정합니다. 작성자 이름은 등록 당시 스냅샷으로 남습니다.
팝업 API는 공지 데이터를 공통 슬라이드 형식(`kind: notice`)으로 반환합니다. 모바일 공통 캐러셀은 추후 `kind: image` 및 `imageUrl`을 가진 광고도 표시할 수 있습니다. 광고 등록·관리 API는 이번 변경에 포함하지 않습니다.

검증: `npx jest src/allblue/notices.spec.ts --runInBand` 또는 `node scripts/test-notices.cjs`.
