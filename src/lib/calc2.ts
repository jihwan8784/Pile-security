/**
 * 미적분2 풀이 접근법 도우미 (규칙 기반)
 *
 * 식을 "푸는" 것이 아니라, 식의 모양(패턴)을 보고 어떤 방법으로 접근해야 하는지 알려 준다.
 * - 모든 분석은 브라우저 안에서 일어난다. (서버·AI로 식을 보내지 않음)
 * - 입력은 평범한 글자(예: lim x->0 sin(3x)/x)와 LaTeX(예: \int x e^{x} dx) 둘 다 받는다.
 *
 * 흐름: normalize(입력) → 특징 찾기(features) → 주제 판단(극한/급수/미분/적분/활용) → 접근법 목록
 */

export type Topic = "극한" | "급수" | "미분" | "적분" | "정적분의 활용" | "알 수 없음"

export type Method = {
  /** 접근법 이름 (예: 부분적분) */
  name: string
  /** 왜 이 방법인지: 식에서 찾은 근거 */
  why: string
  /** 풀이 순서 */
  steps: string[]
  /** 핵심 공식 (있으면). LaTeX, 여러 줄이면 \n 으로 구분 */
  formula?: string
}

export type Analysis = {
  /** 분석에 사용한 정리된 식 */
  normalized: string
  topic: Topic
  methods: Method[]
  /** 주의할 점 */
  cautions: string[]
}

// ───────────────────────── 1. 입력 정리 ─────────────────────────

/** LaTeX·특수 기호·한글 표현을 분석하기 쉬운 한 가지 표기로 맞춘다 */
export function normalize(input: string): string {
  let s = input.normalize("NFC")

  // LaTeX: 띄어쓰기 명령, \left \right 제거, 수식 입력창(MathLive)이 쓰는 명령 정리
  s = s
    .replace(/\\(left|right|mleft|mright|displaystyle|limits|big|Big)\b/g, "")
    .replace(/\\[,;:! ]|\\quad|\\qquad/g, " ")
    .replace(/\\placeholder\s*(\[[^\]]*\])?\s*\{[^{}]*\}/g, "")
    .replace(/\\exponentialE\b/g, "e")
    .replace(/\\differentialD\b/g, "d")
    .replace(/\\(lvert|rvert|vert|mid)\b/g, "|")
    .replace(/\\mathrm\s*\{\s*d\s*\}/g, "d")
    .replace(/\\(operatorname|mathrm|mathit)\s*\{([a-zA-Z]+)\}/g, "$2")
    .replace(/\\text\s*\{([^{}]*)\}/g, " $1 ")
  // 안쪽 중괄호부터 차례로 바꿈: x^{..} → x^(..), \sqrt{..} → √(..), \frac{a}{b} → ((a)/(b))
  for (let i = 0; i < 20; i++) {
    const next = s
      .replace(/([\^_])\s*\{([^{}]*)\}/g, "$1($2)")
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, "(($2)^(1/($1)))")
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "(($1)/($2))")
      .replace(/\\[dt]?frac\s*(\d)\s*(\d)/g, "($1/$2)") // \frac12
    if (next === s) break
    s = next
  }
  s = s
    .replace(/\\sqrt/g, "√")
    .replace(/\\int/g, "∫")
    .replace(/\\lim/g, "lim")
    .replace(/\\sum/g, "Σ")
    .replace(/\\infty/g, "∞")
    // 명령 이름 바로 뒤에 숫자·글자가 붙어 와도(\to0, \pi\sin) 알아보도록 (?![a-zA-Z]) 로 끝을 판단
    .replace(/\\(to|rightarrow|longrightarrow)(?![a-zA-Z])/g, "→")
    .replace(/\\pi(?![a-zA-Z])/g, "π ")
    .replace(/\\theta(?![a-zA-Z])/g, "θ ")
    .replace(/\\(cdot|times)(?![a-zA-Z])/g, "*")
    .replace(/\\([a-zA-Z]+)/g, "$1 ") // 나머지 \sin \ln 등은 이름만 남기고 뒤에 띄어쓰기
    .replace(/[{]/g, "(")
    .replace(/[}]/g, ")")

  // 특수 기호 통일
  s = s
    .replace(/[−–—]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/⁻¹/g, "^(-1)")
    .replace(/-+>|⟶|⇒|=>/g, "→")
    .replace(/∑/g, "Σ")
    .replace(/∞|infinity|\binf\b|무한대/gi, "∞")
    .replace(/\bsqrt\b/gi, "√")
    .replace(/\bintegral\b|인테그랄/gi, "∫")
    .replace(/\bsum\b/gi, "Σ")
    .replace(/\bpi\b/gi, "π")
    .replace(/\bexp\s*\(/gi, "e^(")
    .replace(/[A-Z]/g, (c) => c.toLowerCase())

  // 글자 하나짜리 괄호 풀기: e^(x) → e^x, ((1)/(n)) → (1/n)  (sin(x) 처럼 함수 이름 뒤 괄호는 둠)
  for (let i = 0; i < 10; i++) {
    // 뒤에 글자가 바로 오면 붙지 않게 띄어쓰기 하나를 남긴다 (^(π)sin → ^π sin)
    const next = s.replace(/(^|[^a-z])\(\s*([a-z0-9.∞π]+)\s*\)/g, (m, pre: string, atom: string, at: number, all: string) =>
      pre + atom + (/[a-z√∫]/.test(all[at + m.length] ?? "") ? " " : ""),
    )
    if (next === s) break
    s = next
  }

  return s.replace(/\s+/g, " ").trim()
}

// ───────────────────────── 2. 특징 찾기 ─────────────────────────

/** 적분 구간 ∫_a^b : 끝값 하나는 (괄호 묶음) | 숫자 | π | 문자 하나 | ∞ */
const BOUND = String.raw`(\([^()]*\)|-?[\d.]+\s*π?|-?π|-?[a-z]|∞)`
const BOUNDS = new RegExp(String.raw`∫\s*_\s*${BOUND}\s*\^\s*${BOUND}`)

type Features = ReturnType<typeof features>

