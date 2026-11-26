// 실행: npm test  (Node 내장 테스트 도구 node:test 사용)
import { test } from "node:test"
import assert from "node:assert/strict"
import { EXAMPLES, analyze, analyzeWith, normalize } from "../src/lib/calc2.ts"

/** 접근법 이름 목록 */
const names = (input: string) => analyze(input).methods.map((m) => m.name)
const first = (input: string) => names(input)[0] ?? ""
const includes = (input: string, part: string) => names(input).some((n) => n.includes(part))

test("LaTeX 와 특수 기호를 한 가지 표기로 정리", () => {
  assert.equal(normalize("\\int_{0}^{1} x e^{x} \\, dx"), "∫_0^1 x e^x dx")
  assert.equal(normalize("\\lim_{x \\to 0} \\frac{\\sin 3x}{x}"), "lim_(x → 0) ((sin 3x)/x)")
  assert.equal(normalize("x² − 1 ÷ x"), "x^2 - 1 / x")
  assert.equal(normalize("lim n->inf"), "lim n→∞")
})

test("극한: 주제와 접근법", () => {
  assert.equal(analyze("lim x→0 sin(3x)/x").topic, "극한")
  assert.equal(first("lim x→0 sin(3x)/x"), "삼각함수 기본 극한")
  assert.ok(includes("lim x->0 (1 - cos x)/x^2", "켤레식"))
  assert.ok(includes("lim x→0 (e^(2x) - 1)/x", "지수함수 기본 극한"))
  assert.ok(includes("lim x→0 ln(1+3x)/x", "로그함수 기본 극한"))
  assert.ok(includes("lim n→∞ (1 + 2/n)^n", "e 의 정의"))
  assert.ok(includes("lim n→∞ (3^n + 2^n)/(3^(n+1) - 1)", "등비수열"))
  assert.ok(includes("lim x→π/2 cos x/(x - π/2)", "치환"))
  assert.ok(includes("lim x→∞ (√(x^2+x) - x)", "유리화"))
  assert.ok(includes("lim x→1 (x^2 + ax + b)/(x - 1) = 3", "미정계수"))
  // 로피탈 주의는 항상
  assert.ok(analyze("lim x→0 sin x / x").cautions.some((c) => c.includes("로피탈")))
})

test("LaTeX 로 쓴 극한도 인식", () => {
  assert.equal(first("\\lim_{x \\to 0} \\frac{\\sin 3x}{x}"), "삼각함수 기본 극한")
})

test("구분구적법과 급수", () => {
  assert.equal(first("lim n→∞ Σ (1/n)(k/n)^2"), "구분구적법 → 정적분으로 바꾸기")
  assert.equal(analyze("Σ (1/3)^n").topic, "급수")
  assert.equal(first("Σ (1/3)^n"), "등비급수")
  assert.ok(includes("Σ 1/(n(n+1))", "부분분수"))
  assert.ok(includes("Σ 1/((2n-1)(2n+1))", "부분분수"))
})

test("미분: 주제와 접근법", () => {
  assert.equal(analyze("d/dx ln(x^2+1)").topic, "미분")
  assert.ok(includes("d/dx ln(x^2+1)", "합성함수"))
  assert.ok(includes("d/dx sin(3x)", "합성함수"))
  assert.equal(first("x^2 + y^2 = 25 일 때 dy/dx"), "음함수의 미분")
  // dy/dx 자체를 분수로 보면 안 됨
  assert.ok(!includes("x^2 + y^2 = 25 일 때 dy/dx", "몫의 미분"))
  assert.ok(!includes("x = t^2 + 1, y = t^3 일 때 dy/dx", "몫의 미분"))
  assert.equal(first("x = t^2 + 1, y = t^3 일 때 dy/dx"), "매개변수로 나타낸 함수의 미분")
  assert.ok(includes("y = x^x 미분", "로그 미분법"))
  assert.ok(includes("d/dx (x^2 e^x)", "곱의 미분"))
  assert.ok(includes("d/dx (sin x)/(x^2+1)", "몫의 미분"))
  assert.ok(includes("f의 역함수 g 에 대해 g'(2)", "역함수"))
  assert.ok(includes("d/dx ∫_1^x (t^2 + 1) dt", "정적분으로 정의된 함수의 미분"))
  assert.ok(includes("y = e^x 위의 점 (0,1) 에서의 접선", "접선"))
})

