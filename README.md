# Pile Security

폴더를 암호화해 잠그고, 복호키 파일(`.key`)이 있어야만 열 수 있게 하는 웹사이트입니다.
모든 암호화는 **브라우저 안에서만** 이루어지고, 파일은 서버로 보내지 않습니다.

## 쓰는 법

| 탭 | 하는 일 |
|---|---|
| 잠그기 | 폴더 선택 → 잠긴 파일(`.vault`)과 열쇠 파일(`.key`)을 내려받음. 원본 폴더는 직접 지워야 함 |
| 열기 | `.vault` + `.key` 선택 → 원래 폴더를 `.zip`으로 복원해 내려받음 |

- 열쇠 파일은 USB 등에 따로 보관하세요. **열쇠를 잃어버리면 다시 열 방법이 없습니다.**
- 한 번에 잠글 수 있는 크기는 최대 2GB입니다.

## 보안 설계 (요약)

- AES-256-GCM, 1MB 조각마다 새 IV, 파일 이름·경로까지 암호화
- 조각 순서 바꾸기·잘라내기·덧붙이기 감지, 복원 시 경로 탈출(`..`) 차단
- CSP `connect-src 'self'`로 열쇠를 외부로 보낼 수 없음
- 자세한 형식은 [HANDOFF.md](HANDOFF.md)와 `src/lib/vault.ts` 참고

## 기술

Next.js 16 · Tailwind CSS 4 · shadcn/ui · Web Crypto · fflate → Vercel 프로젝트 `pile-security` (`main`에 푸시하면 자동 배포)

## 로컬 실행

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 암호화 테스트 (node:test)
npm run lint
npm run build
```

## 폴더 구조

| 경로 | 내용 |
|---|---|
| `src/lib/vault.ts` | 암호화·복호화 핵심 |
| `src/components/vault-app.tsx` | 잠그기/열기 화면 |
| `tests/vault.test.ts` | 암호화 테스트 |
| `HANDOFF.md` | 진행 상황과 설계 기록 |

> 예전에 있던 미적분2 탭은 2026-11-26에 [my-desk](https://github.com/jihwan8784/my-desk)(`/calc`)로 옮겼습니다.
