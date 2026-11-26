"use client"

import { useLayoutEffect, useRef, useState, type FormEvent } from "react"
import { Lightbulb, Sparkles, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EXAMPLES, analyze, type Analysis } from "@/lib/calc2"

/** 수식 입력을 돕는 기호 버튼: [버튼 글자, 넣을 글자] */
const SYMBOLS: [string, string][] = [
  ["∫", "∫ "],
  ["∫ₐᵇ", "∫_0^1 "],
  ["dx", " dx"],
  ["lim", "lim x→0 "],
  ["→", "→"],
  ["∞", "∞"],
  ["Σ", "Σ "],
  ["d/dx", "d/dx "],
  ["√", "√("],
  ["^", "^"],
  ["π", "π"],
  ["eˣ", "e^x"],
  ["ln", "ln("],
  ["sin", "sin("],
  ["cos", "cos("],
  ["tan", "tan("],
]

export function CalcHelper() {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [input, setInput] = useState("")
  const [result, setResult] = useState<Analysis | null>(null)
  // 기호를 넣은 뒤 커서를 옮길 위치 (화면이 다시 그려진 직후에 적용)
  const caret = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (caret.current === null || !inputRef.current) return
    inputRef.current.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [input])

  function run(text: string) {
    setResult(text.trim() ? analyze(text) : null)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    run(input)
  }

  /** 커서 위치에 기호를 넣는다 */
  function insert(text: string) {
    const el = inputRef.current
    if (!el) return
    const start = el.selectionStart ?? input.length
    const end = el.selectionEnd ?? input.length
    caret.current = start + text.length
    setInput(input.slice(0, start) + text + input.slice(end))
    el.focus()
  }

  return (
    <div className="space-y-8">
      <form onSubmit={onSubmit} className="space-y-3">
        <label htmlFor="calc-input" className="block text-[1.05rem] font-bold">
          수식이나 문제를 입력하세요
        </label>
        <p className="text-sm leading-6 text-muted-foreground">
          식을 직접 풀지는 않고, 식의 모양을 보고 <strong className="font-medium text-foreground">어떤 방법으로 접근할지</strong>{" "}
          알려 줍니다. 평범한 글자(<code className="font-mono">lim x-&gt;0 sin(3x)/x</code>)와 LaTeX(
          <code className="font-mono">\int x e^{"{x}"} dx</code>) 모두 됩니다.
        </p>

        <textarea
          ref={inputRef}
          id="calc-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter = 분석, Shift+Enter = 줄바꿈
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              run(input)
            }
          }}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder="예) ∫ x e^x dx"
          className="w-full resize-y rounded-md border border-input bg-card px-3.5 py-3 font-mono text-[1.05rem] leading-7 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        />

        <div className="flex flex-wrap gap-1.5" aria-label="기호 넣기">
          {SYMBOLS.map(([label, text]) => (
            <button
              key={label}
              type="button"
              // 누를 때 입력창의 포커스를 빼앗지 않게 해서, 바로 이어서 타자를 칠 수 있게 함
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(text)}
              className="h-8 min-w-9 rounded-md border border-border bg-card px-2 font-mono text-sm hover:bg-muted"
              aria-label={`${label} 넣기`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" size="lg" className="h-11 px-5" disabled={!input.trim()}>
            <Sparkles aria-hidden /> 접근법 찾기
          </Button>
          {input && (
            <Button
              type="button"
              size="lg"
              variant="ghost"
              className="h-11 px-4"
              onClick={() => {
                setInput("")
                setResult(null)
                inputRef.current?.focus()
              }}
            >
              지우기
            </Button>
          )}
        </div>
      </form>

      <section aria-label="예시">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">예시 눌러 보기</h2>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.input}
              type="button"
              onClick={() => {
                setInput(ex.input)
                run(ex.input)
              }}
              className="rounded-full border border-border bg-card px-3 py-1 text-sm hover:border-foreground/40"
              title={ex.input}
            >
              {ex.label}
            </button>
          ))}
        </div>
      </section>

      {result && <Result result={result} />}
    </div>
  )
}

function Result({ result }: { result: Analysis }) {
  if (result.methods.length === 0) {
    return (
      <p role="status" className="rounded-md bg-muted px-3.5 py-3 text-[0.95rem] leading-6">
        미적분2 식으로 알아보지 못했습니다. <code className="font-mono">lim</code>, <code className="font-mono">∫</code>,{" "}
        <code className="font-mono">d/dx</code>, <code className="font-mono">Σ</code> 중 하나를 넣거나 “넓이”, “접선”처럼 구하려는 것을 함께
        적어 보세요.
      </p>
    )
  }

  return (
    <section aria-live="polite" className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded-full bg-brass-soft px-3 py-1 text-sm font-bold text-[#6b4a0c]">{result.topic}</span>
        <span className="min-w-0 font-mono text-sm break-all text-muted-foreground">인식한 식: {result.normalized}</span>
      </div>

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
              <pre className="mt-3 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-sm leading-6 whitespace-pre-wrap">
                {m.formula}
              </pre>
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

      <p className="text-sm text-muted-foreground">
        식의 모양으로 판단한 추천입니다. 여러 방법이 나오면 위에서부터 먼저 시도해 보세요.
      </p>
    </section>
  )
}
