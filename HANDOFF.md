# 인수인계 (2026-11-16)

## 만들 것
폴더를 선택하면 브라우저 안에서 암호화해 잠그고, 복호키 파일이 있어야만 열 수 있게 하는 사이트.

## 확정된 결정
- **복호키: 키 파일(.key)** — 잠글 때 다운로드됨. USB에 보관. 비밀번호 방식 아님.
- **잠금 방식: 잠긴 파일(.vault)로 다운로드** — 원본 폴더는 자동 삭제하지 않음(직접 지우라고 안내). 모든 브라우저 지원.
- **열기**: .vault + .key 선택 → 원래 폴더를 .zip으로 복원해 다운로드.
- **서버로 아무것도 보내지 않음.** 암호화는 전부 브라우저(Web Crypto). DB(Supabase) 불필요.
- 스택: Next.js 16 + Tailwind 4 + shadcn/ui(base-ui) → Vercel 프로젝트 `pile-security` (main 푸시 시 자동 배포)

## 암호화 설계 (구현 예정)
- AES-256-GCM, 키는 `crypto.getRandomValues`로 만든 256비트 랜덤 키
- .key 파일: JSON `{ type: "pile-security-key", v: 1, kid, key(base64), folder, created }`
- .vault 파일 구조: `[매직 "PILEVLT1"][kid 16B][암호화된 매니페스트][암호화된 청크들...]`
  - 매니페스트(암호화): 폴더 이름, 파일 경로·크기·수정시각 목록 → 파일 이름도 숨김
  - 파일 내용은 1MB 청크 단위로 암호화, 청크마다 랜덤 IV 12B
  - AAD에 (파일 번호, 청크 번호, 마지막 여부)를 넣어 순서 바꾸기·잘라내기 방지
  - 키가 틀리면 매니페스트 복호화 단계에서 바로 실패 → "키가 맞지 않음"
- 큰 폴더 대비: 결과를 Blob 조각으로 이어 붙여 메모리 사용 줄이기
- 복원 zip: `fflate` (설치됨)

## 진행 상태
- [x] Next.js + Tailwind + shadcn 초기화, 컴포넌트 추가 (button, card, tabs, progress, alert, badge)
- [x] shadcn이 `from "cn"`으로 잘못 넣은 import를 `@/lib/utils`로 수정, `npm run build` 성공
- [ ] `src/lib/vault.ts` (암호화·복호화) + 테스트 (vitest 설치는 실패했음 → 다시 시도 또는 node:test)
- [ ] 화면: 잠그기/열기 탭, 폴더 선택(`<input webkitdirectory>`), 진행률, 키 분실 경고
- [ ] layout.tsx 제목·lang="ko" 수정, 디자인
- [ ] Playwright로 잠그기 → 열기 → 원본과 같은지 확인
- [x] Vercel 프로젝트 framework 설정을 Next.js로 변경함
- [ ] 기능 완성 후 배포 확인

## 참고
- Vercel 환경변수 `DATABASE_URL`(예전 게임용, DB 삭제됨)은 대시보드에서 지워야 함
- 이 프로젝트의 Next.js는 학습 데이터와 다를 수 있음 → `node_modules/next/dist/docs/` 참고 (AGENTS.md)
