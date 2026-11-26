"use client"

import "mathlive/static.css"
import { useEffect, useRef, useState } from "react"
import type { MathfieldElement } from "mathlive"
import { Lightbulb, Sparkles, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EXAMPLES, PURPOSES, analyzeWith, type Analysis, type Purpose } from "@/lib/calc2"

type MathLive = typeof import("mathlive")

/**
 * 기호 버튼: [버튼에 보일 글자, 넣을 LaTeX]
 * #? = 빈칸(채울 자리), #@ = 바로 앞에 쓴 것 (예: x 를 쓰고 xⁿ 을 누르면 x^□)
 */
const SYMBOLS: [string, string][] = [
  ["∫", String.raw`\int #?\,dx`],
  ["∫ₐᵇ", String.raw`\int_{#?}^{#?}#?\,dx`],
  ["lim", String.raw`\lim_{x\to #?}#?`],
  ["분수", String.raw`\frac{#?}{#?}`],
  ["xⁿ", String.raw`#@^{#?}`],
  ["√", String.raw`\sqrt{#?}`],
  ["eˣ", String.raw`e^{#?}`],
  ["ln", String.raw`\ln\left(#?\right)`],
  ["sin", String.raw`\sin #?`],
  ["cos", String.raw`\cos #?`],
  ["tan", String.raw`\tan #?`],
  ["Σ", String.raw`\sum_{k=1}^{n}#?`],
  ["d/dx", String.raw`\frac{d}{dx}#?`],
  ["π", String.raw`\pi`],
  ["∞", String.raw`\infty`],
  ["→", String.raw`\to`],
]

