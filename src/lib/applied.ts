/**
 * 미적분2 활용 문제 풀이: 넓이, 부피, 속도·거리, 곡선의 길이, 접선, 극값, 변곡점
 *
 * 입력은 수식 입력창에 쉼표로 이어 쓴 조건들이다. 예)
 *   넓이        y=x^2, y=x          /  y=e^x, x=0, x=1  /  y=x^2-1 (x축과)
 *   부피        S(x)=x^2, x=0, x=3   (단면의 넓이)
 *   속도·거리   v(t)=t^2-4t, t=0, t=5  /  x=\cos t, y=\sin t, t=0, t=\pi
 *   곡선의 길이 y=\frac{2}{3}x^{3/2}, x=0, x=3
 *   접선        y=e^x, x=0   /  y=e^x, (1, e)
 *   극값·변곡점 y=x^3-3x
 *
 * - 방정식(교점, f'=0)은 CE 로 정확히 풀어 보고, 안 되면 숫자로 찾는다(이분법).
 * - 적분은 CE 로 정확히 계산하고, 안 되면 심프슨 공식으로 근삿값을 낸다.
 */
import type { Calc, Expression, SolveResult, Step } from "./solve.ts"
import { CANNOT, approxOf, integrand, tex, unsolved } from "./solve.ts"

type Num = { exact: Expression | null; x: number }

// ───────────────────────── 입력 정리 ─────────────────────────

type Parsed = {
  /** y = f(x), f(x) = …, S(x) = …, v(t) = … */
  curves: { name: string; v: string; expr: Expression }[]
  /** x = 1, t = 0 같은 경계 (변수 → 값들) */
  bounds: Record<string, Expression[]>
  /** x = f(t), y = g(t) */
  param: { x: Expression; y: Expression; t: string } | null
  /** (1, e) 같은 점 */
  points: [Expression, Expression][]
}

function parse(e: Expression): Parsed {
  const eqs: Expression[] = []
  const points: [Expression, Expression][] = []
  const walk = (n: Expression) => {
    if (n.symbol === "Nothing") return
    if (n.operator === "Equal") eqs.push(n)
    else if (n.operator === "Tuple" || n.operator === "Delimiter" || n.operator === "Sequence" || n.operator === "List") {
      const ops = (n.ops ?? []).filter((o) => o.symbol !== "Nothing")
      // (1, e): 숫자 두 개짜리 묶음은 점
      if (n.operator === "Tuple" && ops.length === 2 && ops.every((o) => o.unknowns.length === 0 && o.operator !== "Equal")) {
        points.push([ops[0], ops[1]])
      } else ops.forEach(walk)
    }
  }
  walk(e)

  const curves: Parsed["curves"] = []
  const bounds: Parsed["bounds"] = {}
  let px: Expression | null = null
  let py: Expression | null = null
  for (const eq of eqs) {
    const [l, r] = eq.ops ?? []
    if (!l || !r) continue
    const free = r.unknowns
    if (l.symbol && free.length === 0) {
      // x = 1, t = 0 : 경계값
      ;(bounds[l.symbol] ??= []).push(r)
    } else if (l.symbol === "x" && free.length === 1 && free[0] !== "x" && free[0] !== "y") {
      px = r
    } else if (l.symbol === "y" && free.length === 1 && free[0] !== "x" && free[0] !== "y") {
      py = r
    } else if (l.symbol === "y") {
      curves.push({ name: "y", v: "x", expr: r })
    } else if (l.operator && l.operator !== "Equal" && (l.ops?.length ?? 0) === 1 && l.ops![0].symbol) {
      // f(x) = …, S(x) = …, v(t) = …
      curves.push({ name: l.operator, v: l.ops![0].symbol!, expr: r })
    }
  }
  const t = px && py ? ([...px.unknowns, ...py.unknowns].find((s) => s !== "x" && s !== "y") ?? "t") : "t"
  return { curves, bounds, param: px && py ? { x: px, y: py, t } : null, points }
}

// ───────────────────────── 숫자 도구 ─────────────────────────

