// 실행: npm test  (Node 내장 테스트 도구 node:test 사용)
import { test } from "node:test"
import assert from "node:assert/strict"
import { ComputeEngine } from "@cortex-js/compute-engine"
import { analyze } from "../src/lib/calc2.ts"
import { solve, tex, type Solution } from "../src/lib/solve.ts"

const ce = new ComputeEngine()

/** 분석 → 풀이 (화면과 같은 흐름) */
function run(latex: string): Solution {
  const a = analyze(latex)
  const r = solve(ce, latex, a.methods.map((m) => m.name), a.topic)
  assert.ok(r.ok, `${latex}: ${!r.ok ? r.reason : ""}`)
  return r.solution
}

/** 답(LaTeX)을 숫자로 바꿔 비교. 부정적분은 + C 를 떼고 x 에 값을 넣어 비교 */
function valueOf(answer: string, x?: number) {
  const e = ce.parse(answer.replace(/\+C$/, "").replace(/^\\frac\{dy\}\{dx\}=/, ""))
  const n = x === undefined ? e.N() : e.subs({ x: ce.number(x), t: ce.number(x) }).N()
  return Number(n.re)
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

test("부정적분: 답이 맞고 검산 통과, 추천 방법대로 풀이", () => {
  const cases: [string, (x: number) => number, string][] = [
    [String.raw`\int x e^{x}\,dx`, (x) => x * Math.exp(x) - Math.exp(x), "u="],
    [String.raw`\int xe^{x^2}\,dx`, (x) => Math.exp(x * x) / 2, "t="],
    [String.raw`\int\frac{2x}{x^2+1}\,dx`, (x) => Math.log(x * x + 1), "t="],
    [String.raw`\int\ln x\,dx`, (x) => x * Math.log(x) - x, "u="],
    [String.raw`\int x^2\sin x\,dx`, (x) => -x * x * Math.cos(x) + 2 * x * Math.sin(x) + 2 * Math.cos(x), "u="],
    [String.raw`\int\frac{\ln x}{x}dx`, (x) => Math.log(x) ** 2 / 2, "t="],
    [String.raw`\int\sin x\cos x\,dx`, (x) => Math.sin(x) ** 2 / 2, "t="],
    [String.raw`\int\frac{1}{\left(x-1\right)\left(x+2\right)}dx`, (x) => (Math.log(Math.abs(x - 1)) - Math.log(Math.abs(x + 2))) / 3, "A="],
  ]
  for (const [latex, F, firstStep] of cases) {
    const s = run(latex)
    assert.match(s.answer, /\+C$/, latex)
    // 적분상수 차이는 허용: 두 점에서의 차이를 비교
    const d1 = valueOf(s.answer, 2.5) - valueOf(s.answer, 1.5)
    const d2 = F(2.5) - F(1.5)
    assert.ok(near(d1, d2), `${latex}: ${s.answer}`)
    assert.ok(s.check, `${latex}: 검산 없음`)
    assert.ok(s.steps.some((st) => st.latex?.includes(firstStep)), `${latex}: ${firstStep} 단계 없음`)
  }
})

test("정적분: 값과 근삿값, 치환 시 구간도 바꿈", () => {
  const a = run(String.raw`\int_0^{\pi}\sin^2x\,dx`)
  assert.ok(near(valueOf(a.answer), Math.PI / 2))
  assert.equal(a.approx, "≈ 1.5708")
  const b = run(String.raw`\int_0^1 xe^{x^2}dx`)
  assert.ok(near(valueOf(b.answer), (Math.E - 1) / 2))
  assert.ok(b.steps.some((s) => s.text.includes("구간도 t")))
  const c = run(String.raw`\int_1^{e}\ln x\,dx`)
  assert.ok(near(valueOf(c.answer), 1))
})

test("미분: 연쇄법칙·곱·몫·로그 미분법·음함수·매개변수", () => {
  assert.ok(near(valueOf(run(String.raw`\frac{d}{dx}\ln\left(x^2+1\right)`).answer, 2), 4 / 5))
  assert.ok(near(valueOf(run(String.raw`\frac{d}{dx}\left(x^2e^{x}\right)`).answer, 1), 3 * Math.E))
  const q = run(String.raw`\frac{d}{dx}\frac{\sin x}{x^2+1}`)
  assert.ok(near(valueOf(q.answer, 1), (Math.cos(1) * 2 - Math.sin(1) * 2) / 4))
  assert.ok(q.steps.some((s) => s.text.includes("몫의 미분")))
  const l = run("y=x^x")
  assert.ok(near(valueOf(l.answer, 2), 4 * (Math.log(2) + 1)))
  assert.ok(l.steps.some((s) => s.latex?.includes("\\ln y")))
  assert.equal(run("x^2+y^2=25").answer, String.raw`\frac{dy}{dx}=-\frac{x}{y}`)
  assert.equal(run(String.raw`x=t^2+1,\;y=t^3`).answer, String.raw`\frac{dy}{dx}=\frac{3t}{2}`)
})

test("극한: 값, 기본 극한 변형, 숫자로 다가가 보기", () => {
  const cases: [string, number][] = [
    [String.raw`\lim_{x\to0}\frac{\sin3x}{x}`, 3],
    [String.raw`\lim_{x\to0}\frac{1-\cos x}{x^2}`, 0.5],
    [String.raw`\lim_{x\to0}\frac{e^{2x}-1}{x}`, 2],
    [String.raw`\lim_{n\to\infty}\left(1+\frac{2}{n}\right)^{n}`, Math.E ** 2],
    [String.raw`\lim_{x\to2}\frac{x^2-4}{x-2}`, 4],
    [String.raw`\lim_{x\to\infty}\frac{2x^2+1}{x^2-3}`, 2],
    [String.raw`\lim_{n\to\infty}\sum_{k=1}^{n}\frac{1}{n}\left(\frac{k}{n}\right)^2`, 1 / 3],
  ]
  for (const [latex, v] of cases) {
    const s = run(latex)
    assert.ok(near(valueOf(s.answer), v), `${latex}: ${s.answer}`)
    assert.ok(s.steps.length >= 2, `${latex}: 풀이가 너무 짧음`)
  }
  assert.ok(run(String.raw`\lim_{x\to0}\frac{\sin3x}{x}`).steps.some((s) => s.latex?.includes("3\\cdot\\frac{\\sin 3x}{3x}")))
  assert.ok(run(String.raw`\lim_{n\to\infty}\left(1+\frac{2}{n}\right)^{n}`).steps.some((s) => s.latex?.includes("n=1000")))
})

test("급수: 등비급수의 a, r", () => {
  const s = run(String.raw`\sum_{n=1}^{\infty}\left(\frac{1}{3}\right)^{n}`)
  assert.ok(near(valueOf(s.answer), 0.5))
  assert.ok(s.steps[0].latex?.includes("r=\\frac{1}{3}"))
  assert.ok(near(valueOf(run(String.raw`\sum_{n=1}^{\infty}\frac{1}{n\left(n+1\right)}`).answer), 1))
})

test("계산 못 하는 식·빈칸이 있는 식은 이유를 알려 줌", () => {
  const r1 = solve(ce, String.raw`\int e^{x^3}dx`, [], "적분")
  assert.equal(r1.ok, false)
  const r2 = solve(ce, String.raw`\int_{\placeholder{}}^{1}x\,dx`, [], "적분")
  assert.equal(r2.ok, false)
  const r3 = solve(ce, "", [], "알 수 없음")
  assert.equal(r3.ok, false)
})

test("교과서 표기로 다듬기", () => {
  assert.equal(tex(String.raw`\exp(x^2)`), "e^{x^2}")
  assert.equal(tex(String.raw`\ln(\vert x^2+1\vert)`), String.raw`\ln|x^2+1|`)
  assert.equal(tex(String.raw`\sin(x)^2`), String.raw`\sin^2 x`)
  assert.equal(tex(String.raw`-(\cos(x)x^2)`), String.raw`-x^2\cos x`)
  assert.equal(tex(String.raw`\sin(x)\exponentialE^{x}`), String.raw`e^{x}\sin x`)
})

test("활용 문제: 넓이·부피·거리·길이·접선·극값·변곡점", async () => {
  const { analyzeWith } = await import("../src/lib/calc2.ts")
  const go = (latex: string, purpose: Parameters<typeof analyzeWith>[1]) => {
    const a = analyzeWith(latex, purpose)
    const r = solve(ce, latex, a.methods.map((m) => m.name), a.topic)
    assert.ok(r.ok, `${latex}: ${!r.ok ? r.reason : ""}`)
    return r.solution
  }
  const area = (l: string) => valueOf(go(l, ["넓이"]).answer)
  assert.ok(near(area(String.raw`y=x^2,\;y=x`), 1 / 6))
  assert.ok(near(area(String.raw`y=e^{x},\;x=0,\;x=1`), Math.E - 1))
  assert.ok(near(area(String.raw`y=x^2-1`), 4 / 3))
  assert.ok(near(area(String.raw`y=x^3-x`), 1 / 2)) // 위아래가 바뀌는 구간을 나눠서 더함
  assert.ok(near(area(String.raw`y=\sin x,\;x=0,\;x=2\pi`), 4))
  assert.ok(go(String.raw`y=x^2,\;y=x`, ["넓이"]).check, "넓이 검산")

  assert.ok(near(valueOf(go(String.raw`S(x)=x^2,\;x=0,\;x=3`, ["부피"]).answer), 9))

  const d = go(String.raw`v(t)=t^2-4t,\;t=0,\;t=5`, ["속도·거리"])
  assert.ok(near(valueOf(d.answer), 13))
  assert.ok(d.steps.some((s) => s.latex?.includes("t=4")), "방향이 바뀌는 시각")
  assert.ok(near(valueOf(go(String.raw`x=\cos t,\;y=\sin t,\;t=0,\;t=\pi`, ["속도·거리"]).answer), Math.PI))

  assert.equal(go(String.raw`y=\frac{2}{3}x^{\frac{3}{2}},\;x=0,\;x=3`, ["곡선의 길이"]).answer, String.raw`\frac{14}{3}`)

  assert.equal(go(String.raw`y=e^{x},\;x=0`, ["접선"]).answer, "y=x+1")
  assert.ok(go(String.raw`y=e^{x},\;(1,e)`, ["접선"]).check?.text.includes("곡선 위"))

  const ex = go(String.raw`y=x^3-3x`, ["극값"]).answer
  assert.ok(ex.includes("극댓값 }f(-1)=2") && ex.includes("극솟값 }f(1)=-2"), ex)
  assert.equal(go(String.raw`y=x^3-3x^2`, ["변곡점"]).answer, String.raw`\left(1,\ -2\right)`)
  // 조건이 모자라면 무엇을 더 넣어야 하는지 알려 줌
  const a = analyzeWith(String.raw`S(x)=x^2`, ["부피"])
  const r = solve(ce, String.raw`S(x)=x^2`, a.methods.map((m) => m.name), a.topic)
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.reason.includes("x=a"))
})
