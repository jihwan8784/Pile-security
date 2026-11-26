/**
 * 미적분2 풀이: 답과 중간 풀이 과정을 만든다.
 *
 * - 실제 계산(미분·적분·극한·급수의 값)은 Compute Engine(CE)이 한다.
 * - 풀이 과정은 calc2.ts 가 추천한 접근법(부분적분, 치환적분 …)의 순서대로,
 *   각 단계에 필요한 조각(u, du, v, 바뀐 식 …)을 CE로 계산해서 채운다.
 * - 마지막에 답을 다시 미분하거나 숫자를 넣어 보는 방식으로 검산한다.
 * - 이 파일은 웹 워커(solve.worker.ts) 안에서 돌아서, 계산이 오래 걸려도 화면이 멈추지 않는다.
 */
import type { ComputeEngine, Expression as CEExpression } from "@cortex-js/compute-engine"
import { solveApplied } from "./applied.ts"

/**
 * CE 의 기본 Expression 타입에는 ops·symbol 이 없고 하위 타입(함수식·기호)에만 있다.
 * 실제 객체에는 항상 있으므로(테스트로 확인), 여기서는 선택 속성으로 붙여 쓴다.
 */
export type Expression = CEExpression & {
  readonly ops?: Expression[]
  readonly symbol?: string
  readonly isNumberLiteral?: boolean
}

type Json = unknown

export type Step = {
  /** 이 단계에서 하는 일 */
  text: string
  /** 이 단계의 식 (LaTeX) */
  latex?: string
}

export type Solution = {
  /** 무엇을 구했는지 (예: 부정적분, 정적분의 값) */
  title: string
  /** 최종 답 (LaTeX) */
  answer: string
  /** 소수 근삿값 (있으면) */
  approx?: string
  steps: Step[]
  /** 검산 결과 */
  check?: Step
}

export type SolveResult = { ok: true; solution: Solution } | { ok: false; reason: string }

export const CANNOT = "이 식은 자동으로 계산하지 못했습니다. 위의 접근법을 참고해 직접 풀어 보세요."

// ───────────────────────── 공통 도구 ─────────────────────────