function features(s: string) {
  const has = (re: RegExp) => re.test(s)

  // 극한: lim x→0, lim_(n→∞), x→a 형태
  const limMatch = s.match(/([a-zθ])\s*→\s*(-?\s*∞|[+-]?[\d.]+[+-]?|π\/?\d*|[a-z])/)
  const limVar = limMatch?.[1] ?? null
  const limTo = limMatch?.[2]?.replace(/\s/g, "") ?? null

  // 적분 구간: ∫_(a)^(b) 또는 ∫_a^b
  const bounds = s.match(BOUNDS)
  const unwrap = (b?: string) => b?.replace(/^\((.*)\)$/, "$1").replace(/\s/g, "") ?? null
  const lo = unwrap(bounds?.[1])
  const hi = unwrap(bounds?.[2])

  // 미분·적분 변수: d/dx, dx, dt …
  const dVar = s.match(/d\s*\/\s*d([a-zθ])/)?.[1] ?? s.match(/(?:^|[\s)*])d([a-zθ])\s*$/)?.[1] ?? null
  const v = dVar ?? limVar ?? (has(/\bt\b/) && !has(/x/) ? "t" : "x")

  const trig = has(/sin|cos|tan|sec|csc|cot/)
  const exp = has(/e\s*\^|\b\d+\s*\^\s*\(?[a-z]/) // e^x, 2^x
  const ln = has(/\bln|\blog/)
  const sqrt = has(/√/)

  return {
    s,
    lim: has(/\blim\b|극한/) || !!limMatch,
    limVar,
    limTo,
    sum: has(/Σ|급수/),
    int: has(/∫|적분|넓이|부피/),
    definite: !!bounds || has(/정적분/),
    lo,
    hi,
    symmetric: !!lo && !!hi && lo.replace(/^-/, "") === hi && lo.startsWith("-"),
    deriv: has(/d\s*\/\s*d[a-z]|d\s*y\s*\/\s*d\s*x|미분|도함수|기울기|접선/) || /[a-z)]\s*'/.test(s),
    second: has(/''|d\s*\^?\s*2\s*y|이계/),
    implicit: has(/=/) && has(/y/) && !has(/^\s*y\s*=/) && has(/x/) && !has(/x\s*=.*t/),
    parametric: (has(/x\s*=[^,]*t/) && has(/y\s*=[^,]*t/)) || has(/매개변수/),
    inverse: has(/역함수|\^\s*\(\s*-\s*1\s*\)\s*\(/) || has(/f\s*\^\s*-\s*1/),
    defFunc: /x/.test(hi ?? "") || /x/.test(lo ?? ""), // 위끝·아래끝에 x
    trig,
    exp,
    ln,
    sqrt,
    abs: has(/\|/),
    v,
    words: {
      area: has(/넓이/),
      volume: has(/부피/),
      motion: has(/속도|속력|가속도|거리|위치|이동/),
      length: has(/길이/),
      tangent: has(/접선/),
      extremum: has(/극대|극소|최대|최소|증가|감소|극값/),
      concavity: has(/변곡점|오목|볼록/),
    },
  }
}

// 자주 쓰는 패턴 (v = 변수)
const re = (src: string, v: string) => new RegExp(src.replaceAll("V", v))

/** e^(..), sin(..) 같은 함수 안에 일차식보다 복잡한 식이 들어 있나 */
function hasInnerFunction(f: Features) {
  const { s, v } = f
  return (
    re("(e|\\d)\\s*\\^\\s*\\(?[^)]*V\\s*\\^", v).test(s) || // e^(x^2)
    re("(sin|cos|tan|ln|log|√)\\s*\\^?\\d*\\s*\\(?\\s*[^)]*V\\s*\\^", v).test(s) || // sin(x^2), ln(x^2+1), √(x^2+1)
    re("(sin|cos|tan|e\\s*\\^)\\s*\\(?\\s*(sin|cos|tan|ln)", v).test(s) || // e^(sin x)
    re("\\(([^()]*V[^()]*[+-][^()]*)\\)\\s*\\^\\s*\\(?\\s*\\d", v).test(s) || // (x^2+1)^5
    re("√\\s*\\(\\s*[^)]*V[^)]*[+-]", v).test(s) || // √(1 - x)
    re("(sin|cos|tan|ln|e\\s*\\^)\\s*\\(?\\s*\\d+\\s*V", v).test(s) // sin(3x)
  )
}

/** 다항식(x, x^2, 3x …)이 다른 종류의 함수와 곱해져 있나 */
function polyTimesOther(f: Features) {
  const { s, v } = f
  const poly = re("(^|[^a-z^])\\d*\\s*V(\\s*\\^\\s*\\d+)?\\s*\\*?\\s*(e\\s*\\^|sin|cos|ln|log)", v).test(s)
  // eˣ·x, sin x·x 처럼 다항식이 뒤에 오는 경우 (지수·괄호 부분이 반드시 있어야 함)
  const polyAfter = re("(e\\s*\\^\\s*(\\([^)]*\\)|[a-z\\d]+)|(sin|cos)\\s*(\\([^)]*\\)|[a-z\\d]+))\\s*\\*?\\s*\\d*V(\\s*\\^\\s*\\d+)?(?=\\s*(\\*|$|d[a-z]\\b|[)+-]))", v).test(s)
  return poly || polyAfter
}

// ───────────────────────── 3. 주제별 접근법 ─────────────────────────

const CAUTION_LHOPITAL =
  "로피탈 정리는 고등학교 교육과정 밖입니다. 검산용으로만 쓰고, 서술형 답안에는 교과서 방법(기본 극한·인수분해·유리화)으로 쓰세요."

