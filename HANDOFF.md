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
- [x] `npm run build` 통과 (2026-11-19)
- [x] Edge 자동 테스트(playwright-core)로 잠그기 → 열기 왕복 확인: 한글 이름·하위 폴더·빈 파일·정확히 1MB·2.5MB 파일 모두 원본과 SHA-256 동일, .vault 안에 원문·파일명 노출 없음, 틀린 키 거부, 콘솔 오류 없음
  - **버그 수정**: 작업 중 탭 버튼을 모두 disabled로 하면 Base UI가 선택된 탭을 해제해서 잠근 뒤 결과 화면(열쇠 받기)이 안 보였음 → 탭을 제어 상태로 바꾸고 "다른" 탭만 막도록 수정
  - 주의: 열쇠를 안 받고 "다른 폴더 잠그기"를 누르면 `window.confirm` 창이 뜸 (브라우저 자동화 중엔 피할 것)
- [x] 보안 점검 (2026-11-19)
  - `next.config.ts`에 CSP·보안 헤더 추가. 핵심은 `connect-src 'self'`(열쇠를 외부로 보낼 수 없음), `frame-ancestors 'none'`(다른 사이트에 끼워 넣기 차단). CSP 켠 상태로 E2E 재통과
  - `shadcn`(CLI, 빌드 때 CSS만 씀)을 devDependencies로 이동 → `npm audit --omit=dev` 취약점 0
  - zip 이름 정리(`uniqueZipName`): 윈도우 금지 글자(`:` 등)→`_`, CON·NUL 등 예약어 앞에 `_`, 끝 점·공백→`_`, 겹치는 이름(대소문자만 달라도)은 ` (2)` 붙임. 거부하지 않고 바꾸는 이유: 맥·리눅스 폴더도 열 수 있게. 테스트 15개 통과
  - Vercel 환경변수 `DATABASE_URL`(예전 게임용) 삭제 완료
- [x] main에 합치기 → Vercel 자동 배포 (배포 결과 확인 필요)

## 미적분2 도우미 → my-desk 로 옮김 (2026-11-26)
- 미적분2 탭은 **my-desk(`/calc`)로 옮기고 여기서는 뺐다** (사용자 요청: 전용 사이트에 연결 + 로그인 보안). 아래 기록은 옮기기 전 설명
- 이 저장소는 다시 폴더 잠그기/열기만

## (옮기기 전) 미적분2 도우미 탭 (2026-11-26 추가)
- 세 번째 탭 "미적분2": 수식이나 문제를 넣으면 **어떤 방법으로 접근할지** 알려 줌 (풀이 자체는 안 함)
- **규칙 기반, 브라우저 안에서만 동작** — AI·서버 안 씀. 이유: CSP `connect-src 'self'`로 외부 연결이 막혀 있고(열쇠 보호), AI Gateway는 카드 등록이 필요
- `src/lib/calc2.ts`: `normalize`(LaTeX·기호·한글 표현 통일) → `features`(패턴 찾기) → 주제별 접근법
  - 극한: 삼각/지수/로그 기본 극한, e의 정의, 등비수열, 유리화, 치환, 미정계수, 구분구적법 (+ 로피탈은 교육과정 밖 주의)
  - 급수: 등비급수, 부분분수(망원), 유리화 소거, 부분합·발산 판정
  - 미분: 합성함수, 곱·몫, 음함수, 매개변수, 역함수, 로그 미분법, 정적분으로 정의된 함수, 이계도함수
  - 적분: 치환, 부분적분(로-다-삼-지, eˣsin x 순환), f'/f, 배각 공식, 부분분수, 절댓값, 대칭 구간, 원의 넓이 해석
  - 활용(글로 쓴 문제): 넓이, 부피, 속도·거리, 곡선 길이, 접선, 극값, 변곡점