/** (√a)² → a 처럼 CE 가 정리하지 못하는 꼴을 JSON 에서 직접 정리 */
function squareOfRoot(json: unknown): unknown {
  if (!Array.isArray(json)) return json
  const [op, ...args] = json
  const a = args.map(squareOfRoot)
  if (op === "Power" && Array.isArray(a[0]) && a[0][0] === "Sqrt" && a[1] === 2) return a[0][1]
  if (op === "Square" && Array.isArray(a[0]) && a[0][0] === "Sqrt") return a[0][1]
  return [op, ...a]
}
const tidy = (c: Calc, json: unknown) => c.box(squareOfRoot(json)).simplify()

function num(c: Calc, f: Expression, v: string, x: number): number {
  return Number(f.subs({ [v]: c.ce.number(x) }).N().re)
}

/** 숫자 근을 보기 좋은 정확한 값으로 바꿔 본다: 정수·분수(분모 12 이하)·π 의 배수 */
function snap(c: Calc, x: number): Expression | null {
  for (let q = 1; q <= 12; q++) {
    const p = Math.round(x * q)
    if (Math.abs(p / q - x) < 1e-9) return c.box(q === 1 ? p : ["Rational", p, q])
  }
  for (let q = 1; q <= 6; q++) {
    const p = Math.round((x / Math.PI) * q)
    if (p !== 0 && Math.abs((p * Math.PI) / q - x) < 1e-9) return c.box(["Multiply", ["Rational", p, q], "Pi"]).simplify()
  }
  return null
}

/** f(v) = 0 의 실근을 [lo, hi] 에서 찾는다. CE 의 정확한 근과 숫자로 맞춰 보고, 없으면 snap → 그래도 없으면 근삿값 */
function roots(c: Calc, f: Expression, v: string, lo: number, hi: number, max = 8): Num[] {
  const exactList: Expression[] = []
  try {
    const sol = c.box(["Equal", f.json, 0]).solve(v) as unknown
    if (Array.isArray(sol)) exactList.push(...(sol as Expression[]))
  } catch {
    /* CE 가 못 풀면 숫자로 */
  }
  const xs: number[] = []
  const N = 1500
  let prevX = lo
  let prevY = num(c, f, v, lo)
  if (Math.abs(prevY) < 1e-12) xs.push(lo)
  for (let i = 1; i <= N; i++) {
    const x = lo + ((hi - lo) * i) / N
    const y = num(c, f, v, x)
    if (Number.isFinite(y) && Number.isFinite(prevY)) {
      if (Math.abs(y) < 1e-12) xs.push(x)
      else if (prevY * y < 0) {
        let a = prevX
        let b = x
        let fa = prevY
        for (let k = 0; k < 80; k++) {
          const m = (a + b) / 2
          const fm = num(c, f, v, m)
          if (fa * fm <= 0) b = m
          else {
            a = m
            fa = fm
          }
        }
        xs.push((a + b) / 2)
      }
    }
    prevX = x
    prevY = y
  }
  // 중복 제거
  const uniq = xs.sort((a, b) => a - b).filter((x, i, arr) => i === 0 || Math.abs(x - arr[i - 1]) > 1e-7)
  return uniq.slice(0, max).map((x) => {
    const exact = exactList.find((e) => Math.abs(Number(e.N().re) - x) < 1e-7) ?? snap(c, x)
    return { exact: exact ? exact.simplify() : null, x }
  })
}

function show(n: Num) {
  return n.exact ? tex(n.exact) : `${Math.round(n.x * 1e4) / 1e4}`
}
function boundNum(c: Calc, e: Expression): Num {
  return { exact: e, x: Number(e.N().re) }
}

/** 심프슨 공식으로 ∫ₐᵇ f dv 의 근삿값 */
function simpson(c: Calc, f: Expression, v: string, a: number, b: number, n = 2000) {
  const h = (b - a) / n
  let s = num(c, f, v, a) + num(c, f, v, b)
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * num(c, f, v, a + i * h)
  return (s * h) / 3
}