/** CE 의 LaTeX 를 교과서 표기로 다듬는다: \exp(x^2) → e^{x^2}, \ln(\vert x\vert) → \ln|x|, \sin(x) → \sin x */
export function tex(e: Expression | string): string {
  let s = typeof e === "string" ? e : e.latex
  // \exp( … ) → e^{ … }  (괄호 짝 맞추기)
  for (let guard = 0; guard < 20; guard++) {
    const i = s.indexOf("\\exp(")
    if (i < 0) break
    let depth = 0
    let j = i + 4
    for (; j < s.length; j++) {
      if (s[j] === "(") depth++
      else if (s[j] === ")" && --depth === 0) break
    }
    s = s.slice(0, i) + "e^{" + s.slice(i + 5, j) + "}" + s.slice(j + 1)
  }
  s = s
    .replace(/\\exponentialE/g, "e")
    .replace(/\\differentialD/g, "d")
    .replace(/\\mathrm\{d\}/g, "d")
    .replace(/\(\\vert\s*/g, "|")
    .replace(/\s*\\vert\)/g, "|")
    .replace(/\\vert/g, "|")
    // sin(x)^2 → sin^2 x,  ln(x)^2 → (ln x)^2
    .replace(/\\(sin|cos|tan|sec|csc|cot)\(([a-z]|\d+[a-z]?)\)\^(\{[^{}]*\}|\d)/g, "\\$1^$3 $2")
    .replace(/\\ln\(([a-z]|\d+[a-z]?)\)\^(\{[^{}]*\}|\d)/g, "(\\ln $1)^$2")
    // sin(x) → sin x  (뒤에 다른 식이 바로 붙으면 헷갈리므로 괄호를 둔다)
    .replace(/\\(sin|cos|tan|ln|sec|csc|cot)\(([a-z]|\d+[a-z]?)\)(?=$|[+\-=)}\]|,\s]|\\right|\\quad|\\,|\\cdot)/g, "\\$1 $2")
    .replace(/\\!/g, "")
  // 교과서 순서: sin(x)x^2 → x^2 sin x,  sin(x)e^{x} → e^{x} sin x
  s = s
    .replace(/\\(sin|cos|tan|ln)\(([a-z])\)([a-z]\^\{[^{}]*\})/g, "$3\\$1 $2")
    .replace(/\\(sin|cos|tan)\(([a-z])\)((?:\d*[a-df-z](?:\^\{?\d+\}?)?)+)(?![a-z(^])/g, "$3\\$1 $2")
    .replace(/\\(sin|cos|tan|ln)\(([a-z])\)(?=\\(sin|cos|tan|ln))/g, "\\$1 $2\\,")
    .replace(/\\sqrt\{([^{}]*)\}\^\{(\d+)\}/g, "\\left(\\sqrt{$1}\\right)^{$2}")
    .replace(/(^|[=+(\s])-\(([^()+\-]*)\)/g, "$1-$2") // -(x^2cos x) → -x^2cos x
    .replace(/\\frac\{-([^{}]*)\}\{/g, "-\\frac{$1}{") // \frac{-x}{y} → -\frac{x}{y}
    .replace(/([a-z0-9])\\times\(/g, "$1(") // n\times(n+1) → n(n+1)
  return s
}

/** 적분 기호 안에 넣을 식: 덧셈·뺄셈이면 괄호로 묶는다 */
export function integrand(e: Expression) {
  return e.operator === "Add" || e.operator === "Subtract" ? `\\left(${tex(e)}\\right)` : tex(e)
}

/** 계산이 끝나지 않고 그대로 남았는지 (예: ∫ 가 안 풀림) */
export function unsolved(e: Expression | null | undefined, ops: string[]) {
  if (!e) return true
  const json = JSON.stringify(e.json)
  return ops.some((op) => json.includes(`"${op}"`)) || /NaN|Nothing|Undefined|ComplexInfinity|Indeterminate/.test(json)
}

/** 0.1 보다 작은 오차로 두 식이 같은지, 숫자 몇 개를 넣어 확인 (기호 간단히 하기가 실패해도 검산 가능) */
function numericallyEqual(ce: ComputeEngine, a: Expression, b: Expression, v: string, points = [0.37, 0.81, 1.43, 2.17]) {
  let tried = 0
  for (const p of points) {
    const x = Number(a.subs({ [v]: ce.number(p) }).N().re)
    const y = Number(b.subs({ [v]: ce.number(p) }).N().re)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    tried++
    if (Math.abs(x - y) > 1e-6 * Math.max(1, Math.abs(x))) return false
  }
  return tried >= 2
}

/** 숫자 근삿값 문자열 (정수·간단한 값이면 생략) */
export function approxOf(e: Expression): string | undefined {
  const n = Number(e.N().re)
  if (!Number.isFinite(n)) return undefined
  if (Number.isInteger(n) && e.isNumberLiteral) return undefined
  const r = Math.round(n * 1e4) / 1e4
  if (String(r) === tex(e)) return undefined
  return `≈ ${r}`
}

export class Calc {
  readonly ce: ComputeEngine
  constructor(ce: ComputeEngine) {
    this.ce = ce
  }
  box(json: Json): Expression {
    return this.ce.box(json as never)
  }
  simp(e: Expression) {
    return e.simplify()
  }
  D(f: Expression, v: string) {
    return this.box(["D", f.json, v]).evaluate().simplify()
  }
  /** 부정적분 (안 풀리면 null) */
  integ(f: Expression, v: string) {
    const r = this.box(["Integrate", ["Function", ["Block", f.json], v], ["Limits", v, "Nothing", "Nothing"]]).evaluate()
    return unsolved(r, ["Integrate"]) ? null : r.simplify()
  }
  mul(...es: Expression[]) {
    return this.box(["Multiply", ...es.map((e) => e.json)]).simplify()
  }
  div(a: Expression, b: Expression) {
    return this.box(["Divide", a.json, b.json]).simplify()
  }
  sub(a: Expression, b: Expression) {
    return this.box(["Subtract", a.json, b.json]).simplify()
  }
  at(e: Expression, v: string, value: Expression) {
    return e.subs({ [v]: value }).evaluate().simplify()
  }
}

/** 식의 종류: ln → 0, 다항식 → 1, 삼각 → 2, 지수 → 3 (부분적분의 '로-다-삼-지' 순서) */
function liateRank(e: Expression, v: string): number {
  const j = JSON.stringify(e.json)
  if (/"Ln"|"Log"/.test(j)) return 0
  if (/"(Sin|Cos|Tan|Sec|Csc|Cot)"/.test(j)) return 2
  if (/"ExponentialE"|"Exp"/.test(j) || (e.operator === "Power" && !e.ops?.[0]?.has(v))) return 3
  return 1
}

// ───────────────────────── 적분 ─────────────────────────

function solveIntegral(c: Calc, body: Expression, v: string, lo: Expression | null, hi: Expression | null, methods: string[]): SolveResult {
  const { ce } = c
  const definite = !!lo && !!hi
  const steps: Step[] = []
  const integral = `\\int ${definite ? `_{${tex(lo!)}}^{${tex(hi!)}}` : ""} ${integrand(body)}\\,d${v}`
  let F: Expression | null = null
  const has = (name: string) => methods.some((m) => m.includes(name))

  // 1) 치환적분 (정적분이면 구간도 바꿔서 끝까지 t 로 계산)
  if (!F && (has("치환적분") || has("f'(x)/f(x)"))) {
    const r = trySubstitution(c, body, v, steps, lo, hi)
    if (r?.definiteValue) return finishDefinite(c, integral, r.definiteValue, steps, body, v, r.F)
    if (r) F = r.F
  }
  // 2) 부분적분
  if (!F && has("부분적분")) F = tryByParts(c, body, v, steps)
  // 3) 배각 공식
  if (!F && has("배각")) F = tryDoubleAngle(c, body, v, steps)
  // 4) 부분분수
  if (!F && has("부분분수")) F = tryPartialFractions(c, body, v, steps)
  // 5) 그 밖: 기본 공식
  if (!F) {
    steps.length = 0
    F = c.integ(body, v)
    if (!F) return { ok: false, reason: CANNOT }
    steps.push({ text: "기본 적분 공식을 항별로 적용합니다.", latex: `\\int ${integrand(body)}\\,d${v}=${tex(F)}+C` })
  }

  // 검산: F' = f
  const ok = numericallyEqual(ce, c.D(F, v), body, v)
  const check: Step | undefined = ok
    ? { text: "검산: 구한 식을 미분하면 원래 함수가 나옵니다. ✓", latex: `\\left(${tex(F)}\\right)'=${tex(body)}` }
    : undefined

  if (!definite) {
    return { ok: true, solution: { title: "부정적분", answer: `${tex(F)}+C`, steps, check } }
  }

  // 정적분: [F]_a^b
  const Fb = c.at(F, v, hi!)
  const Fa = c.at(F, v, lo!)
  const value = c.sub(Fb, Fa)
  steps.push({
    text: "위끝과 아래끝을 대입해서 뺍니다.",
    latex: `\\left[${tex(F)}\\right]_{${tex(lo!)}}^{${tex(hi!)}}=\\left(${tex(Fb)}\\right)-\\left(${tex(Fa)}\\right)=${tex(value)}`,
  })
  return finishDefinite(c, integral, value, steps, body, v, F, check)
}

function finishDefinite(
  c: Calc,
  integral: string,
  value: Expression,
  steps: Step[],
  _body: Expression,
  _v: string,
  _F: Expression | null,
  check?: Step,
): SolveResult {
  // CE 가 바로 계산한 정적분 값과도 맞춰 본다
  const direct = c.ce.parse(integral).evaluate()
  const same = Math.abs(Number(direct.N().re) - Number(value.N().re)) < 1e-6
  return {
    ok: true,
    solution: {
      title: "정적분의 값",
      answer: tex(value),
      approx: approxOf(value),
      steps,
      check: same ? (check ?? { text: "검산: 다른 방법으로 계산한 값과 같습니다. ✓" }) : check,
    },
  }
}

/** 치환적분: t = g(x) 후보를 차례로 시도해서, 식이 t 만으로 바뀌면 성공 */
function trySubstitution(c: Calc, body: Expression, v: string, steps: Step[], lo: Expression | null, hi: Expression | null) {
  const { ce } = c
  const t = ce.symbol("t")

  for (const g of substitutionCandidates(body, v)) {
    const gp = c.D(g, v)
    if (gp.is(0)) continue
    // simplify 를 쓰면 sin x cos x → ½ sin 2x 처럼 모양이 바뀌어 치환이 안 되므로 evaluate 만 한다
    const q = c.box(["Divide", body.json, gp.json]).evaluate()
    const h = q.replace({ match: g, replace: t }, { recursive: true })?.simplify() ?? null
    if (!h || h.has(v)) continue
    const H = c.integ(h, "t")
    if (!H) continue
    const F = H.subs({ t: g }).simplify()

    steps.length = 0
    steps.push({ text: "안쪽 식을 t 로 놓습니다.", latex: `t=${tex(g)}` })
    steps.push({ text: "양변을 미분해서 dx 를 dt 로 바꿉니다.", latex: `dt=${tex(gp)}\\,d${v}` })
    if (lo && hi) {
      const ta = c.at(g, v, lo)
      const tb = c.at(g, v, hi)
      steps.push({ text: "적분 구간도 t 값으로 바꿉니다.", latex: `${v}=${tex(lo)}\\Rightarrow t=${tex(ta)},\\quad ${v}=${tex(hi)}\\Rightarrow t=${tex(tb)}` })
      steps.push({ text: "식을 t 에 대한 적분으로 바꿉니다.", latex: `\\int_{${tex(ta)}}^{${tex(tb)}} ${tex(h)}\\,dt` })
      const Hb = c.at(H, "t", tb)
      const Ha = c.at(H, "t", ta)
      const value = c.sub(Hb, Ha)
      steps.push({
        text: "t 로 적분한 뒤 구간을 대입합니다.",
        latex: `\\left[${tex(H)}\\right]_{${tex(ta)}}^{${tex(tb)}}=${tex(value)}`,
      })
      return { F, definiteValue: value }
    }
    steps.push({ text: "식을 t 에 대한 적분으로 바꿉니다.", latex: `\\int ${integrand(body)}\\,d${v}=\\int ${integrand(h)}\\,dt` })
    steps.push({ text: "t 에 대해 적분합니다.", latex: `=${tex(H)}+C` })
    steps.push({ text: "t 를 원래 식으로 되돌립니다.", latex: `=${tex(F)}+C\\quad\\left(t=${tex(g)}\\right)` })
    return { F, definiteValue: null }
  }
  return null
}

/** 치환할 후보: e^(g), √(g), sin(g), ln(g), (g)^n 의 안쪽 g, 그리고 sin x·ln x·e^x 같은 덩어리 */
function substitutionCandidates(body: Expression, v: string): Expression[] {
  const inner: Expression[] = []
  const atoms: Expression[] = []
  const visit = (e: Expression) => {
    const op = e.operator
    const ops = e.ops ?? []
    if (["Sin", "Cos", "Tan", "Ln", "Log", "Sqrt", "Exp"].includes(op) && ops[0]) {
      if (ops[0].symbol === v) atoms.push(e)
      else if (ops[0].has(v)) inner.push(ops[0])
    }
    if (op === "Power" && ops.length === 2) {
      const [base, exp] = ops
      if (base.symbol === "ExponentialE" && exp.has(v)) {
        if (exp.symbol === v) atoms.push(e)
        else inner.push(exp)
      }
      else if (base.has(v) && !exp.has(v) && base.operator !== undefined && base.symbol !== v) {
        inner.push(base)
        if (["Sin", "Cos", "Ln"].includes(base.operator)) atoms.push(base)
      }
    }
    ops.forEach(visit)
  }
  visit(body)
  // 분모 전체 (f'/f 꼴)
  if (body.operator === "Divide" && body.ops?.[1]?.has(v)) inner.push(body.ops[1])
  const seen = new Set<string>()
  return [...inner, ...atoms].filter((e) => {
    const k = JSON.stringify(e.json)
    // t = x 처럼 변수 자체로 치환하는 것은 의미가 없음
    return e.symbol !== v && !seen.has(k) && seen.add(k)
  })
}

/** 부분적분: 로-다-삼-지 순서로 u 를 고른다 */
function tryByParts(c: Calc, body: Expression, v: string, steps: Step[]): Expression | null {
  const factors = body.operator === "Multiply" ? [...(body.ops ?? [])] : [body]
  const withV = factors.filter((f) => f.has(v))
  const consts = factors.filter((f) => !f.has(v))
  if (withV.length === 0) return null

  let u: Expression
  let dv: Expression
  if (withV.length === 1) {
    // ∫ ln x dx 처럼 하나뿐이면 u = 그 함수, dv = 1
    u = withV[0]
    dv = consts.length ? c.mul(...consts) : c.ce.number(1)
  } else {
    const sorted = [...withV].sort((a, b) => liateRank(a, v) - liateRank(b, v))
    u = sorted[0]
    dv = c.mul(...sorted.slice(1), ...consts)
  }
  const du = c.D(u, v)
  const V = c.integ(dv, v)
  if (!V) return null
  const rest = c.mul(V, du)
  const restInt = c.integ(rest, v)
  if (!restInt) return null
  const F = c.sub(c.mul(u, V), restInt)

  steps.length = 0
  steps.push({ text: "미분할 쪽 u 와 적분할 쪽 dv 를 '로-다-삼-지' 순서로 정합니다.", latex: `u=${tex(u)},\\quad dv=${dv.is(1) ? "" : `${tex(dv)}\\,`}d${v}` })
  steps.push({ text: "u 는 미분하고, dv 는 적분합니다.", latex: `du=${du.is(1) ? "" : `${tex(du)}\\,`}d${v},\\quad v=${tex(V)}` })
  steps.push({
    text: "부분적분 공식 ∫u dv = uv − ∫v du 에 넣습니다.",
    latex: `\\int ${integrand(body)}\\,d${v}=${tex(c.mul(u, V))}-\\int ${integrand(rest)}\\,d${v}`,
  })
  const again = liateRank(rest, v) !== 1 && rest.has(v) && JSON.stringify(rest.json).match(/"(Sin|Cos)"/) && JSON.stringify(rest.json).includes("ExponentialE")
  steps.push({
    text: again
      ? "남은 적분도 부분적분하면 처음 적분이 다시 나옵니다. 이것을 이항해서 정리합니다."
      : rest.operator === "Multiply" && withV.length > 1
        ? "남은 적분을 계산합니다. (필요하면 부분적분을 한 번 더)"
        : "남은 적분을 계산합니다.",
    latex: `\\int ${integrand(rest)}\\,d${v}=${tex(restInt)}`,
  })
  steps.push({ text: "정리합니다.", latex: `=${tex(F)}+C` })
  return F
}

/** sin²x, cos²x → 배각 공식 */
function tryDoubleAngle(c: Calc, body: Expression, v: string, steps: Step[]): Expression | null {
  const { ce } = c
  const rewritten = body.replace(
    [
      { match: ce.parse(`\\sin^2(${v})`), replace: ce.parse(`\\frac{1-\\cos(2${v})}{2}`) },
      { match: ce.parse(`\\cos^2(${v})`), replace: ce.parse(`\\frac{1+\\cos(2${v})}{2}`) },
    ],
    { recursive: true },
  )
  if (!rewritten) return null
  const F = c.integ(rewritten, v)
  if (!F) return null
  steps.length = 0
  steps.push({ text: "배각 공식으로 차수를 낮춥니다.", latex: `${tex(body)}=${tex(rewritten)}` })
  steps.push({ text: "항별로 적분합니다. (∫cos 2x dx = ½ sin 2x)", latex: `\\int ${integrand(rewritten)}\\,d${v}=${tex(F)}+C` })
  return F
}

/** 분모가 서로 다른 일차식 두 개의 곱인 유리함수 → 부분분수 */
function tryPartialFractions(c: Calc, body: Expression, v: string, steps: Step[]): Expression | null {
  const { ce } = c
  if (body.operator !== "Divide" || !body.ops) return null
  const [num, den0] = body.ops
  const den: Expression = den0.operator === "Multiply" ? den0 : c.box(["Factor", den0.json]).evaluate()
  if (den.operator !== "Multiply" || den.ops?.length !== 2) return null
  const [p, q] = den.ops
  const root = (f: Expression) => {
    const a = c.D(f, v)
    if (a.has(v) || a.is(0)) return null
    return c.div(c.sub(ce.number(0), c.at(f, v, ce.number(0))), a) // ax + b = 0 → x = −b/a
  }
  const rp = root(p)
  const rq = root(q)
  if (!rp || !rq) return null
  // 가리기(cover-up)로 A, B 구하기
  const A = c.div(c.at(num, v, rp), c.at(q, v, rp))
  const B = c.div(c.at(num, v, rq), c.at(p, v, rq))
  const F = c.integ(body, v)
  if (!F) return null
  steps.length = 0
  if (den0.operator !== "Multiply") steps.push({ text: "분모를 인수분해합니다.", latex: `${tex(den0)}=${tex(den)}` })
  steps.push({ text: "부분분수로 나눕니다.", latex: `${tex(body)}=\\frac{A}{${tex(p)}}+\\frac{B}{${tex(q)}}` })
  steps.push({
    text: `양변에 분모를 곱하고 ${v} 에 각 일차식이 0 이 되는 값을 넣어 A, B 를 구합니다.`,
    latex: `A=${tex(A)},\\quad B=${tex(B)}`,
  })
  steps.push({
    text: "각각 ∫ 1/(일차식) dx = ln|일차식| 으로 적분합니다.",
    latex: `\\int\\left(${tex(c.div(A, p))}${/^-/.test(tex(c.div(B, q))) ? "" : "+"}${tex(c.div(B, q))}\\right)d${v}=${tex(F)}+C`,
  })
  return F
}

// ───────────────────────── 미분 ─────────────────────────

function solveDerivative(c: Calc, f: Expression, v: string): SolveResult {
  const steps: Step[] = []
  const result = c.D(f, v)
  if (unsolved(result, ["D", "Derivative"])) return { ok: false, reason: CANNOT }
  const ops = f.ops ?? []

  // 밑과 지수에 모두 변수가 있으면 (예: x^x) 로그 미분법
  if (f.operator === "Power" && ops[0]?.has(v) && ops[1]?.has(v) && ops[0].symbol !== "ExponentialE") {
    const [base, exp] = ops
    const lnRight = c.box(["Multiply", exp.json, ["Ln", base.json]])
    const dRight = c.D(lnRight, v)
    steps.push({ text: "y = (식) 의 양변에 자연로그를 취합니다.", latex: `\\ln y=${tex(lnRight)}` })
    steps.push({ text: "양변을 x 에 대해 미분합니다. (왼쪽은 합성함수 미분)", latex: `\\frac{y'}{y}=${tex(dRight)}` })
    steps.push({ text: "양변에 y 를 곱합니다.", latex: `y'=${tex(f)}\\left(${tex(dRight)}\\right)` })
  } else if (f.operator === "Divide" && ops.length === 2 && ops[1].has(v)) {
    const [n, d] = ops
    steps.push({ text: "분자 f, 분모 g 를 각각 미분합니다.", latex: `f=${tex(n)},\\ f'=${tex(c.D(n, v))},\\quad g=${tex(d)},\\ g'=${tex(c.D(d, v))}` })
    steps.push({
      text: "몫의 미분 공식 (f/g)' = (f'g − fg')/g² 에 넣습니다.",
      latex: `\\frac{\\left(${tex(c.D(n, v))}\\right)\\left(${tex(d)}\\right)-\\left(${tex(n)}\\right)\\left(${tex(c.D(d, v))}\\right)}{\\left(${tex(d)}\\right)^{2}}`,
    })
  } else if (f.operator === "Multiply" && ops.filter((o) => o.has(v)).length >= 2) {
    const withV = ops.filter((o) => o.has(v))
    const consts = ops.filter((o) => !o.has(v))
    const f1 = withV[0]
    const f2 = c.mul(...withV.slice(1), ...consts)
    const d1 = c.D(f1, v)
    const d2 = c.D(f2, v)
    steps.push({ text: "곱해진 두 함수를 각각 미분합니다.", latex: `(${tex(f1)})'=${tex(d1)},\\quad (${tex(f2)})'=${tex(d2)}` })
    steps.push({
      text: "곱의 미분 공식 (fg)' = f'g + fg' 에 넣습니다.",
      latex: `\\left(${tex(d1)}\\right)\\left(${tex(f2)}\\right)+\\left(${tex(f1)}\\right)\\left(${tex(d2)}\\right)`,
    })
  } else {
    const chain = chainParts(c, f, v)
    if (chain) {
      steps.push({ text: "바깥 함수와 안쪽 식을 나눕니다.", latex: `y=${tex(chain.outerU)},\\quad u=${tex(chain.inner)}` })
      steps.push({ text: "각각 미분합니다.", latex: `\\frac{dy}{du}=${tex(chain.dOuter)},\\quad \\frac{du}{d${v}}=${tex(chain.dInner)}` })
      steps.push({
        text: "곱합니다. (연쇄법칙: dy/dx = dy/du · du/dx)",
        latex: `\\frac{dy}{d${v}}=\\left(${tex(chain.dOuterAtInner)}\\right)\\cdot\\left(${tex(chain.dInner)}\\right)`,
      })
    } else {
      steps.push({ text: "기본 도함수 공식으로 항별로 미분합니다." })
    }
  }
  steps.push({ text: "정리합니다.", latex: `\\frac{d}{d${v}}\\left(${tex(f)}\\right)=${tex(result)}` })
  return { ok: true, solution: { title: "도함수", answer: tex(result), steps } }
}

/** 합성함수: 바깥 함수(sin, ln, e^□, √□, □^n)와 안쪽 식 */
function chainParts(c: Calc, f: Expression, v: string) {
  const op = f.operator
  const ops = f.ops ?? []
  const u = c.ce.symbol("u")
  let inner: Expression | null = null
  let outerU: Expression | null = null
  if (["Sin", "Cos", "Tan", "Ln", "Sqrt", "Exp"].includes(op) && ops[0]?.has(v) && ops[0].symbol !== v) {
    inner = ops[0]
    outerU = c.box([op, "u"])
  } else if (op === "Power" && ops.length === 2) {
    const [base, exp] = ops
    if (base.symbol === "ExponentialE" && exp.has(v) && exp.symbol !== v) {
      inner = exp
      outerU = c.box(["Power", "ExponentialE", "u"])
    } else if (base.has(v) && !exp.has(v) && base.symbol !== v) {
      inner = base
      outerU = c.box(["Power", "u", exp.json])
    }
  }
  if (!inner || !outerU) return null
  const dOuter = c.D(outerU, "u")
  return { inner, outerU, dOuter, dInner: c.D(inner, v), dOuterAtInner: dOuter.subs({ u: inner }).simplify(), u }
}

/** 음함수: F(x, y) = 0 → dy/dx = −F_x / F_y */
function solveImplicit(c: Calc, eq: Expression): SolveResult {
  const [l, r] = eq.ops ?? []
  if (!l || !r) return { ok: false, reason: CANNOT }
  const F = c.sub(l, r)
  const Fx = c.D(F, "x")
  const Fy = c.D(F, "y")
  const result = c.div(c.sub(c.ce.number(0), Fx), Fy)
  if (unsolved(result, ["D"]) || Fy.is(0)) return { ok: false, reason: CANNOT }
  return {
    ok: true,
    solution: {
      title: "dy/dx",
      answer: `\\frac{dy}{dx}=${tex(result)}`,
      steps: [
        { text: "양변을 x 에 대해 미분합니다. y 가 들어 있는 항은 미분한 뒤 dy/dx 를 곱합니다.", latex: `${tex(Fx)}+\\left(${tex(Fy)}\\right)\\frac{dy}{dx}=0` },
        { text: "dy/dx 를 한쪽으로 모아 정리합니다.", latex: `\\frac{dy}{dx}=-\\frac{${tex(Fx)}}{${tex(Fy)}}=${tex(result)}` },
      ],
    },
  }
}

/** 매개변수: x = f(t), y = g(t) → dy/dx = g'(t) / f'(t) */
function solveParametric(c: Calc, tuple: Expression): SolveResult {
  const eqs = tuple.ops ?? []
  const xEq = eqs.find((e) => e.operator === "Equal" && e.ops?.[0]?.symbol === "x")
  const yEq = eqs.find((e) => e.operator === "Equal" && e.ops?.[0]?.symbol === "y")
  if (!xEq?.ops || !yEq?.ops) return { ok: false, reason: CANNOT }
  const X = xEq.ops[1]
  const Y = yEq.ops[1]
  const p = [...X.unknowns, ...Y.unknowns].find((s) => s !== "x" && s !== "y")
  if (!p) return { ok: false, reason: "넓이·부피 같은 활용 문제는 접근법만 안내합니다. 식(∫ … dx)으로 바꿔 넣으면 값을 계산해 드려요." }
  const Xt = c.D(X, p)
  const Yt = c.D(Y, p)
  const result = c.div(Yt, Xt)
  return {
    ok: true,
    solution: {
      title: "dy/dx",
      answer: `\\frac{dy}{dx}=${tex(result)}`,
      steps: [
        { text: `x, y 를 각각 ${p} 에 대해 미분합니다.`, latex: `\\frac{dx}{d${p}}=${tex(Xt)},\\quad \\frac{dy}{d${p}}=${tex(Yt)}` },
        { text: "나눕니다. (dx/dt ≠ 0 일 때)", latex: `\\frac{dy}{dx}=\\frac{dy/d${p}}{dx/d${p}}=\\frac{${tex(Yt)}}{${tex(Xt)}}=${tex(result)}` },
      ],
    },
  }
}

// ───────────────────────── 극한 ─────────────────────────

function solveLimit(c: Calc, limit: Expression, methods: string[], input: string): SolveResult {
  const { ce } = c
  const fn = limit.ops?.[0]
  const to = limit.ops?.[1]
  const body = fn?.ops?.[0]?.operator === "Block" ? fn.ops[0].ops?.[0] : fn?.ops?.[0]
  const v = fn?.ops?.[1]?.symbol ?? "x"
  if (!body || !to) return { ok: false, reason: CANNOT }

  const toInf = to.symbol === "PositiveInfinity" || Number(to.N().re) === Infinity
  const toTex = toInf ? "\\infty" : tex(to)
  const has = (name: string) => methods.some((m) => m.includes(name))
  const steps: Step[] = []
  const L = `\\lim_{${v}\\to ${toTex}}`
  // 화면에 보일 식은 사용자가 쓴 모양 그대로 (CE 는 (e^{2x}-1)/x 를 (1/x)(e^{2x}-1) 처럼 바꿔 버림)
  const shown = input.replace(/^\s*\\lim_\{[^{}]*\}\s*/, "").trim() || tex(body)
  const frac = (a: Expression, b: Expression) => (b.is(1) ? tex(a) : `\\frac{${tex(a)}}{${tex(b)}}`)

  // 구분구적법: Σ f(k/n)·(1/n) → ∫₀¹ f(x) dx
  if (body.operator === "Sum") {
    const summand = body.ops?.[0]
    const k = body.ops?.[1]?.ops?.[0]?.symbol ?? "k"
    if (summand) {
      const h = c.mul(summand, ce.symbol(v)).subs({ [k]: ce.box(["Multiply", "x", v]) }).simplify()
      if (!h.has(v)) {
        // 브라우저에서 이 극한을 CE 로 바로 계산하면 멈추는 경우가 있어서, 정적분으로 값을 구한다
        const I = c.integ(h, "x")
        if (!I) return { ok: false, reason: CANNOT }
        const value = c.sub(c.at(I, "x", ce.number(1)), c.at(I, "x", ce.number(0)))
        steps.push({ text: `${k}/${v} 를 x 로, 1/${v} 을 dx 로 봅니다. (k = 1 ~ ${v} → x 는 0 ~ 1)`, latex: `${L}\\sum_{${k}=1}^{${v}} ${tex(summand)}=\\int_{0}^{1} ${integrand(h)}\\,dx` })
        steps.push({ text: "정적분을 계산합니다.", latex: `=\\left[${tex(I)}\\right]_{0}^{1}=${tex(value)}` })
        return { ok: true, solution: { title: "극한값", answer: tex(value), approx: approxOf(value), steps } }
      }
    }
  }

  const value = limit.evaluate()
  if (unsolved(value, ["Limit"])) return { ok: false, reason: CANNOT }

  const coef = (e: Expression | undefined) => (e ? c.div(e, ce.symbol(v)) : null)
  const ops = body.ops ?? []

  if (has("삼각함수 기본 극한") && body.operator === "Divide" && ["Sin", "Tan"].includes(ops[0]?.operator)) {
    const a = coef(ops[0].ops?.[0])
    const b = coef(ops[1])
    const fnName = ops[0].operator === "Sin" ? "\\sin" : "\\tan"
    if (a && b && !a.has(v) && !b.has(v)) {
      steps.push({
        text: `${fnName === "\\sin" ? "sin" : "tan"}(□) 아래에 같은 □ 가 오도록 곱하고 나눕니다.`,
        latex: `${shown}=${frac(a, b)}\\cdot\\frac{${fnName} ${tex(ops[0].ops![0])}}{${tex(ops[0].ops![0])}}`,
      })
      steps.push({ text: `${fnName === "\\sin" ? "sin" : "tan"}□/□ → 1 을 씁니다.`, latex: `${L}${shown}=${frac(a, b)}\\cdot 1=${tex(value)}` })
    }
  } else if (has("켤레식") && body.operator === "Divide") {
    steps.push({ text: "분모·분자에 (1 + cos x) 를 곱해서 1 − cos²x = sin²x 를 만듭니다.", latex: `\\frac{1-\\cos ${v}}{${v}^2}=\\left(\\frac{\\sin ${v}}{${v}}\\right)^{2}\\cdot\\frac{1}{1+\\cos ${v}}` })
    steps.push({ text: "sin x / x → 1, cos x → 1 을 씁니다.", latex: `\\to 1^{2}\\cdot\\frac{1}{1+1}` })
  } else if (has("지수함수 기본 극한") && body.operator === "Divide") {
    const powE = JSON.stringify(ops[0]?.json).includes("ExponentialE")
    const exp = ops[0]?.ops?.find((o) => o.operator === "Power")?.ops?.[1] ?? ops[0]?.ops?.[0]?.ops?.[1]
    const a = coef(exp)
    if (powE && a && !a.has(v)) {
      steps.push({ text: "지수와 분모가 같은 꼴이 되도록 곱하고 나눕니다.", latex: `${shown}=${tex(a)}\\cdot\\frac{e^{${tex(exp!)}}-1}{${tex(exp!)}}` })
      steps.push({ text: "(e□ − 1)/□ → 1 을 씁니다.", latex: `\\to ${tex(a)}\\cdot 1` })
    }
  } else if (body.operator === "Power" && ops[1]?.symbol === v && ops[0]?.operator === "Add" && toInf) {
    const inside = ops[0]
    const cTerm = inside?.ops?.find((o) => o.has(v))
    const cc = cTerm ? c.mul(cTerm, ce.symbol(v)) : null
    if (cc && !cc.has(v)) {
      steps.push({
        text: "지수를 쪼개서 (1 + 1/□)^□ 꼴을 만듭니다.",
        latex: `\\left(1+\\frac{${tex(cc)}}{${v}}\\right)^{${v}}=\\left[\\left(1+\\frac{${tex(cc)}}{${v}}\\right)^{\\frac{${v}}{${tex(cc)}}}\\right]^{${tex(cc)}}`,
      })
      steps.push({ text: "대괄호 안은 e 로 갑니다.", latex: `\\to e^{${tex(cc)}}` })
    }
  } else if (!toInf && body.operator === "Divide") {
    // 0/0 꼴: 약분해서 대입
    const atTo = (e: Expression) => Number(e.subs({ [v]: to }).N().re)
    if (atTo(ops[0]) === 0 && atTo(ops[1]) === 0) {
      const s = body.simplify()
      if (!s.isSame(body)) {
        steps.push({ text: "대입하면 0/0 이므로, 인수분해해서 약분합니다.", latex: `${tex(body)}=${tex(s)}\\quad(${v}\\ne ${toTex})` })
        steps.push({ text: "이제 대입합니다.", latex: `${L}${tex(s)}=${tex(value)}` })
      }
    }
  } else if (toInf && body.operator === "Divide") {
    steps.push({ text: "분모의 최고차항으로 분자·분모를 나눕니다. 1/x 꼴의 항은 0 으로 가므로 최고차항의 계수만 남습니다.", latex: `${L}${shown}=${tex(value)}` })
  }

  // 숫자로 가까이 가 보기 (모든 극한에 붙는 확인)
  const pts = toInf ? [10, 100, 1000, 10000] : [0.1, 0.01, 0.001].map((d) => Number(to.N().re) + d)
  const vals = pts.map((p) => {
    const y = Number(body.subs({ [v]: ce.number(p) }).N().re)
    return `${v}=${p}\\Rightarrow ${Number.isFinite(y) ? Math.round(y * 1e5) / 1e5 : "?"}`
  })
  steps.push({ text: `${v} 를 ${toInf ? "점점 크게" : `${toTex} 에 가깝게`} 해서 값을 넣어 봅니다.`, latex: vals.join(",\\quad ") })

  return { ok: true, solution: { title: "극한값", answer: tex(value), approx: approxOf(value), steps } }
}

// ───────────────────────── 급수 ─────────────────────────

function solveSum(c: Calc, sum: Expression, methods: string[]): SolveResult {
  const { ce } = c
  const term = sum.ops?.[0]
  const lim = sum.ops?.[1]
  const n = lim?.ops?.[0]?.symbol ?? "n"
  const start = lim?.ops?.[1] ?? ce.number(1)
  if (!term) return { ok: false, reason: CANNOT }
  const value = sum.evaluate()
  if (unsolved(value, ["Sum"])) return { ok: false, reason: CANNOT }
  const steps: Step[] = []
  const has = (name: string) => methods.some((m) => m.includes(name))

  if (has("등비급수")) {
    const a = c.at(term, n, start)
    const r = c.div(term.subs({ [n]: c.box(["Add", n, 1]) }), term)
    if (!r.has(n)) {
      steps.push({ text: "첫째항 a 와 공비 r 을 구합니다.", latex: `a=${tex(a)},\\quad r=${tex(r)}` })
      steps.push({ text: "|r| < 1 이므로 수렴하고, 합은 a/(1 − r) 입니다.", latex: `\\frac{${tex(a)}}{1-${tex(r)}}=${tex(value)}` })
    }
  } else if (has("부분분수") && term.operator === "Divide") {
    steps.push({ text: "부분분수로 쪼개면 이웃한 항끼리 지워집니다. 부분합 Sₙ 을 구한 뒤 n → ∞ 극한을 구합니다." })
    steps.push({ text: "합", latex: `\\sum_{${n}=${tex(start)}}^{\\infty} ${tex(term)}=${tex(value)}` })
  } else {
    steps.push({ text: "부분합의 극한을 계산합니다.", latex: `\\sum_{${n}=${tex(start)}}^{\\infty} ${tex(term)}=${tex(value)}` })
  }
  return { ok: true, solution: { title: "급수의 합", answer: tex(value), approx: approxOf(value), steps } }
}

// ───────────────────────── 입구 ─────────────────────────

/**
 * @param latex 수식 입력창의 LaTeX
 * @param methods calc2.ts 가 추천한 접근법 이름들 (풀이 순서를 정하는 데 씀)
 * @param topic calc2.ts 가 정한 주제
 */
export function solve(ce: ComputeEngine, latex: string, methods: string[], topic: string): SolveResult {
  if (!latex.trim()) return { ok: false, reason: "식을 입력해 주세요." }
  const c = new Calc(ce)
  let e: Expression
  try {
    e = ce.parse(latex)
  } catch {
    return { ok: false, reason: "식을 읽지 못했습니다." }
  }
  if (!e.isValid) return { ok: false, reason: "식에 빠진 부분이 있습니다. 빈칸(□)을 모두 채워 주세요." }

  // 넓이·부피·거리·길이·접선·극값·변곡점 같은 활용 문제 (목적 버튼으로 고른 경우)
  try {
    const applied = solveApplied(c, e, methods)
    if (applied) return applied
  } catch {
    return { ok: false, reason: CANNOT }
  }

  try {
    const op = e.operator
    if (op === "Integrate") {
      const fn = e.ops?.[0]
      const body = fn?.ops?.[0]?.operator === "Block" ? fn.ops[0].ops?.[0] : fn?.ops?.[0]
      const limits = e.ops?.[1]
      const v = limits?.ops?.[0]?.symbol ?? fn?.ops?.[1]?.symbol ?? "x"
      const lo = limits?.ops?.[1]
      const hi = limits?.ops?.[2]
      const definite = !!lo && !!hi && lo.symbol !== "Nothing" && hi.symbol !== "Nothing"
      if (!body) return { ok: false, reason: CANNOT }
      return solveIntegral(c, body, v, definite ? lo! : null, definite ? hi! : null, methods)
    }
    if (op === "D") {
      const f = e.ops?.[0]
      const v = e.ops?.[1]?.symbol ?? "x"
      return f ? solveDerivative(c, f, v) : { ok: false, reason: CANNOT }
    }
    if (op === "Limit") return solveLimit(c, e, methods, latex)
    if (op === "Sum") return solveSum(c, e, methods)
    if (op === "Tuple") return solveParametric(c, e)
    if (op === "Equal") {
      const [l, r] = e.ops ?? []
      // y = f(x) 꼴이면 f(x) 를 미분
      if (l?.symbol === "y" && r && !r.has("y")) return solveDerivative(c, r, "x")
      if (e.has("x") && e.has("y")) return solveImplicit(c, e)
    }
    if (topic === "미분" && e.has("x")) return solveDerivative(c, e, "x")
    return { ok: false, reason: "자동 풀이는 ∫(적분), d/dx(미분), lim(극한), Σ(급수) 식에서 됩니다." }
  } catch {
    return { ok: false, reason: CANNOT }
  }
}