function limitMethods(f: Features, out: Method[], cautions: string[]) {
  const { s, limTo } = f
  const toInf = !!limTo && /∞/.test(limTo)
  const toZero = !!limTo && /^[+-]?0[+-]?$/.test(limTo)

  if (f.sum && (/k\s*\/\s*n/.test(s) || /1\s*\/\s*n/.test(s))) {
    out.push({
      name: "구분구적법 → 정적분으로 바꾸기",
      why: "lim n→∞ Σ 안에 k/n 과 1/n 이 함께 있습니다.",
      steps: [
        "k/n 을 x 로, 1/n 을 dx 로 봅니다.",
        "k = 1 ~ n 이면 x 의 범위는 0 ~ 1 입니다. (a + (b−a)k/n 꼴이면 a ~ b)",
        "Σ 안의 식을 f(x) 로 바꿔서 정적분을 계산합니다.",
      ],
      formula: String.raw`\lim_{n\to\infty}\sum_{k=1}^{n} f\left(a+\frac{(b-a)k}{n}\right)\frac{b-a}{n}` + "\n" + String.raw`=\int_a^b f(x)\,dx`,
    })
    return
  }

  if (toInf && /\(\s*1\s*\+\s*\(?[^()]*\/\s*[a-z]\s*\)?\s*\)\s*\^/.test(s)) {
    out.push({
      name: "e 의 정의 이용",
      why: "(1 + □/n)^n 꼴이 보입니다.",
      steps: ["지수를 □ 의 역수 × (나머지) 로 쪼갭니다.", "기본 극한 lim(1 + 1/n)^n = e 꼴로 맞춥니다."],
      formula: String.raw`\lim_{n\to\infty}\left(1+\frac{1}{n}\right)^{n}=e,\quad \lim_{n\to\infty}\left(1+\frac{a}{n}\right)^{n}=e^{a}`,
    })
  }

  if (toInf && /(\d|\(|[a-z])\s*\^\s*\(?\s*n/.test(s) && !/e\s*\^\s*\(?\s*n/.test(s)) {
    out.push({
      name: "등비수열의 극한",
      why: "n 이 지수에 있는 rⁿ 꼴이 있습니다.",
      steps: [
        "분모에서 밑의 절댓값이 가장 큰 거듭제곱으로 분자·분모를 나눕니다.",
        "|r| < 1 이면 rⁿ → 0, r = 1 이면 1, r > 1 이면 발산, r ≤ −1 이면 진동입니다.",
        "밑에 x 같은 문자가 있으면 |x| < 1, x = 1, x = −1, |x| > 1 로 범위를 나눠 따로 구합니다.",
      ],
      formula: String.raw`\lim_{n\to\infty} r^{n}=0\ \ (|r|<1),\quad \lim_{n\to\infty} r^{n}=1\ \ (r=1)`,
    })
  }

  if (toZero) {
    if (/sin|tan/.test(s)) {
      out.push({
        name: "삼각함수 기본 극한",
        why: "x → 0 이고 sin 또는 tan 이 있습니다.",
        steps: [
          "sin(□) 아래에 같은 □ 가 오도록 분모·분자에 같은 수를 곱하고 나눕니다.",
          "sin□/□ → 1, tan□/□ → 1 을 적용합니다.",
        ],
        formula: String.raw`\lim_{x\to0}\frac{\sin x}{x}=1,\quad \lim_{x\to0}\frac{\tan x}{x}=1` + "\n" + String.raw`\lim_{x\to0}\frac{\sin ax}{bx}=\frac{a}{b}`,
      })
    }
    if (/1\s*-\s*cos|cos[^-]*-\s*1/.test(s)) {
      out.push({
        name: "1 − cos x 는 켤레식 곱하기",
        why: "1 − cos x 꼴이 있습니다.",
        steps: ["분모·분자에 (1 + cos x) 를 곱합니다.", "1 − cos²x = sin²x 로 바꾼 뒤 sin x / x → 1 을 씁니다."],
        formula: String.raw`\lim_{x\to0}\frac{1-\cos x}{x^{2}}=\frac{1}{2}`,
      })
    }
    if (/e\s*\^/.test(s) && /-\s*1/.test(s)) {
      out.push({
        name: "지수함수 기본 극한",
        why: "x → 0 이고 eˣ − 1 꼴이 있습니다.",
        steps: ["지수 부분과 분모가 같은 꼴이 되도록 곱하고 나눕니다.", "(e□ − 1)/□ → 1 을 적용합니다."],
        formula: String.raw`\lim_{x\to0}\frac{e^{x}-1}{x}=1,\quad \lim_{x\to0}\frac{a^{x}-1}{x}=\ln a`,
      })
    }
    if (/ln|log/.test(s)) {
      out.push({
        name: "로그함수 기본 극한",
        why: "x → 0 이고 ln(1 + □) 꼴이 있습니다.",
        steps: ["ln(1 + □) 아래에 □ 가 오도록 맞춥니다.", "ln(1 + □)/□ → 1 을 적용합니다."],
        formula: String.raw`\lim_{x\to0}\frac{\ln(1+x)}{x}=1`,
      })
    }
    if (/\(\s*1\s*\+[^)]*\)\s*\^\s*\(?\s*1\s*\//.test(s)) {
      out.push({
        name: "e 의 정의 이용",
        why: "(1 + x)^(1/x) 꼴이 있습니다.",
        steps: ["괄호 안의 □ 와 지수의 1/□ 가 짝이 되도록 지수를 정리합니다."],
        formula: String.raw`\lim_{x\to0}(1+x)^{\frac{1}{x}}=e`,
      })
    }
  }

  if (limTo && !toZero && !toInf && /sin|cos|tan/.test(s)) {
    out.push({
      name: "치환해서 0 으로 가는 극한으로 바꾸기",
      why: `x → ${limTo} 인데 삼각함수가 있습니다. 기본 극한은 → 0 일 때만 쓸 수 있습니다.`,
      steps: [`t = x − ${limTo} 로 놓으면 t → 0 이 됩니다.`, "삼각함수 덧셈정리로 정리한 뒤 sin t / t → 1 을 씁니다."],
    })
  }

  if (toInf && (f.exp || f.ln)) {
    out.push({
      name: "증가 속도 비교 / 역수 치환",
      why: "x → ∞ 이고 지수·로그함수가 있습니다.",
      steps: [
        "가장 빨리 커지는 항으로 분모·분자를 나눕니다. (지수함수 ≫ 다항함수 ≫ 로그함수)",
        "또는 t = 1/x 로 치환해 t → 0 극한으로 바꿉니다.",
        "ln 이 여러 개면 로그의 성질로 하나로 합칩니다.",
      ],
    })
  }

  if (f.sqrt) {
    out.push({
      name: "유리화",
      why: "√ 가 있어 ∞ − ∞ 또는 0/0 꼴이 되기 쉽습니다.",
      steps: ["√ 가 있는 쪽의 켤레식을 분모·분자에 곱합니다.", "정리한 뒤 대입하거나 최고차항으로 나눕니다."],
    })
  }

  if (out.length === 0) {
    out.push({
      name: toInf ? "최고차항으로 나누기" : "대입 → 부정형이면 인수분해",
      why: toInf ? "x(또는 n) → ∞ 인 분수식입니다." : "먼저 값을 대입해 0/0 꼴인지 확인합니다.",
      steps: toInf
        ? ["분모의 최고차항으로 분자·분모를 나눕니다.", "1/x → 0 을 이용합니다."]
        : ["대입해서 값이 나오면 끝입니다.", "0/0 이면 분자·분모를 인수분해해서 약분합니다."],
    })
  }

  if (/\b[ab]\b/.test(s.replace(/lim|ln|tan|cos|sin|abs/g, ""))) {
    out.push({
      name: "미정계수 결정",
      why: "식에 상수 a, b 가 있습니다.",
      steps: [
        "극한값이 존재하고 (분모) → 0 이면 반드시 (분자) → 0 입니다.",
        "이 조건으로 식을 하나 세우고, 극한값으로 나머지를 구합니다.",
      ],
    })
  }

  cautions.push(CAUTION_LHOPITAL)
}

function seriesMethods(f: Features, out: Method[]) {
  const { s } = f
  if (/(\d|\))\s*\^\s*\(?\s*(n|k)/.test(s)) {
    out.push({
      name: "등비급수",
      why: "Σ 안에 rⁿ 꼴이 있습니다.",
      steps: ["첫째항 a 와 공비 r 을 찾습니다.", "|r| < 1 인지 확인합니다. (수렴 조건)", "합은 a/(1 − r) 입니다."],
      formula: String.raw`\sum_{n=1}^{\infty} ar^{n-1}=\frac{a}{1-r}\quad(-1<r<1)`,
    })
  }
  // 분모가 n(n+1), (2n-1)(2n+1) 처럼 두 일차식의 곱
  const twoLinear =
    /\/\s*\(*\s*[nk]\s*\*?\s*\(\s*[nk]\s*[+-]/.test(s) ||
    /\(\s*\d*\s*[nk]\s*[+-]\s*\d+\s*\)\s*\*?\s*\(\s*\d*\s*[nk]\s*[+-]\s*\d+\s*\)/.test(s)
  if (/\//.test(s) && twoLinear) {
    out.push({
      name: "부분분수로 쪼개서 소거 (망원급수)",
      why: "분모가 두 일차식의 곱입니다.",
      steps: [
        "1/(AB) = (1/(B − A))·(1/A − 1/B) 로 쪼갭니다.",
        "부분합 Sₙ 을 써 보면 가운데 항들이 지워집니다.",
        "남은 항으로 lim Sₙ 을 구합니다.",
      ],
    })
  }
  if (/√/.test(s)) {
    out.push({
      name: "유리화 후 소거",
      why: "분모에 √ 의 합이 있습니다.",
      steps: ["분모를 유리화하면 √(n+1) − √n 같은 차가 됩니다.", "부분합에서 소거한 뒤 극한을 구합니다."],
    })
  }
  out.push({
    name: "부분합의 극한 / 발산 판정",
    why: "급수의 합은 부분합 Sₙ 의 극한입니다.",
    steps: [
      "Sₙ 을 n 에 대한 식으로 구한 뒤 lim Sₙ 을 계산합니다.",
      "lim aₙ ≠ 0 이면 바로 발산이라고 쓸 수 있습니다. (역은 성립하지 않음)",
    ],
  })
}

function derivMethods(f: Features, out: Method[]) {
  const { s, v } = f

  if (f.int && f.defFunc) {
    out.push({
      name: "정적분으로 정의된 함수의 미분",
      why: "적분의 위끝(또는 아래끝)에 변수가 있습니다.",
      steps: [
        "d/dx ∫ₐˣ f(t) dt = f(x) 를 씁니다.",
        "위끝이 g(x) 이면 f(g(x))·g'(x) 입니다.",
        "적분 안에 x 가 섞여 있으면 x 를 적분 밖으로 꺼낸 다음 곱의 미분을 합니다.",
        "x = a (위끝 = 아래끝) 를 대입하면 적분값이 0 이 되는 것도 함께 씁니다.",
      ],
      formula: String.raw`\frac{d}{dx}\int_a^{g(x)} f(t)\,dt=f(g(x))\,g'(x)`,
    })
  }
  if (f.parametric) {
    out.push({
      name: "매개변수로 나타낸 함수의 미분",
      why: "x 와 y 가 모두 t 에 대한 식입니다.",
      steps: ["dx/dt, dy/dt 를 각각 구합니다.", "dy/dx = (dy/dt)/(dx/dt) 입니다. (dx/dt ≠ 0)", "특정 점이면 그 점의 t 값을 먼저 찾아 대입합니다."],
      formula: String.raw`\frac{dy}{dx}=\dfrac{\ \frac{dy}{dt}\ }{\ \frac{dx}{dt}\ }`,
    })
  }
  if (f.implicit && !f.parametric) {
    out.push({
      name: "음함수의 미분",
      why: "y 를 x 에 대한 식으로 풀기 어려운 등식입니다.",
      steps: [
        "양변을 x 에 대해 미분합니다.",
        "y 가 들어 있는 항은 미분한 뒤 dy/dx 를 곱합니다. (예: (y²)' = 2y·dy/dx)",
        "dy/dx 를 한쪽으로 모아 정리합니다.",
      ],
    })
  }
  if (f.inverse) {
    out.push({
      name: "역함수의 미분",
      why: "역함수가 등장합니다.",
      steps: ["g = f⁻¹ 이고 g(b) = a 이면 f(a) = b 인 a 를 먼저 찾습니다.", "g'(b) = 1 / f'(a) 를 계산합니다."],
      formula: String.raw`\left(f^{-1}\right)'(b)=\frac{1}{f'(a)}\quad\left(f(a)=b\right)`,
    })
  }
  if (re("V\\s*\\^\\s*(\\([^()]*V[^()]*\\)|V\\b)|\\)\\s*\\^\\s*(\\([^()]*V[^()]*\\)|V\\b)", v).test(s) && !/e\s*\^/.test(s)) {
    out.push({
      name: "로그 미분법",
      why: "밑과 지수에 모두 변수가 있습니다. (예: xˣ)",
      steps: ["양변에 ln 을 취합니다: ln y = g(x)·ln f(x)", "양변을 미분합니다: y'/y = (우변)'", "y' = y × (우변)' 으로 정리합니다."],
    })
  }

  // d/dx, dy/dx, d²y/dx² 같은 미분 기호는 분수가 아니므로 지우고 본다
  const body = s.replace(/d\s*(\^\s*2\s*)?[a-z]?\s*\/\s*d\s*[a-z](\s*\^\s*2)?/g, "")
  if (re("\\/\\s*\\(?[^)]*V|\\/\\s*(sin|cos|tan|ln|e)", v).test(body) && !f.parametric) {
    out.push({
      name: "몫의 미분",
      why: "분모에 변수가 있는 분수함수입니다.",
      steps: ["분자를 f, 분모를 g 로 놓습니다.", "(f/g)' = (f'g − fg')/g² 를 씁니다.", "분자가 상수면 (1/g)' = −g'/g² 가 더 빠릅니다."],
      formula: String.raw`\left(\frac{f}{g}\right)'=\frac{f'g-fg'}{g^{2}}`,
    })
  }
  if (polyTimesOther(f) || /(e\s*\^[^*]*\*?\s*(sin|cos))|((sin|cos)[^*]*\*?\s*e\s*\^)/.test(body) || /(sin|cos)[^+-]*\*?\s*(ln)/.test(body)) {
    out.push({
      name: "곱의 미분",
      why: "서로 다른 종류의 함수가 곱해져 있습니다.",
      steps: ["앞 함수를 f, 뒤 함수를 g 로 놓습니다.", "(fg)' = f'g + fg' 를 씁니다."],
      formula: String.raw`(fg)'=f'g+fg'`,
    })
  }
  if (hasInnerFunction(f)) {
    out.push({
      name: "합성함수의 미분 (연쇄법칙)",
      why: "함수 안에 또 다른 식이 들어 있습니다. (예: sin(x²), e^(3x), ln(x²+1))",
      steps: ["바깥 함수와 안쪽 식을 나눕니다.", "바깥 함수를 미분하고(안쪽은 그대로), 안쪽 식의 미분을 곱합니다."],
      formula: String.raw`\left\{f(g(x))\right\}'=f'(g(x))\,g'(x)`,
    })
  }

  const basics: string[] = []
  if (f.exp) basics.push(String.raw`(e^{x})'=e^{x},\quad (a^{x})'=a^{x}\ln a`)
  if (f.ln) basics.push(String.raw`(\ln x)'=\frac{1}{x},\quad (\ln|f(x)|)'=\frac{f'(x)}{f(x)},\quad (\log_a x)'=\frac{1}{x\ln a}`)
  if (f.trig) basics.push(String.raw`(\sin x)'=\cos x,\quad (\cos x)'=-\sin x,\quad (\tan x)'=\sec^{2}x`)
  if (basics.length) {
    out.push({
      name: "기본 도함수 공식",
      why: "식에 들어 있는 함수의 미분 공식입니다.",
      steps: ["아래 공식을 위 방법과 함께 씁니다."],
      formula: basics.join("\n"),
    })
  }

  if (out.length === 0 || (out.length === 1 && out[0].name === "기본 도함수 공식")) {
    out.unshift({
      name: "항별로 기본 공식 적용",
      why: "합·차로 이루어진 간단한 식입니다.",
      steps: ["항마다 따로 미분합니다. (상수배는 앞으로)", "xⁿ 은 nxⁿ⁻¹ 로 미분합니다."],
      formula: String.raw`(x^{n})'=nx^{n-1},\quad \{f\pm g\}'=f'\pm g',\quad \{cf\}'=cf'`,
    })
  }

  if (f.second) {
    out.push({
      name: "이계도함수",
      why: "두 번 미분하는 문제입니다.",
      steps: ["먼저 f'(x) 를 깔끔하게 정리한 뒤 한 번 더 미분합니다.", "매개변수면 d²y/dx² = d/dt(dy/dx) ÷ (dx/dt) 입니다."],
    })
  }
}

function integralMethods(f: Features, out: Method[], cautions: string[]) {
  const { s, v } = f
  const body = s.replace(BOUNDS, "∫")

  if (f.defFunc && !f.deriv) {
    out.push({
      name: "정적분으로 정의된 함수",
      why: "적분의 위끝(또는 아래끝)에 x 가 있습니다.",
      steps: [
        "양변을 x 에 대해 미분합니다. (d/dx ∫ₐˣ f(t)dt = f(x))",
        "x = a 를 대입하면 ∫ₐᵃ = 0 이라서 상수를 구할 수 있습니다.",
      ],
    })
  }
  if (/f\s*\(\s*x\s*\)\s*=.*∫\s*_\s*\(?\s*\d/.test(s) && !f.defFunc) {
    out.push({
      name: "정적분 = 상수로 놓기",
      why: "f(x) 식 안에 구간이 숫자인 정적분이 있습니다.",
      steps: ["∫ₐᵇ f(t) dt = k (상수) 로 놓습니다.", "f(x) 를 k 로 나타낸 뒤 다시 ∫ₐᵇ 에 넣어 k 를 구합니다."],
    })
  }

  // f'(x)/f(x) 꼴
  const fracDeriv =
    re("V\\s*\\/\\s*\\(\\s*V\\s*\\^\\s*2", v).test(body) || // x/(x^2+1)
    re("\\d*\\s*V\\s*\\/\\s*\\(\\s*\\d*\\s*V\\s*\\^\\s*2", v).test(body) ||
    /e\s*\^\s*\(?[a-z]\)?\s*\/\s*\(\s*\d*\s*[+-]?\s*e\s*\^/.test(body) ||
    /e\s*\^\s*\(?[a-z]\)?\s*\/\s*\(\s*e\s*\^[^)]*[+-]/.test(body) ||
    /cos[^/]*\/\s*\(?\s*sin|sin[^/]*\/\s*\(?\s*cos/.test(body) ||
    /\btan\b/.test(body) && !/tan\s*\^\s*2/.test(body)
  if (fracDeriv) {
    out.push({
      name: "f'(x)/f(x) 꼴 → ln|f(x)|",
      why: "분자가 분모를 미분한 꼴(또는 그 상수배)입니다.",
      steps: ["분모를 미분해서 분자와 비교합니다.", "모자란 상수는 앞으로 빼서 맞춥니다.", "∫ f'(x)/f(x) dx = ln|f(x)| + C"],
      formula: String.raw`\int\frac{f'(x)}{f(x)}\,dx=\ln|f(x)|+C` + "\n" + String.raw`\int\tan x\,dx=-\ln|\cos x|+C`,
    })
  }

  // 치환적분: 안쪽 식의 도함수가 바깥에 곱해져 있음
  const subst =
    (re("V\\s*\\*?\\s*(e|sin|cos|√|\\()[^]*V\\s*\\^\\s*2", v).test(body) && hasInnerFunction(f)) || // x e^(x^2), x√(x^2+1)
    re("(e|sin|cos|√)[^]*V\\s*\\^\\s*2[^]*\\)\\s*\\*?\\s*V(\\s|$|d)", v).test(body) || // e^(x^2)·x
    /ln[^/]*\/\s*\(?\s*[a-z]\s*\)?(\s|$|d)/.test(body) || // ln x / x
    /\(?\s*ln\s*\(?\s*[a-z]\s*\)?\s*\)?\s*\^\s*\d+\s*\/\s*[a-z]/.test(body) ||
    /sin\s*\^?\s*\d*\s*\(?[a-z]\)?\s*\*?\s*cos|cos\s*\^?\s*\d*\s*\(?[a-z]\)?\s*\*?\s*sin/.test(body) || // sin x cos x
    /e\s*\^\s*\(?\s*(sin|cos|tan)/.test(body) || // e^(sin x)
    /(sin|cos)\s*\(?\s*e\s*\^/.test(body) ||
    (/e\s*\^\s*\(?[a-z]\)?/.test(body) && /\/\s*\(\s*\d*\s*[+-]?\s*e\s*\^/.test(body) && !fracDeriv)
  if (subst) {
    out.push({
      name: "치환적분",
      why: "안쪽 식과, 그 안쪽 식을 미분한 꼴이 함께 곱해져 있습니다.",
      steps: [
        "안쪽 식(또는 ln x, sin x, eˣ 같은 덩어리)을 t 로 놓습니다.",
        "dt = (안쪽 식)' dx 로 dx 를 바꿉니다. 모자란 상수는 곱하고 나눠 맞춥니다.",
        f.definite ? "정적분이면 위끝·아래끝도 t 값으로 바꿉니다. (다시 x 로 돌리지 않아도 됨)" : "t 에 대해 적분한 뒤 t 를 다시 x 식으로 바꿉니다.",
      ],
      formula: String.raw`\int f(g(x))\,g'(x)\,dx=\int f(t)\,dt\quad(t=g(x))`,
    })
  }

  // 부분적분
  const lnAlone = /∫\s*\(?\s*ln\s*\(?\s*[a-z]\s*\)?\s*\)?\s*d[a-z]/.test(body)
  const expTrig = /(e\s*\^[^*]*\*?\s*(sin|cos))|((sin|cos)[^*]*\*?\s*e\s*\^)/.test(body)
  const polyLn = re("V\\s*(\\^\\s*\\d+)?\\s*\\*?\\s*ln|ln\\s*\\(?\\s*V\\s*\\)?\\s*\\*?\\s*V", v).test(body)
  if (!subst && (polyTimesOther(f) || lnAlone || expTrig || polyLn)) {
    const highDeg = re("V\\s*\\^\\s*[2-9]", v).test(body) && !polyLn
    out.push({
      name: "부분적분",
      why: lnAlone
        ? "ln x 하나만 있을 때는 1 × ln x 로 보고 부분적분합니다."
        : expTrig
          ? "eˣ 와 삼각함수의 곱입니다."
          : "서로 다른 종류의 함수가 곱해져 있습니다.",
      steps: expTrig
        ? [
            "eˣ 를 적분할 쪽으로 정하고 부분적분을 두 번 합니다.",
            "처음 구하려던 적분이 다시 나타나면 I 로 놓고 이항해서 I 를 구합니다.",
          ]
        : [
            "미분할 쪽 f 는 '로-다-삼-지' 순서로 고릅니다. (로그 → 다항 → 삼각 → 지수 중 앞쪽)",
            "∫ f g' dx = f g − ∫ f' g dx 를 씁니다.",
            highDeg ? "다항식 차수가 2 이상이면 부분적분을 여러 번 하거나 표(도표적분)를 쓰면 빠릅니다." : "남은 적분은 기본 공식으로 계산합니다.",
          ],
      formula: String.raw`\int f(x)g'(x)\,dx=f(x)g(x)-\int f'(x)g(x)\,dx`,
    })
  }

  if (/(sin|cos)\s*\^\s*\(?\s*2/.test(body)) {
    out.push({
      name: "배각(반각) 공식으로 차수 낮추기",
      why: "sin²x 또는 cos²x 가 있습니다.",
      steps: ["sin²x = (1 − cos 2x)/2, cos²x = (1 + cos 2x)/2 로 바꿉니다.", "cos 2x 는 ∫ cos 2x dx = (1/2) sin 2x 로 적분합니다."],
      formula: String.raw`\sin^{2}x=\frac{1-\cos 2x}{2},\quad \cos^{2}x=\frac{1+\cos 2x}{2}`,
    })
  }
  if (/tan\s*\^\s*\(?\s*2/.test(body)) {
    out.push({
      name: "tan²x = sec²x − 1",
      why: "tan²x 가 있습니다.",
      steps: ["tan²x = sec²x − 1 로 바꾸면 ∫ sec²x dx = tan x 로 적분됩니다."],
    })
  }

  // 유리함수 (부분분수)
  const rational = re("\\/\\s*\\(?[^)]*V\\s*\\^\\s*2|\\/\\s*\\(*\\s*V\\s*[+-][^)]*\\)\\s*\\*?\\s*\\(", v).test(body)
  if (rational && !fracDeriv && !subst) {
    out.push({
      name: "부분분수로 나누기",
      why: "분모가 인수분해되는 다항식인 유리함수입니다.",
      steps: [
        "분자의 차수가 분모 이상이면 먼저 나눗셈을 합니다.",
        "분모를 인수분해해서 A/(x−a) + B/(x−b) 로 쪼갭니다.",
        "각각 ∫ 1/(x−a) dx = ln|x−a| 로 적분합니다.",
      ],
    })
  }

  if (re("√\\s*\\(\\s*\\d+\\s*-\\s*V\\s*\\^\\s*2", v).test(body)) {
    out.push({
      name: "원의 넓이로 해석",
      why: "√(a² − x²) 꼴은 반원의 그래프입니다.",
      steps: ["y = √(a² − x²) 는 반지름 a 인 원의 위쪽 반입니다.", "적분 구간에 해당하는 부채꼴·삼각형 넓이로 계산합니다."],
    })
    cautions.push("√(a² − x²) 를 x = a sin θ 로 치환하는 방법은 교육과정 밖입니다. 넓이(도형)로 해석하세요.")
  }

  if (f.abs) {
    out.push({
      name: "절댓값은 구간 나누기",
      why: "절댓값 기호가 있습니다.",
      steps: ["절댓값 안이 0 이 되는 x 를 찾습니다.", "그 점을 기준으로 구간을 나누고 부호를 정해 각각 적분합니다."],
    })
  }

  if (f.symmetric) {
    out.push({
      name: "대칭 구간: 우함수·기함수",
      why: `적분 구간이 ${f.lo} ~ ${f.hi} 로 0 에 대해 대칭입니다.`,
      steps: ["f(−x) = f(x) (우함수) 이면 2∫₀ᵃ f(x) dx", "f(−x) = −f(x) (기함수) 이면 0", "식을 우함수 부분과 기함수 부분으로 나눠 따로 처리할 수 있습니다."],
    })
  }

  if (out.length === 0) {
    const basics = [String.raw`\int x^{n}\,dx=\frac{x^{n+1}}{n+1}+C\ \ (n\ne-1)`, String.raw`\int\frac{1}{x}\,dx=\ln|x|+C`]
    if (f.exp) basics.push(String.raw`\int e^{x}\,dx=e^{x}+C,\quad \int a^{x}\,dx=\frac{a^{x}}{\ln a}+C`)
    if (f.trig) basics.push(String.raw`\int\sin x\,dx=-\cos x+C,\quad \int\cos x\,dx=\sin x+C`)
    out.push({
      name: "식 정리 후 기본 적분 공식",
      why: "특별한 꼴이 보이지 않습니다. 식을 항별로 나눠 기본 공식을 씁니다.",
      steps: ["분수는 항별로 나누고, 곱은 전개합니다.", "f(ax + b) 꼴이면 적분 후 1/a 을 곱합니다."],
      formula: basics.join("\n"),
    })
  }
}

function applicationMethods(f: Features, out: Method[]) {
  const w = f.words
  if (w.area) {
    out.push({
      name: "넓이: 위 함수 − 아래 함수",
      why: "넓이를 구하는 문제입니다.",
      steps: [
        "두 곡선(또는 곡선과 x축)의 교점을 구해 적분 구간을 정합니다.",
        "구간마다 위에 있는 함수에서 아래 함수를 뺀 식을 적분합니다. (∫|f − g| dx)",
        "역함수가 나오면 y = x 대칭을 이용해 넓이를 바꿔 계산할 수 있습니다.",
      ],
      formula: String.raw`S=\int_a^b|f(x)-g(x)|\,dx`,
    })
  }
  if (w.volume) {
    out.push({
      name: "부피: 단면의 넓이를 적분",
      why: "입체의 부피를 구하는 문제입니다.",
      steps: ["x 에서 자른 단면의 넓이 S(x) 를 구합니다.", "V = ∫ₐᵇ S(x) dx 를 계산합니다."],
      formula: String.raw`V=\int_a^b S(x)\,dx`,
    })
  }
  if (w.motion) {
    out.push({
      name: "속도와 거리",
      why: "운동(속도·위치·거리) 문제입니다.",
      steps: [
        "위치 변화량 = ∫ v(t) dt, 움직인 거리 = ∫ |v(t)| dt 입니다. (방향이 바뀌는 시각에서 구간을 나눔)",
        "평면 운동이면 속도 (dx/dt, dy/dt), 속력 √((dx/dt)² + (dy/dt)²) 입니다.",
      ],
      formula: String.raw`\text{거리}=\int_a^b\sqrt{\left(\frac{dx}{dt}\right)^{2}+\left(\frac{dy}{dt}\right)^{2}}\,dt`,
    })
  }
  if (w.length) {
    out.push({
      name: "곡선의 길이",
      why: "곡선의 길이를 구하는 문제입니다.",
      steps: ["y = f(x) 이면 ∫ √(1 + {f'(x)}²) dx", "매개변수면 ∫ √((dx/dt)² + (dy/dt)²) dt", "근호 안이 완전제곱식이 되도록 정리되는 경우가 많습니다."],
      formula: String.raw`L=\int_a^b\sqrt{1+\{f'(x)\}^{2}}\,dx`,
    })
  }
  if (w.tangent) {
    out.push({
      name: "접선의 방정식",
      why: "접선을 구하는 문제입니다.",
      steps: ["접점 (a, f(a)) 에서 기울기 f'(a) 를 구합니다.", "y − f(a) = f'(a)(x − a)", "접점을 모르면 접점을 (t, f(t)) 로 놓고 조건을 대입합니다."],
    })
  }
  if (w.extremum) {
    out.push({
      name: "증가·감소와 극값",
      why: "극대·극소 또는 최대·최소 문제입니다.",
      steps: ["f'(x) = 0 인 x 를 구합니다.", "그 앞뒤에서 f'(x) 의 부호가 바뀌는지 표(증감표)로 확인합니다.", "최대·최소는 극값과 구간 양 끝값을 비교합니다."],
    })
  }
  if (w.concavity) {
    out.push({
      name: "오목·볼록과 변곡점",
      why: "변곡점 또는 오목·볼록 문제입니다.",
      steps: ["f''(x) 를 구합니다.", "f''(x) > 0 이면 아래로 볼록, < 0 이면 위로 볼록입니다.", "f''(x) 의 부호가 바뀌는 점이 변곡점입니다."],
    })
  }
}

// ───────────────────────── 4. 전체 분석 ─────────────────────────

export function analyze(input: string): Analysis {
  const normalized = normalize(input)
  const f = features(normalized)
  const methods: Method[] = []
  const cautions: string[] = []

  if (!normalized) return { normalized, topic: "알 수 없음", methods, cautions }

  const isApp = Object.values(f.words).some(Boolean)
  let topic: Topic

  if (f.lim) {
    topic = f.sum && !/k\s*\/\s*n|1\s*\/\s*n/.test(normalized) ? "급수" : "극한"
    if (topic === "급수") seriesMethods(f, methods)
    else limitMethods(f, methods, cautions)
  } else if (f.sum) {
    topic = "급수"
    seriesMethods(f, methods)
  } else if (f.deriv && (!f.int || f.defFunc)) {
    topic = "미분"
    derivMethods(f, methods)
  } else if (f.int && /∫/.test(normalized)) {
    topic = f.words.area || f.words.volume || f.words.length || f.words.motion ? "정적분의 활용" : "적분"
    integralMethods(f, methods, cautions)
  } else if (isApp) {
    topic = f.words.tangent || f.words.extremum || f.words.concavity ? "미분" : "정적분의 활용"
  } else if (/^\s*y\s*=/.test(normalized) && /x/.test(normalized)) {
    // y = f(x) 만 쓴 경우: 미분 문제로 본다
    topic = "미분"
    derivMethods(f, methods)
  } else if (f.parametric || f.implicit) {
    topic = "미분"
    derivMethods(f, methods)
  } else {
    topic = "알 수 없음"
  }

  if (isApp) applicationMethods(f, methods)

  if (f.int && /∫/.test(normalized) && !/d\s*[a-zθ]\b/.test(normalized.replace(/d\s*\/\s*d[a-z]/g, ""))) {
    cautions.push("적분 끝에 dx(적분 변수)를 붙이면 더 정확하게 분석합니다.")
  }
  if (topic === "적분" && !f.definite) cautions.push("부정적분은 답에 적분상수 + C 를 꼭 씁니다.")

  // 같은 이름 접근법은 하나만
  const seen = new Set<string>()
  const unique = methods.filter((m) => !seen.has(m.name) && seen.add(m.name))

  return { normalized, topic, methods: unique, cautions }
}

/** 목적 버튼: 식과 함께 "무엇을 구하는지" 알려 주면 정적분의 활용·미분의 활용 접근법이 나온다 */
export const PURPOSES = ["넓이", "부피", "속도·거리", "곡선의 길이", "접선", "극값", "변곡점"] as const
export type Purpose = (typeof PURPOSES)[number]

/** 수식(LaTeX)과 목적을 합쳐 분석한다 */
export function analyzeWith(latex: string, purposes: readonly Purpose[] = []): Analysis {
  return analyze([latex, ...purposes].join(" "))
}

/** 화면에 보여 줄 예시 (수식 입력창에 넣을 LaTeX) */
export const EXAMPLES: { label: string; latex: string; purposes?: Purpose[] }[] = [
  { label: "삼각함수 극한", latex: String.raw`\lim_{x\to0}\frac{\sin3x}{x}` },
  { label: "부분적분", latex: String.raw`\int xe^{x}\,dx` },
  { label: "치환적분", latex: String.raw`\int xe^{x^2}\,dx` },
  { label: "f'/f 꼴", latex: String.raw`\int\frac{2x}{x^2+1}\,dx` },
  { label: "합성함수 미분", latex: String.raw`\frac{d}{dx}\ln\left(x^2+1\right)` },
  { label: "음함수", latex: String.raw`x^2+y^2=25` },
  { label: "매개변수", latex: String.raw`x=t^2+1,\;y=t^3` },
  { label: "구분구적법", latex: String.raw`\lim_{n\to\infty}\sum_{k=1}^{n}\frac{1}{n}\left(\frac{k}{n}\right)^2` },
  { label: "반각 공식", latex: String.raw`\int_0^{\pi}\sin^2x\,dx` },
  { label: "등비급수", latex: String.raw`\sum_{n=1}^{\infty}\left(\frac{1}{3}\right)^{n}` },
  { label: "넓이", latex: String.raw`y=e^{x},\;x=0,\;x=1`, purposes: ["넓이"] },
  { label: "두 곡선 사이 넓이", latex: String.raw`y=x^2,\;y=x`, purposes: ["넓이"] },
  { label: "부피", latex: String.raw`S(x)=x^2,\;x=0,\;x=3`, purposes: ["부피"] },
  { label: "움직인 거리", latex: String.raw`v(t)=t^2-4t,\;t=0,\;t=5`, purposes: ["속도·거리"] },
  { label: "곡선의 길이", latex: String.raw`y=\frac{2}{3}x^{\frac{3}{2}},\;x=0,\;x=3`, purposes: ["곡선의 길이"] },
  { label: "접선", latex: String.raw`y=e^{x},\;x=0`, purposes: ["접선"] },
  { label: "극값", latex: String.raw`y=x^3-3x`, purposes: ["극값"] },
  { label: "변곡점", latex: String.raw`y=x^3-3x^2`, purposes: ["변곡점"] },
]

/** 목적 버튼을 골랐을 때 보여 줄 입력 방법 */
export const PURPOSE_HINTS: Record<Purpose, string> = {
  넓이: "y=x^2, y=x  (두 곡선)  ·  y=e^x, x=0, x=1  (곡선과 x축, 세로선)",
  부피: "S(x)=x^2, x=0, x=3  (단면의 넓이와 구간)",
  "속도·거리": "v(t)=t^2-4t, t=0, t=5  ·  x=cos t, y=sin t, t=0, t=π  (평면 운동)",
  "곡선의 길이": "y=(2/3)x^(3/2), x=0, x=3  ·  x=…, y=…, t=a, t=b",
  접선: "y=e^x, x=0  ·  y=e^x, (1, e)",
  극값: "y=x^3-3x  (구간이 있으면 x=a, x=b 도 함께)",
  변곡점: "y=x^3-3x^2",
}