/** 정적분: 정확한 값(되면)과 근삿값 */
function definite(c: Calc, f: Expression, v: string, a: Num, b: Num) {
  const F = c.integ(f, v)
  if (F && a.exact && b.exact) {
    const value = c.sub(c.at(F, v, b.exact), c.at(F, v, a.exact))
    const x = Number(value.N().re)
    if (!unsolved(value, []) && Number.isFinite(x)) return { F, exact: value as Expression | null, x }
  }
  return { F: null, exact: null as Expression | null, x: simpson(c, f, v, a.x, b.x) }
}

function valueTex(d: { exact: Expression | null; x: number }) {
  return d.exact ? tex(d.exact) : `${Math.round(d.x * 1e4) / 1e4}\\ (\\text{근삿값})`
}

function ok(title: string, answer: string, steps: Step[], approx?: string, check?: Step): SolveResult {
  return { ok: true, solution: { title, answer, approx, steps, check } }
}

const fail = (reason: string): SolveResult => ({ ok: false, reason })

// ───────────────────────── 넓이 ─────────────────────────

function area(c: Calc, p: Parsed): SolveResult {
  const xs = p.curves.filter((cv) => cv.v === "x")
  if (xs.length === 0) return fail("넓이를 구할 곡선을 y = … 꼴로 넣어 주세요. 예) y=x^2, y=x")
  const f = xs[0].expr
  const g = xs[1]?.expr ?? c.ce.number(0)
  const gName = xs[1] ? "" : "x축"
  const d = c.sub(f, g)
  const steps: Step[] = []

  // 구간 정하기
  const lines = (p.bounds.x ?? []).map((e) => boundNum(c, e)).sort((a, b) => a.x - b.x)
  let lo: Num
  let hi: Num
  const searchLo = lines.length >= 2 ? lines[0].x : -10
  const searchHi = lines.length >= 2 ? lines[lines.length - 1].x : 10
  const rs = roots(c, d, "x", searchLo, searchHi)
  if (lines.length >= 2) {
    lo = lines[0]
    hi = lines[lines.length - 1]
    steps.push({ text: "적분 구간은 주어진 세로선 사이입니다.", latex: `${show(lo)}\\le x\\le ${show(hi)}` })
  } else {
    const all = [...lines, ...rs].sort((a, b) => a.x - b.x)
    if (all.length < 2) return fail("둘러싸인 구간을 찾지 못했습니다. x=a, x=b 로 구간을 함께 넣어 주세요.")
    lo = all[0]
    hi = all[all.length - 1]
    steps.push({
      text: xs[1] ? "두 곡선의 교점을 구합니다." : "곡선과 x축의 교점을 구합니다.",
      latex: `${tex(f)}=${xs[1] ? tex(g) : "0"}\\quad\\Rightarrow\\quad x=${rs.map(show).join(",\\ ")}`,
    })
  }

  // 구간 안에서 위아래가 바뀌는 점으로 나누기
  const cuts = rs.filter((r) => r.x > lo.x + 1e-9 && r.x < hi.x - 1e-9)
  const pts = [lo, ...cuts, hi]
  const pieces: { a: Num; b: Num; top: Expression; bottom: Expression; topName: string; val: ReturnType<typeof definite> }[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const mid = (a.x + b.x) / 2
    const up = num(c, d, "x", mid) >= 0
    const top = up ? f : g
    const bottom = up ? g : f
    const diff = c.sub(top, bottom)
    pieces.push({ a, b, top, bottom, topName: up ? tex(f) : gName || tex(g), val: definite(c, diff, "x", a, b) })
  }
  steps.push({
    text: "구간마다 어느 쪽이 위에 있는지 확인합니다. (가운데 값을 넣어 비교)",
    latex: pieces.map((pc) => `${show(pc.a)}\\le x\\le ${show(pc.b)}:\\ ${tex(pc.top)}\\ \\ge\\ ${tex(pc.bottom)}`).join("\n"),
  })
  const integralTex = pieces.map((pc) => `\\int_{${show(pc.a)}}^{${show(pc.b)}}\\left\\{${tex(pc.top)}-\\left(${tex(pc.bottom)}\\right)\\right\\}dx`).join("+")
  steps.push({ text: "넓이는 (위 함수 − 아래 함수) 를 적분한 값입니다.", latex: `S=${integralTex}` })

  for (const pc of pieces) {
    if (pc.val.F) {
      steps.push({
        text: pieces.length > 1 ? `${show(pc.a)} ~ ${show(pc.b)} 구간을 계산합니다.` : "계산합니다.",
        latex: `\\left[${tex(pc.val.F)}\\right]_{${show(pc.a)}}^{${show(pc.b)}}=${valueTex(pc.val)}`,
      })
    } else {
      steps.push({ text: "정확한 식으로 적분되지 않아 수치 적분(심프슨 공식)으로 계산합니다.", latex: `\\approx ${Math.round(pc.val.x * 1e4) / 1e4}` })
    }
  }

  const allExact = pieces.every((pc) => pc.val.exact)
  const total = allExact ? pieces.map((pc) => pc.val.exact!).reduce((s, e) => c.box(["Add", s.json, e.json]).simplify()) : null
  const totalX = pieces.reduce((s, pc) => s + pc.val.x, 0)
  if (pieces.length > 1) steps.push({ text: "구간별 넓이를 더합니다.", latex: `S=${total ? tex(total) : `${Math.round(totalX * 1e4) / 1e4}`}` })

  // 검산: |f − g| 를 숫자로 적분
  const absD = c.box(["Abs", d.json])
  const numeric = simpson(c, absD, "x", lo.x, hi.x, 1000)
  const check = Math.abs(numeric - totalX) < 1e-4 ? { text: `검산: |f − g| 를 수치 적분한 값 ${Math.round(numeric * 1e4) / 1e4} 과 같습니다. ✓` } : undefined
  return ok("넓이", total ? tex(total) : `${Math.round(totalX * 1e4) / 1e4}`, steps, total ? approxOf(total) : "근삿값", check)
}