- `src/components/calc-helper.tsx`: **MathLive 수식 입력창**(`<math-field>`, 치는 대로 교과서처럼 보임), 기호 버튼(빈칸 #? 이 있는 LaTeX 템플릿 삽입), 목적 버튼(넓이·접선 등), 예시 11개, 결과 카드
  - MathLive(약 850KB)는 미적분2 탭에서 `import("mathlive")`로 따로 불러옴 → 잠그기/열기 화면은 느려지지 않음
  - 글꼴은 `mathlive/static.css`로 번들(font-src 'self'), `fontsDirectory = null`, `soundsDirectory = null` → **외부 요청 0개** (CSP 그대로)
  - 결과 공식은 LaTeX(`formula`, 여러 줄은 \n)로 적어 두고 `convertLatexToMarkup`으로 그림 (앱이 적은 공식만 넣으므로 innerHTML 안전)
  - `mathModeSpace = "\,"`: 띄어쓰기를 눌러도 분수 칸 밖으로 튀어 나가지 않게
  - 메뉴(≡) 버튼은 CSS로 숨김(`globals.css`), 휴대폰에서는 수학 가상 키보드가 자동으로 뜸
  - 자동 테스트 주의: 입력창을 클릭한 직후 바로 타자를 치면 글자가 빠짐(MathLive가 포커스를 조금 늦게 옮김) → 클릭 후 300ms 기다리기
- `normalize`는 MathLive가 만드는 LaTeX(중첩 중괄호, `\exponentialE`, `\differentialD`, `\mleft`, `\placeholder`)도 처리
- 테스트 `tests/calc2.test.ts` 12개 → `npm test` 전체 27개 통과
- 새 패턴을 추가할 때: calc2.ts의 해당 주제 함수에 `out.push({ name, why, steps, formula })`를 넣고 테스트에 예시 한 줄 추가
- 한계: 모양으로만 판단하므로 복잡한 식은 틀린 추천이 나올 수 있음 → 발견하면 테스트에 넣고 패턴 수정

## 미적분2: 답과 풀이 과정 (2026-11-26 추가)
- `src/lib/solve.ts`: 계산은 **Compute Engine(CE, `@cortex-js/compute-engine`)**, 풀이 순서는 calc2.ts 가 추천한 접근법대로 단계별 조각을 CE로 계산해서 채움
  - 적분: 치환(t 후보를 차례로 시도, 식이 t 만 남으면 성공 / 정적분은 구간도 t로), 부분적분(로-다-삼-지로 u 선택), 배각, 부분분수(가리기법), 그 밖은 기본 공식 → 정적분은 [F]ₐᵇ
  - 미분: 로그 미분법, 몫, 곱, 연쇄법칙(바깥/안쪽), 음함수(−Fx/Fy), 매개변수(dy/dt ÷ dx/dt)
  - 극한: 기본 극한 변형(sin, 1−cos, eˣ−1, e의 정의), 0/0 약분, ∞ 최고차항, 구분구적법 → 정적분, 그리고 숫자로 다가가 보기 표
  - 급수: 등비(a, r), 망원
  - 검산: 부정적분은 답을 미분해서 원래 함수와 숫자로 비교, 정적분은 CE 직접 계산값과 비교
  - `tex()`: CE LaTeX → 교과서 표기 (e^{..}, sin²x, ln|x|, x²cos x 순서 등)
- `src/lib/solve.worker.ts`: 웹 워커에서 계산 → 화면 안 멈춤, **15초 넘으면 워커 종료**. CE(압축 약 1.5MB)는 처음 풀이할 때만 내려받음
- **주의**: 브라우저 빌드의 CE 는 `lim Σ`(구분구적법) 극한을 바로 evaluate 하면 멈춤 → 정적분으로 값을 구하도록 우회해 둠
- MathLive 는 이제 **미적분2 탭을 처음 열 때** 불러옴 (`CalcHelper active` prop). 이전에는 탭이 숨겨진 채 미리 그려져서 첫 화면에서 받아졌음
- 결과 수식 렌더링은 사용자 식이 섞이므로 `safeMarkup`: `\href` 같은 위험 명령·결과 HTML의 링크/이벤트 속성이 있으면 글자로만 표시
- 넓이·부피 같은 활용 문제는 접근법만 안내 (식 ∫ … dx 로 넣으면 값 계산)
- 테스트 `tests/solve.test.ts` 7개 → 전체 34개 통과. 답은 숫자로 검증

## 미적분2: 활용 문제 자동 풀이 (2026-11-26 추가)
- `src/lib/applied.ts`: 목적 버튼(넓이·부피·속도·거리·곡선의 길이·접선·극값·변곡점)을 고르면 동작
  - 입력: 조건을 쉼표로 이어 씀. `y=…`/`f(x)=…`/`S(x)=…`/`v(t)=…` 는 곡선, `x=1`/`t=0` 은 경계, `x=f(t), y=g(t)` 는 매개변수, `(1, e)` 는 점
  - 방정식: CE `solve` + 숫자 탐색(구간을 1500칸으로 나눠 부호 변화 → 이분법), 숫자 근은 정수·분수·π배수로 맞춰 봄. 구간을 안 주면 −10 ≤ x ≤ 10
  - 적분: CE 로 정확히, 안 되면 심프슨 공식 근삿값(“근삿값” 표시)
  - 넓이: 교점 → 구간마다 위/아래 판단 → ∫(위−아래) 합, |f−g| 수치 적분으로 검산
  - 거리: 위치 변화량 ∫v, v=0 시각에서 나눠 |∫v| 합 / 평면 운동은 ∫√(x'²+y'²)
  - 곡선 길이: (√a)² 를 a 로 직접 정리(CE 가 못 함) 후 적분
  - 접선: x=a 또는 (a, b). 점이 곡선 위가 아니면 주의 문구
  - 극값: f'=0 → 앞뒤 부호 → 극댓값/극솟값 / 변곡점: f''=0 → 부호 바뀜 확인
- 화면: 목적 버튼을 고르면 “입력 예”가 보임 (`PURPOSE_HINTS`), 예시 버튼 7개 추가
- 풀이 단계의 여러 줄 식은 `\n` 으로 나누고 화면에서 줄마다 그림
- 테스트 1개(여러 경우) 추가 → 전체 35개 통과

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
- 학교망에서 Node가 HTTPS 연결 실패(`fetch failed`)하면 `node --use-system-ca` 로 실행 (윈도우 인증서 저장소 사용)
- 이 프로젝트의 Next.js는 학습 데이터와 다를 수 있음 → `node_modules/next/dist/docs/` 참고 (AGENTS.md)