export function CalcHelper() {
  const fieldRef = useRef<MathfieldElement>(null)
  const [ml, setMl] = useState<MathLive | null>(null)
  const [latex, setLatex] = useState("")
  const [purposes, setPurposes] = useState<Purpose[]>([])
  const [result, setResult] = useState<Analysis | null>(null)

  // 최신 값을 이벤트 처리기에서 쓰기 위한 참조 (Enter 를 누른 순간의 목적 버튼 상태)
  const purposesRef = useRef(purposes)
  useEffect(() => {
    purposesRef.current = purposes
  }, [purposes])

  // MathLive 는 이 탭에서만 필요하므로 화면이 뜬 뒤에 따로 불러온다 (잠그기/열기 화면을 느리게 하지 않음)
  useEffect(() => {
    let alive = true
    import("mathlive").then((mod) => {
      // 글꼴은 static.css 가 이미 불러오고, 소리 파일은 쓰지 않음 → 외부·추가 요청 없음
      mod.MathfieldElement.fontsDirectory = null
      mod.MathfieldElement.soundsDirectory = null
      if (alive) setMl(mod)
    })
    return () => {
      alive = false
    }
  }, [])

  // 입력창 이벤트 연결: 쓸 때마다 값 저장, Enter(=change) 를 누르면 분석
  useEffect(() => {
    const mf = fieldRef.current
    if (!ml || !mf) return
    mf.inlineShortcuts = { ...mf.inlineShortcuts, lim: String.raw`\lim_{#?}`, int: String.raw`\int` }
    // 띄어쓰기(예: "cos x")를 눌러도 칸 밖으로 튀어 나가지 않고 작은 공백만 들어가게
    mf.mathModeSpace = String.raw`\,`
    const onInput = () => setLatex(mf.value)
    const onChange = () => run(mf.value, purposesRef.current)
    mf.addEventListener("input", onInput)
    mf.addEventListener("change", onChange)
    return () => {
      mf.removeEventListener("input", onInput)
      mf.removeEventListener("change", onChange)
    }
  }, [ml])

  function run(value: string, ps: Purpose[]) {
    setResult(value.trim() || ps.length ? analyzeWith(value, ps) : null)
  }

  function insert(template: string) {
    const mf = fieldRef.current
    if (!mf) return
    mf.insert(template, { focus: true, selectionMode: "placeholder", format: "latex" })
    setLatex(mf.value)
  }

  function togglePurpose(p: Purpose) {
    const next = purposes.includes(p) ? purposes.filter((x) => x !== p) : [...purposes, p]
    setPurposes(next)
    if (result) run(latex, next) // 이미 결과가 있으면 바로 다시 분석
  }

  function pickExample(ex: (typeof EXAMPLES)[number]) {
    const mf = fieldRef.current
    if (mf) mf.value = ex.latex
    const ps = ex.purposes ?? []
    setLatex(ex.latex)
    setPurposes(ps)
    run(ex.latex, ps)
  }

  function clear() {
    const mf = fieldRef.current
    if (mf) {
      mf.value = ""
      mf.focus()
    }
    setLatex("")
    setPurposes([])
    setResult(null)
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h2 id="calc-label" className="text-[1.05rem] font-bold">
          수식을 입력하세요
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          식을 직접 풀지는 않고, 식의 모양을 보고 <strong className="font-medium text-foreground">어떤 방법으로 접근할지</strong>{" "}
          알려 줍니다. <kbd className="font-mono">^</kbd> 는 지수, <kbd className="font-mono">/</kbd> 는 분수가 되고,{" "}
          <kbd className="font-mono">sqrt</kbd>·<kbd className="font-mono">int</kbd>·<kbd className="font-mono">pi</kbd> 를 치면 √·∫·π 로
          바뀝니다.
        </p>

        <math-field
          ref={fieldRef}
          aria-labelledby="calc-label"
          math-virtual-keyboard-policy="auto"
          smart-fence="on"
          className="calc-field block min-h-[4.5rem] w-full rounded-md border border-input bg-card px-3 py-3 text-[1.5rem]"
        />

        <div className="flex flex-wrap gap-1.5" aria-label="기호 넣기">
          {SYMBOLS.map(([label, tex]) => (
            <button
              key={label}
              type="button"
              disabled={!ml}
              // 누를 때 입력창의 포커스를 빼앗지 않게 해서, 바로 이어서 입력할 수 있게 함
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(tex)}
              className="h-9 min-w-10 rounded-md border border-border bg-card px-2 text-[0.95rem] hover:bg-muted disabled:opacity-50"
              aria-label={`${label} 넣기`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">무엇을 구하나요? (선택)</h2>
        <div className="flex flex-wrap gap-2">
          {PURPOSES.map((p) => {
            const on = purposes.includes(p)
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => togglePurpose(p)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  on ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:border-foreground/40"
                }`}
              >
                {p}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" className="h-11 px-5" disabled={!latex.trim() && purposes.length === 0} onClick={() => run(latex, purposes)}>
          <Sparkles aria-hidden /> 접근법 찾기
        </Button>
        {(latex || purposes.length > 0) && (
          <Button size="lg" variant="ghost" className="h-11 px-4" onClick={clear}>
            지우기
          </Button>
        )}
      </div>

      <section aria-label="예시">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">예시 눌러 보기</h2>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => pickExample(ex)}
              className="rounded-full border border-border bg-card px-3 py-1 text-sm hover:border-foreground/40"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </section>

      {result && <Result result={result} ml={ml} />}
    </div>
  )
}

function Result({ result, ml }: { result: Analysis; ml: MathLive | null }) {
  if (result.methods.length === 0) {
    return (
      <p role="status" className="rounded-md bg-muted px-3.5 py-3 text-[0.95rem] leading-6">
        미적분2 식으로 알아보지 못했습니다. 위의 ∫ · lim · d/dx · Σ 버튼으로 식을 만들거나, “무엇을 구하나요?”에서 넓이·접선 등을 골라 보세요.
      </p>
    )
  }

  return (
    <section aria-live="polite" className="space-y-5">
      <span className="inline-block rounded-full bg-brass-soft px-3 py-1 text-sm font-bold text-[#6b4a0c]">{result.topic}</span>

      <ol className="space-y-4">
        {result.methods.map((m, i) => (
          <li key={m.name} className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <h3 className="flex items-baseline gap-2 text-[1.05rem] font-bold">
              <span className="text-sm text-brass tabular-nums">{i === 0 ? "추천" : `${i + 1}`}</span>
              {m.name}
            </h3>
            <p className="mt-1.5 flex gap-1.5 text-sm leading-6 text-muted-foreground">
              <Lightbulb className="mt-1 size-3.5 shrink-0" aria-hidden />
              {m.why}
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-[0.95rem] leading-7 marker:text-muted-foreground">
              {m.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {m.formula && (
              <div className="mt-3 space-y-2 overflow-x-auto rounded-md bg-muted px-3 py-3">
                {m.formula.split("\n").map((line) => (
                  <Formula key={line} latex={line} ml={ml} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>

      {result.cautions.map((c) => (
        <p key={c} className="flex gap-2.5 rounded-md bg-brass-soft px-3.5 py-3 text-[0.95rem] leading-6 text-[#6b4a0c]">
          <TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden />
          <span>{c}</span>
        </p>
      ))}

      <p className="text-sm text-muted-foreground">식의 모양으로 판단한 추천입니다. 여러 방법이 나오면 위에서부터 먼저 시도해 보세요.</p>
    </section>
  )
}

/** 공식 한 줄을 교과서처럼 그려 준다. (이 앱에 미리 적어 둔 공식만 넣으므로 innerHTML 이 안전함) */
function Formula({ latex, ml }: { latex: string; ml: MathLive | null }) {
  if (!ml) return <code className="block font-mono text-sm">{latex}</code>
  return (
    <div
      className="text-[1.1rem] whitespace-nowrap"
      dangerouslySetInnerHTML={{ __html: ml.convertLatexToMarkup(latex, { defaultMode: "math" }) }}
    />
  )
}