// ───────────────────────── 부피 ─────────────────────────

function volume(c: Calc, p: Parsed): SolveResult {
  const S = p.curves.find((cv) => cv.name !== "y") ?? p.curves[0]
  if (!S) return fail("단면의 넓이를 S(x)=… 꼴로 넣어 주세요. 예) S(x)=x^2, x=0, x=3")
  const lines = (p.bounds[S.v] ?? []).map((e) => boundNum(c, e)).sort((a, b) => a.x - b.x)
  if (lines.length < 2) return fail(`구간을 ${S.v}=a, ${S.v}=b 로 함께 넣어 주세요. 예) S(x)=x^2, x=0, x=3`)
  const [a, b] = [lines[0], lines[lines.length - 1]]
  const v = S.v
  const val = definite(c, S.expr, v, a, b)
  const steps: Step[] = [
    { text: `${v} 에서 자른 단면의 넓이를 S(${v}) 로 놓습니다.`, latex: `S(${v})=${tex(S.expr)}` },
    { text: "부피는 단면의 넓이를 적분한 값입니다.", latex: `V=\\int_{${show(a)}}^{${show(b)}} ${integrand(S.expr)}\\,d${v}` },
  ]
  if (val.F) steps.push({ text: "계산합니다.", latex: `=\\left[${tex(val.F)}\\right]_{${show(a)}}^{${show(b)}}=${valueTex(val)}` })
  else steps.push({ text: "수치 적분(심프슨 공식)으로 계산합니다.", latex: `\\approx ${Math.round(val.x * 1e4) / 1e4}` })
  return ok("부피", val.exact ? tex(val.exact) : `${Math.round(val.x * 1e4) / 1e4}`, steps, val.exact ? approxOf(val.exact) : "근삿값")
}

// ───────────────────────── 속도·거리 ─────────────────────────

