# 인수인계 (2026-11-17 새벽 갱신)

## 만들 것
폴더를 선택하면 브라우저 안에서 암호화해 잠그고, 복호키 파일이 있어야만 열 수 있게 하는 사이트.

## 확정된 결정
- **복호키: 키 파일(.key)** — 잠글 때 다운로드됨. USB에 보관. 비밀번호 방식 아님.
- **잠금 방식: 잠긴 파일(.vault)로 다운로드** — 원본 폴더는 자동 삭제하지 않음(직접 지우라고 안내). 모든 브라우저 지원.
- **열기**: .vault + .key 선택 → 원래 폴더를 .zip으로 복원해 다운로드.
- **서버로 아무것도 보내지 않음.** 암호화는 전부 브라우저(Web Crypto). DB(Supabase) 불필요.
- 스택: Next.js 16 + Tailwind 4 + shadcn/ui(base-ui) → Vercel 프로젝트 `pile-security` (main 푸시 시 자동 배포)
- 한 번에 잠글 수 있는 최대 크기 2GB (`MAX_TOTAL_BYTES`) — fflate가 ZIP64(4GB 이상)를 지원하지 않고 브라우저 메모리도 고려

## 암호화 설계 (구현 완료: `src/lib/vault.ts`)
- AES-256-GCM, 256비트 랜덤 키, 청크(1MB)마다 랜덤 IV 12B
- .key 파일: JSON `{ type: "pile-security-key", v: 1, kid(hex 32자), key(base64), folder, created }`
- .vault: `[매직 "PILEVLT1"][kid 16B][매니페스트 길이 u32][매니페스트 IV+암호문][청크 IV+암호문...]`
  - 매니페스트(암호화): 폴더 이름, 파일 경로·크기·수정시각 → 파일 이름도 숨김
  - AAD에 매직+kid+(파일 번호, 청크 번호, 마지막 여부) → 순서 바꾸기·잘라내기 방지
  - 빈 파일도 빈 청크 1개를 둠
  - kid가 다르면 바로 "이 금고의 키가 아님", 매니페스트 복호화 실패도 wrong-key
  - 전체 길이를 매니페스트로 계산해서 비교 → 잘림·덧붙임 감지
  - 복원 시 경로 검사(`..`, 절대 경로 거부) → zip 경로 탈출 방지
- 결과는 32MB마다 Blob으로 묶어서 메모리 사용 줄임 (`BlobBuilder`)
- 복원 zip: `fflate`의 `Zip` + `ZipPassThrough` (압축 없이 저장, 빠름)

## 진행 상태
- [x] Next.js + Tailwind + shadcn 초기화, 컴포넌트 추가 (button, card, tabs, progress, alert, badge)
- [x] 정체불명 npm 패키지 `cn` 제거 → `src/lib/utils.ts`를 shadcn 표준(clsx + tailwind-merge)으로 교체
- [x] `src/lib/vault.ts` 암호화·복호화 + 테스트 12개 (`tests/vault.test.ts`, **`npm test`로 실행, 모두 통과**)
  - vitest는 ERESOLVE(버전 충돌)로 설치 실패 → Node 내장 `node:test` 사용. tsconfig에 `allowImportingTsExtensions` 추가
- [x] 화면 `src/components/vault-app.tsx`: 잠그기/열기 탭, 폴더 선택(webkitdirectory), 진행률, 열쇠 꼬리표 카드, 키 분실 경고, 열쇠 안 받고 나가면 경고
- [x] 디자인: 강철 회색 `#eef1f4` / 잉크 `#17202a` / 놋쇠 `#9a6b12`, 글꼴 IBM Plex Sans KR (+ 키 지문만 IBM Plex Mono). 토큰은 `globals.css`
- [x] layout.tsx 제목·`lang="ko"`
- [x] `npm run lint` 통과
- [ ] **`npm run build` 확인** ← 바로 다음 할 일. 지난번엔 학교 PC C: 디스크가 꽉 차서 빌드 도중 실패(코드 문제 아님). `tsc`에서 `LayoutProps` 오류가 나는 건 빌드 때 생성되는 타입이라 정상
- [ ] 브라우저로 잠그기 → 열기 → 원본과 같은지 확인 (`npm run dev` 후 실제 폴더로). 화면 스크린샷 보고 디자인 다듬기
  - 주의: 열쇠를 안 받고 "다른 폴더 잠그기"를 누르면 `window.confirm` 창이 뜸 (브라우저 자동화 중엔 피할 것)
- [ ] 리뷰·보안 점검 (code-review, claude-security)
- [ ] main 푸시 → Vercel 자동 배포 확인

## 다음에 이어서 하는 법
```bash
git clone https://github.com/jihwan8784/Pile-security   # C: 같은 빠른 드라이브에
cd Pile-security
git checkout feat/vault   # 이번 작업은 이 브랜치에 있음 (빌드 확인 후 main에 합치기)
npm install
npm test        # 12개 통과 확인
npm run build   # 디스크 여유 1GB 이상 필요
npm run dev     # http://localhost:3000 에서 직접 잠그기/열기 해보기
```
Claude Code에서는 "HANDOFF.md 읽고 이어서 해줘".

## 참고
- 학교 PC C: 드라이브가 작다(57GB). 시작할 때 `Get-PSDrive C`로 여유 공간 먼저 확인. 부족하면 `npm cache clean --force`
- Vercel 환경변수 `DATABASE_URL`(예전 게임용, DB 삭제됨)은 대시보드에서 지워야 함 (사용자가 직접)
- 이 프로젝트의 Next.js는 학습 데이터와 다를 수 있음 → `node_modules/next/dist/docs/` 참고 (AGENTS.md)