test("적분: 주제와 접근법", () => {
  assert.equal(analyze("∫ x e^x dx").topic, "적분")
  assert.equal(first("∫ x e^x dx"), "부분적분")
  assert.equal(first("∫ ln x dx"), "부분적분")
  assert.equal(first("∫ x^2 sin x dx"), "부분적분")
  assert.ok(includes("∫ e^x sin x dx", "부분적분"))
  assert.equal(first("∫ x e^(x^2) dx"), "치환적분")
  assert.equal(first("∫ (ln x)/x dx"), "치환적분")
  assert.equal(first("∫ sin x cos x dx"), "치환적분")
  assert.equal(first("∫ 2x/(x^2+1) dx"), "f'(x)/f(x) 꼴 → ln|f(x)|")
  assert.ok(includes("∫ tan x dx", "f'(x)/f(x)"))
  assert.ok(includes("∫_0^π sin^2 x dx", "배각"))
  assert.ok(includes("∫ 1/((x-1)(x+2)) dx", "부분분수"))
  assert.ok(includes("∫_(-1)^(1) (x^3 + x^2) dx", "대칭 구간"))
  assert.ok(includes("∫_0^2 |x - 1| dx", "절댓값"))
  assert.ok(includes("∫_0^2 √(4 - x^2) dx", "원의 넓이"))
  // 부정적분은 + C 안내
  assert.ok(analyze("∫ x e^x dx").cautions.some((c) => c.includes("+ C")))
})

test("LaTeX 로 쓴 적분도 인식", () => {
  assert.equal(first("\\int x e^{x} \\, dx"), "부분적분")
  assert.equal(first("\\int x e^{x^2} dx"), "치환적분")
})

test("정적분의 활용 (글로 쓴 문제)", () => {
  const a = analyze("곡선 y = e^x 와 x축, x = 0, x = 1 로 둘러싸인 넓이")
  assert.equal(a.topic, "정적분의 활용")
  assert.ok(a.methods.some((m) => m.name.includes("넓이")))
  assert.ok(includes("시각 t 에서의 속도가 v(t) = t^2 - 4t 일 때 움직인 거리", "속도"))
  assert.ok(includes("곡선 y = x^(3/2) 의 길이", "곡선의 길이"))
})

test("예시는 모두 접근법이 하나 이상 나옴", () => {
  const expected: Record<string, string> = {
    "삼각함수 극한": "삼각함수 기본 극한",
    부분적분: "부분적분",
    치환적분: "치환적분",
    "f'/f 꼴": "f'(x)/f(x)",
    "합성함수 미분": "합성함수",
    음함수: "음함수",
    매개변수: "매개변수",
    구분구적법: "구분구적법",
    "반각 공식": "배각",
    등비급수: "등비급수",
    넓이: "넓이",
    "두 곡선 사이 넓이": "넓이",
    부피: "부피",
    "움직인 거리": "속도",
    "곡선의 길이": "곡선의 길이",
    접선: "접선",
    극값: "극값",
    변곡점: "변곡점",
  }
  for (const ex of EXAMPLES) {
    const a = analyzeWith(ex.latex, ex.purposes)
    assert.notEqual(a.topic, "알 수 없음", ex.label)
    assert.ok(a.methods.some((m) => m.name.includes(expected[ex.label])), `${ex.label}: ${a.methods.map((m) => m.name)}`)
  }
})

test("수식 입력창(MathLive)이 만드는 LaTeX 도 인식", () => {
  // 중첩 중괄호, \exponentialE, \differentialD, \mleft \mright
  assert.equal(first("\\int x\\exponentialE^{x^2}\\,\\differentialD x"), "치환적분")
  assert.equal(first("\\int\\frac{\\ln x}{x}\\,\\mathrm{d}x"), "치환적분")
  assert.equal(first("\\lim_{x\\to0}\\frac{e^{2x}-1}{x}"), "지수함수 기본 극한")
  assert.equal(first("\\lim_{x\\to0}\\frac{\\sin\\mleft(3x\\mright)}{x}"), "삼각함수 기본 극한")
  assert.ok(includes("\\frac{d}{dx}\\sin\\left(x^2\\right)", "합성함수"))
  assert.ok(includes("\\frac{d}{dx}\\left(x^2e^{x}\\right)", "곱의 미분"))
  assert.ok(includes("\\int_{-1}^{1}\\left(x^3+x^2\\right)dx", "대칭 구간"))
  assert.ok(includes("\\sum_{n=1}^{\\infty}\\frac{1}{n\\left(n+1\\right)}", "부분분수"))
  assert.ok(includes("\\int\\frac{1}{\\left(x-1\\right)\\left(x+2\\right)}dx", "부분분수"))
  assert.ok(includes("\\int_0^2\\sqrt{4-x^2}dx", "원의 넓이"))
  // dy/dx 를 분수로 오해하지 않음
  assert.ok(!includes("x^2+y^2=25,\\ \\frac{dy}{dx}", "몫의 미분"))
})

test("목적 버튼과 함께 분석", () => {
  assert.equal(analyzeWith(String.raw`y=x^2,\;y=x`, ["넓이"]).topic, "정적분의 활용")
  assert.ok(analyzeWith(String.raw`y=e^{x}`, ["접선"]).methods.some((m) => m.name.includes("접선")))
  assert.ok(analyzeWith(String.raw`v(t)=t^2-4t`, ["속도·거리"]).methods.some((m) => m.name.includes("속도")))
})

test("빈 입력·관계없는 입력", () => {
  assert.equal(analyze("").topic, "알 수 없음")
  assert.equal(analyze("   ").methods.length, 0)
  assert.equal(analyze("안녕하세요").topic, "알 수 없음")
})