function motion(c: Calc, p: Parsed): SolveResult {
  // 평면 위의 운동: x = f(t), y = g(t) → 움직인 거리 = ∫√(x'² + y'²) dt
  if (p.param) return pathLength(c, p, "움직인 거리")

  // 직선 운동: v(t) 또는 위치 x(t)
  const cv = p.curves.find((k) => k.v !== "x") ?? p.curves[0]
  if (!cv) return fail("속도를 v(t)=… 꼴로 넣어 주세요. 예) v(t)=t^2-4t, t=0, t=5")
  const t = cv.v
  const lines = (p.bounds[t] ?? []).map((e) => boundNum(c, e)).sort((a, b) => a.x - b.x)
  if (lines.length < 2) return fail(`시각 구간을 ${t}=a, ${t}=b 로 함께 넣어 주세요. 예) v(t)=t^2-4t, t=0, t=5`)
  const [a, b] = [lines[0], lines[lines.length - 1]]
  const steps: Step[] = []
  let vel = cv.expr
  if (cv.name === "x" || cv.name === "s" || cv.name === "p") {
    vel = c.D(cv.expr, t)
    steps.push({ text: "위치를 미분해서 속도를 구합니다.", latex: `v(${t})=${tex(vel)}` })
  }

  const disp = definite(c, vel, t, a, b)
  steps.push({
    text: "위치의 변화량은 속도를 그대로 적분합니다.",
    latex: `\\int_{${show(a)}}^{${show(b)}} ${integrand(vel)}\\,d${t}=${valueTex(disp)}`,
  })

  const rs = roots(c, vel, t, a.x, b.x).filter((r) => r.x > a.x + 1e-9 && r.x < b.x - 1e-9)
  if (rs.length) steps.push({ text: "속도가 0 이 되는 시각(방향이 바뀌는 시각)을 찾습니다.", latex: `v(${t})=0\\quad\\Rightarrow\\quad ${t}=${rs.map(show).join(",\\ ")}` })

  const pts = [a, ...rs, b]
  const parts = []
  for (let i = 0; i < pts.length - 1; i++) {
    const d = definite(c, vel, t, pts[i], pts[i + 1])
    const neg = d.x < 0
    parts.push({ a: pts[i], b: pts[i + 1], d, abs: d.exact ? (neg ? c.box(["Negate", d.exact.json]).simplify() : d.exact) : null, absX: Math.abs(d.x) })
  }
  steps.push({
    text: "움직인 거리는 |v| 를 적분합니다. 방향이 바뀌는 시각에서 나눠 각 구간의 절댓값을 더합니다.",
    latex: parts.map((pt) => `\\left|\\int_{${show(pt.a)}}^{${show(pt.b)}} ${integrand(vel)}\\,d${t}\\right|`).join("+") +
      "\n=" + parts.map((pt) => (pt.abs ? tex(pt.abs) : `${Math.round(pt.absX * 1e4) / 1e4}`)).join("+"),
  })
  const exact = parts.every((pt) => pt.abs) ? parts.map((pt) => pt.abs!).reduce((s, e) => c.box(["Add", s.json, e.json]).simplify()) : null
  const total = parts.reduce((s, pt) => s + pt.absX, 0)
  const ans = exact ? tex(exact) : `${Math.round(total * 1e4) / 1e4}`
  steps.push({ text: "정리합니다.", latex: `\\text{움직인 거리}=${ans}\n\\text{위치의 변화량}=${valueTex(disp)}` })
  return ok("움직인 거리", ans, steps, exact ? approxOf(exact) : "근삿값")
}

// ───────────────────────── 곡선의 길이 ─────────────────────────

function pathLength(c: Calc, p: Parsed, title = "곡선의 길이"): SolveResult {
  const steps: Step[] = []
  let speed: Expression
  let v: string
  let a: Num
  let b: Num
  if (p.param) {
    v = p.param.t
    const lines = (p.bounds[v] ?? []).map((e) => boundNum(c, e)).sort((m, n) => m.x - n.x)
    if (lines.length < 2) return fail(`구간을 ${v}=a, ${v}=b 로 함께 넣어 주세요. 예) x=\\cos t, y=\\sin t, t=0, t=\\pi`)
    ;[a, b] = [lines[0], lines[lines.length - 1]]
    const xt = c.D(p.param.x, v)
    const yt = c.D(p.param.y, v)
    steps.push({ text: `x, y 를 ${v} 로 미분합니다.`, latex: `\\frac{dx}{d${v}}=${tex(xt)},\\quad \\frac{dy}{d${v}}=${tex(yt)}` })
    const inside = tidy(c, ["Add", ["Power", xt.json, 2], ["Power", yt.json, 2]])
    speed = c.box(["Sqrt", inside.json]).simplify()
    steps.push({ text: "근호 안을 정리합니다.", latex: `\\sqrt{\\left(\\frac{dx}{d${v}}\\right)^{2}+\\left(\\frac{dy}{d${v}}\\right)^{2}}=\\sqrt{${tex(inside)}}=${tex(speed)}` })
  } else {
    const cv = p.curves.find((k) => k.v === "x")
    if (!cv) return fail("곡선을 y=… 꼴로 넣어 주세요. 예) y=\\frac{2}{3}x^{3/2}, x=0, x=3")
    v = "x"
    const lines = (p.bounds.x ?? []).map((e) => boundNum(c, e)).sort((m, n) => m.x - n.x)
    if (lines.length < 2) return fail("구간을 x=a, x=b 로 함께 넣어 주세요.")
    ;[a, b] = [lines[0], lines[lines.length - 1]]
    const d = c.D(cv.expr, "x")
    steps.push({ text: "y 를 미분합니다.", latex: `y'=${tex(d)}` })
    const inside = tidy(c, ["Add", 1, ["Power", d.json, 2]])
    speed = c.box(["Sqrt", inside.json]).simplify()
    steps.push({ text: "근호 안을 정리합니다.", latex: `\\sqrt{1+(y')^{2}}=\\sqrt{${tex(inside)}}=${tex(speed)}` })
  }
  const val = definite(c, speed, v, a, b)
  steps.push({ text: `${title}는 이것을 적분한 값입니다.`, latex: `L=\\int_{${show(a)}}^{${show(b)}} ${tex(speed)}\\,d${v}` })
  if (val.F) steps.push({ text: "계산합니다.", latex: `=\\left[${tex(val.F)}\\right]_{${show(a)}}^{${show(b)}}=${valueTex(val)}` })
  else steps.push({ text: "정확한 식으로 적분되지 않아 수치 적분(심프슨 공식)으로 계산합니다.", latex: `\\approx ${Math.round(val.x * 1e4) / 1e4}` })
  return ok(title, val.exact ? tex(val.exact) : `${Math.round(val.x * 1e4) / 1e4}`, steps, val.exact ? approxOf(val.exact) : "근삿값")
}

// ───────────────────────── 접선 ─────────────────────────

function tangent(c: Calc, p: Parsed): SolveResult {
  const cv = p.curves.find((k) => k.v === "x")
  if (!cv) return fail("곡선을 y=… 꼴로 넣어 주세요. 예) y=e^x, x=0")
  const aExpr = p.bounds.x?.[0] ?? p.points[0]?.[0]
  if (!aExpr) return fail("접점의 x 좌표를 x=a 로, 또는 점 (a, b) 로 함께 넣어 주세요. 예) y=e^x, x=0")
  const f = cv.expr
  const fa = c.at(f, "x", aExpr)
  const d = c.D(f, "x")
  const m = c.at(d, "x", aExpr)
  const line = c.box(["Add", ["Multiply", m.json, ["Subtract", "x", aExpr.json]], fa.json]).simplify()
  const steps: Step[] = [
    { text: "접점의 y 좌표를 구합니다.", latex: `f(${tex(aExpr)})=${tex(fa)}\\quad\\Rightarrow\\quad \\left(${tex(aExpr)},\\ ${tex(fa)}\\right)` },
    { text: "미분해서 접점에서의 기울기를 구합니다.", latex: `f'(x)=${tex(d)},\\quad f'(${tex(aExpr)})=${tex(m)}` },
    { text: "y − f(a) = f'(a)(x − a) 에 넣습니다.", latex: `y-${wrap(fa)}=${wrap(m)}\\left(x-${wrap(aExpr)}\\right)` },
    { text: "정리합니다.", latex: `y=${tex(line)}` },
  ]
  // 점 (a, b) 가 주어졌으면 곡선 위의 점인지 확인
  const given = p.points[0]
  const check =
    given && Math.abs(Number(given[1].N().re) - Number(fa.N().re)) < 1e-9
      ? { text: "검산: 주어진 점이 곡선 위에 있습니다. ✓" }
      : given
        ? { text: `주의: 주어진 점의 y 좌표(${tex(given[1])})가 곡선 위의 값(${tex(fa)})과 다릅니다. 곡선 밖의 점에서 그은 접선 문제라면 접점을 (t, f(t)) 로 놓고 풀어야 합니다.` }
        : undefined
  return ok("접선의 방정식", `y=${tex(line)}`, steps, undefined, check)
}

const wrap = (e: Expression) => (/^-|[+-]/.test(tex(e).slice(1)) || tex(e).startsWith("-") ? `\\left(${tex(e)}\\right)` : tex(e))

// ───────────────────────── 극값 ─────────────────────────

function domainOf(c: Calc, p: Parsed): [number, number, boolean] {
  const lines = (p.bounds.x ?? []).map((e) => Number(e.N().re)).sort((a, b) => a - b)
  return lines.length >= 2 ? [lines[0], lines[lines.length - 1], true] : [-10, 10, false]
}

function extrema(c: Calc, p: Parsed): SolveResult {
  const cv = p.curves.find((k) => k.v === "x")
  if (!cv) return fail("함수를 y=… 또는 f(x)=… 꼴로 넣어 주세요. 예) y=x^3-3x")
  const f = cv.expr
  const d = c.D(f, "x")
  const [lo, hi, given] = domainOf(c, p)
  const rs = roots(c, d, "x", lo, hi)
  const steps: Step[] = [{ text: "미분합니다.", latex: `f'(x)=${tex(d)}` }]
  if (!rs.length) {
    steps.push({ text: `f'(x) = 0 인 x 가 ${given ? "주어진 구간에" : "−10 ≤ x ≤ 10 에"} 없습니다. 따라서 극값이 없습니다.` })
    return ok("극값", "\\text{극값 없음}", steps)
  }
  steps.push({ text: "f'(x) = 0 인 x 를 구합니다.", latex: `${tex(d)}=0\\quad\\Rightarrow\\quad x=${rs.map(show).join(",\\ ")}` })

  const eps = 1e-4
  const kinds = rs.map((r) => {
    const left = num(c, d, "x", r.x - eps)
    const right = num(c, d, "x", r.x + eps)
    const kind = left > 0 && right < 0 ? "극대" : left < 0 && right > 0 ? "극소" : "없음"
    const fv = r.exact ? c.at(f, "x", r.exact) : null
    return { r, kind, left, right, fv, fx: num(c, f, "x", r.x) }
  })
  steps.push({
    text: "그 앞뒤에서 f'(x) 의 부호를 확인합니다. (증감표)",
    latex: kinds
      .map((k) => `x=${show(k.r)}:\\ ${k.left > 0 ? "+" : "-"}\\to ${k.right > 0 ? "+" : "-"}\\ \\Rightarrow\\ \\text{${k.kind === "없음" ? "극값 아님" : k.kind}}`)
      .join("\n"),
  })
  const found = kinds.filter((k) => k.kind !== "없음")
  const val = (k: (typeof kinds)[number]) => (k.fv ? tex(k.fv) : `${Math.round(k.fx * 1e4) / 1e4}`)
  if (!found.length) {
    steps.push({ text: "부호가 바뀌는 점이 없어서 극값이 없습니다." })
    return ok("극값", "\\text{극값 없음}", steps)
  }
  steps.push({ text: "극값을 계산합니다.", latex: found.map((k) => `f(${show(k.r)})=${val(k)}`).join(",\\quad ") })
  const answer = found.map((k) => `\\text{${k.kind === "극대" ? "극댓값" : "극솟값"} }f(${show(k.r)})=${val(k)}`).join(",\\quad ")
  if (!given) steps.push({ text: "−10 ≤ x ≤ 10 범위에서 찾았습니다. 정해진 구간이 있으면 x=a, x=b 로 함께 넣어 주세요." })
  return ok("극값", answer, steps)
}

// ───────────────────────── 변곡점 ─────────────────────────

function inflection(c: Calc, p: Parsed): SolveResult {
  const cv = p.curves.find((k) => k.v === "x")
  if (!cv) return fail("함수를 y=… 꼴로 넣어 주세요. 예) y=x^3-3x^2")
  const f = cv.expr
  const d1 = c.D(f, "x")
  const d2 = c.D(d1, "x")
  const [lo, hi] = domainOf(c, p)
  const rs = roots(c, d2, "x", lo, hi)
  const steps: Step[] = [{ text: "두 번 미분합니다.", latex: `f'(x)=${tex(d1)},\\quad f''(x)=${tex(d2)}` }]
  if (!rs.length) {
    steps.push({ text: "f''(x) = 0 인 x 가 없어서 변곡점이 없습니다." })
    return ok("변곡점", "\\text{변곡점 없음}", steps)
  }
  steps.push({ text: "f''(x) = 0 인 x 를 구합니다.", latex: `${tex(d2)}=0\\quad\\Rightarrow\\quad x=${rs.map(show).join(",\\ ")}` })
  const eps = 1e-4
  const pts = rs.map((r) => {
    const changes = num(c, d2, "x", r.x - eps) * num(c, d2, "x", r.x + eps) < 0
    const fv = r.exact ? c.at(f, "x", r.exact) : null
    return { r, changes, y: fv ? tex(fv) : `${Math.round(num(c, f, "x", r.x) * 1e4) / 1e4}` }
  })
  steps.push({
    text: "그 앞뒤에서 f''(x) 의 부호가 바뀌는지 확인합니다. (바뀌면 변곡점)",
    latex: pts.map((q) => `x=${show(q.r)}:\\ \\text{${q.changes ? "부호 바뀜 → 변곡점" : "부호 안 바뀜"}}`).join("\n"),
  })
  const real = pts.filter((q) => q.changes)
  if (!real.length) return ok("변곡점", "\\text{변곡점 없음}", steps)
  const answer = real.map((q) => `\\left(${show(q.r)},\\ ${q.y}\\right)`).join(",\\ ")
  steps.push({ text: "변곡점의 좌표", latex: answer })
  return ok("변곡점", answer, steps)
}

// ───────────────────────── 입구 ─────────────────────────

/** 추천 접근법에 활용 문제가 있으면 풀고, 아니면 null (일반 풀이로 넘김) */
export function solveApplied(c: Calc, e: Expression, methods: string[]): SolveResult | null {
  const has = (name: string) => methods.some((m) => m.includes(name))
  const kind = has("넓이:")
    ? "넓이"
    : has("부피:")
      ? "부피"
      : has("속도와 거리")
        ? "거리"
        : has("곡선의 길이")
          ? "길이"
          : has("접선의 방정식")
            ? "접선"
            : has("극값")
              ? "극값"
              : has("변곡점")
                ? "변곡점"
                : null
  if (!kind) return null
  // ∫ 를 직접 쓴 식이면 일반 적분 풀이로
  if (e.operator === "Integrate" || e.operator === "Limit" || e.operator === "D") return null
  const p = parse(e)
  if (!p.curves.length && !p.param) return fail(CANNOT)
  switch (kind) {
    case "넓이":
      return area(c, p)
    case "부피":
      return volume(c, p)
    case "거리":
      return motion(c, p)
    case "길이":
      return pathLength(c, p)
    case "접선":
      return tangent(c, p)
    case "극값":
      return extrema(c, p)
    case "변곡점":
      return inflection(c, p)
  }
  return null
}
