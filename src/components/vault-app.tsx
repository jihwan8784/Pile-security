"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check, FolderLock, FolderOpen, KeyRound, LockKeyhole, Sigma, TriangleAlert } from "lucide-react"
import { CalcHelper } from "@/components/calc-helper"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  MAX_TOTAL_BYTES,
  VaultError,
  formatBytes,
  lockFolder,
  parseKeyFile,
  serializeKeyFile,
  unlockVault,
  type KeyFile,
  type LockInput,
} from "@/lib/vault"

export function VaultApp() {
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<"lock" | "unlock" | "calc">("lock")

  return (
    <main className="mx-auto w-full max-w-[640px] px-4 pt-12 pb-16 sm:pt-20">
      <header className="mb-10">
        <p className="mb-6 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <KeyRound className="size-4 text-brass" aria-hidden />
          Pile Security
        </p>
        <h1 className="text-[2.25rem] leading-[1.15] font-bold tracking-[-0.02em] text-balance sm:text-5xl">
          폴더는 잠그고,
          <br />
          열쇠는 USB에.
        </h1>
        <p className="mt-5 max-w-[34rem] text-base leading-7 text-muted-foreground">
          고른 폴더를 이 브라우저 안에서 암호화합니다. 파일은 어디에도 올라가지 않고, 잠긴 금고 파일(.vault)과
          열쇠 파일(.key) 두 개만 내려받습니다.
        </p>
      </header>

      {/* 작업 중에는 "다른" 탭만 막는다. 선택된 탭을 disabled로 만들면 Base UI가 선택을 해제해서 결과 화면이 사라진다 */}
      <Tabs value={tab} onValueChange={(v) => !busy && (v === "lock" || v === "unlock" || v === "calc") && setTab(v)}>
        <TabsList className="h-11! w-full sm:w-[27rem]">
          <TabsTrigger value="lock" disabled={busy && tab !== "lock"} className="text-[0.95rem]">
            <LockKeyhole aria-hidden /> 잠그기
          </TabsTrigger>
          <TabsTrigger value="unlock" disabled={busy && tab !== "unlock"} className="text-[0.95rem]">
            <FolderOpen aria-hidden /> 열기
          </TabsTrigger>
          <TabsTrigger value="calc" disabled={busy && tab !== "calc"} className="text-[0.95rem]">
            <Sigma aria-hidden /> 미적분2
          </TabsTrigger>
        </TabsList>
        {/* keepMounted: 탭을 바꿔도 받지 않은 열쇠가 사라지지 않게 */}
        <TabsContent value="lock" keepMounted className="pt-6">
          <LockPanel onBusy={setBusy} />
        </TabsContent>
        <TabsContent value="unlock" keepMounted className="pt-6">
          <UnlockPanel onBusy={setBusy} />
        </TabsContent>
        <TabsContent value="calc" keepMounted className="pt-6">
          <CalcHelper />
        </TabsContent>
      </Tabs>

      <footer className="mt-14 border-t border-border pt-6 text-sm leading-6 text-muted-foreground">
        <p>
          열쇠 파일을 잃어버리면 누구도, 만든 사람도 금고를 열 수 없습니다. 열쇠는 금고 파일과 다른 곳에 두세요.
        </p>
        <p className="mt-2">
          AES-256-GCM으로 암호화하며, 한 번에 최대 {formatBytes(MAX_TOTAL_BYTES)}까지 잠글 수 있습니다.
        </p>
      </footer>
    </main>
  )
}

// ───────────────────────── 잠그기 ─────────────────────────

type Picked = { folder: string; files: LockInput[]; total: number }
type Locked = { vault: Blob; key: KeyFile; count: number }

function LockPanel({ onBusy }: { onBusy: (b: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [locked, setLocked] = useState<Locked | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gotKey, setGotKey] = useState(false)
  const [gotVault, setGotVault] = useState(false)

  // React 타입에 없는 속성이라 직접 붙인다: 파일 대신 폴더를 고르게 함
  useEffect(() => {
    inputRef.current?.setAttribute("webkitdirectory", "")
  }, [])

  // 열쇠를 받기 전에 페이지를 닫으려 하면 브라우저가 한 번 더 묻게 한다
  useEffect(() => {
    if (!locked || gotKey) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [locked, gotKey])

  function onPick(list: FileList | null) {
    setError(null)
    if (!list || list.length === 0) return
    const files: LockInput[] = Array.from(list, (f) => ({
      path: f.webkitRelativePath || f.name,
      blob: f,
      mtime: f.lastModified,
    }))
    const folder = files[0].path.split("/")[0] || "폴더"
    const total = files.reduce((s, f) => s + f.blob.size, 0)
    setPicked({ folder, files, total })
    if (total > MAX_TOTAL_BYTES) {
      setError(`이 폴더는 ${formatBytes(total)}입니다. 한 번에 ${formatBytes(MAX_TOTAL_BYTES)}까지 잠글 수 있으니 나눠서 잠그세요.`)
    }
  }

  async function onLock() {
    if (!picked) return
    setError(null)
    onBusy(true)
    setProgress(0)
    try {
      const result = await lockFolder(picked.files, picked.folder, throttle(setProgress))
      setLocked({ vault: result.vault, key: result.key, count: result.files.length })
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setProgress(null)
      onBusy(false)
    }
  }

  function reset() {
    if (locked && !gotKey && !window.confirm("아직 열쇠 파일을 받지 않았습니다. 열쇠 없이는 이 금고를 열 수 없어요. 그래도 넘어갈까요?")) {
      return
    }
    setPicked(null)
    setLocked(null)
    setGotKey(false)
    setGotVault(false)
    setError(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  if (locked) {
    const name = safeFileName(locked.key.folder)
    return (
      <div className="space-y-6">
        <Status tone="ok" icon={<Check className="size-4" aria-hidden />}>
          ‘{locked.key.folder}’ 폴더의 파일 {locked.count}개를 잠갔습니다. 두 파일을 모두 내려받으세요.
        </Status>

        <KeyTag keyFile={locked.key}>
          <Button
            size="lg"
            className="h-11 bg-brass px-4 text-white hover:bg-brass/90"
            onClick={() => {
              download(new Blob([serializeKeyFile(locked.key)], { type: "application/json" }), `${name}.key`)
              setGotKey(true)
            }}
          >
            <KeyRound aria-hidden />
            {gotKey ? "열쇠 다시 받기" : "열쇠 받기 (.key)"}
          </Button>
        </KeyTag>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            className="h-11 px-4"
            onClick={() => {
              download(locked.vault, `${name}.vault`)
              setGotVault(true)
            }}
          >
            <FolderLock aria-hidden />
            {gotVault ? "금고 파일 다시 받기" : `금고 파일 받기 (.vault, ${formatBytes(locked.vault.size)})`}
          </Button>
          <Button size="lg" variant="ghost" className="h-11 px-4" onClick={reset}>
            다른 폴더 잠그기
          </Button>
        </div>

        {gotKey && gotVault ? (
          <Status tone="neutral">
            원본 폴더는 그대로 남아 있습니다. 금고 파일로 열리는지 확인한 다음, 원본 폴더는 직접 지우세요.
          </Status>
        ) : (
          <Status tone="warn" icon={<TriangleAlert className="size-4" aria-hidden />}>
            열쇠 파일은 지금 한 번만 만들어집니다. 잃어버리면 금고를 열 방법이 없습니다.
          </Status>
        )}
      </div>
    )
  }

  const working = progress !== null
  return (
    <ol className="space-y-8">
      <Step n={1} title="잠글 폴더 고르기">
        <input ref={inputRef} type="file" multiple className="sr-only" id="folder-input" onChange={(e) => onPick(e.target.files)} />
        <Button size="lg" variant="outline" className="h-11 bg-card px-4" disabled={working} onClick={() => inputRef.current?.click()}>
          <FolderOpen aria-hidden />
          {picked ? "다른 폴더 고르기" : "폴더 고르기"}
        </Button>
        {picked && (
          <p className="mt-3 text-[0.95rem]">
            <span className="font-medium">‘{picked.folder}’</span>
            <span className="text-muted-foreground">
              {" "}
              파일 {picked.files.length}개, {formatBytes(picked.total)}
            </span>
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          브라우저가 “업로드”할지 물어도 파일은 이 컴퓨터 밖으로 나가지 않습니다.
        </p>
      </Step>

      <Step n={2} title="잠그기">
        <Button
          size="lg"
          className="h-11 px-5"
          disabled={!picked || working || picked.total > MAX_TOTAL_BYTES}
          onClick={onLock}
        >
          <LockKeyhole aria-hidden />
          {working ? "잠그는 중…" : "폴더 잠그기"}
        </Button>
        {working && <ProgressRow value={progress} label="암호화하는 중" />}
        {error && <Status tone="error" className="mt-4">{error}</Status>}
      </Step>

      <Step n={3} title="열쇠와 금고 파일 받기" muted>
        <p className="text-sm text-muted-foreground">잠그기가 끝나면 여기서 두 파일을 내려받습니다.</p>
      </Step>
    </ol>
  )
}

function KeyTag({ keyFile, children }: { keyFile: KeyFile; children: ReactNode }) {
  const fingerprint = keyFile.kid.slice(0, 16).match(/.{4}/g)!.join(" ")
  return (
    <section className="key-tag" aria-label="열쇠 정보">
      <p className="text-sm text-muted-foreground">열쇠</p>
      <p className="mt-0.5 text-xl font-bold tracking-[-0.01em] break-all">{keyFile.folder}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">지문</dt>
        <dd className="font-mono tracking-wide">{fingerprint}</dd>
        <dt className="text-muted-foreground">만든 날</dt>
        <dd>{formatDate(keyFile.created)}</dd>
      </dl>
      <div className="mt-4">{children}</div>
    </section>
  )
}

// ───────────────────────── 열기 ─────────────────────────

type Opened = { folder: string; count: number; zip: Blob }

function UnlockPanel({ onBusy }: { onBusy: (b: boolean) => void }) {
  const vaultRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const [vault, setVault] = useState<File | null>(null)
  const [key, setKey] = useState<KeyFile | null>(null)
  const [keyName, setKeyName] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onPickKey(file: File | undefined) {
    setError(null)
    setKey(null)
    setKeyName(file?.name ?? null)
    if (!file) return
    try {
      // 열쇠 파일은 몇백 바이트. 엉뚱한 큰 파일을 고르면 읽지 않는다
      if (file.size > 64 * 1024) throw new VaultError("bad-key-file", "올바른 열쇠 파일(.key)이 아닙니다.")
      setKey(parseKeyFile(await file.text()))
    } catch (e) {
      setError(messageOf(e))
    }
  }

  async function onOpen() {
    if (!vault || !key) return
    setError(null)
    onBusy(true)
    setProgress(0)
    try {
      const result = await unlockVault(vault, key, throttle(setProgress))
      const next = { folder: result.folder, count: result.files.length, zip: result.zip }
      setOpened(next)
      download(next.zip, `${safeFileName(next.folder)}.zip`)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setProgress(null)
      onBusy(false)
    }
  }

  function reset() {
    setVault(null)
    setKey(null)
    setKeyName(null)
    setOpened(null)
    setError(null)
    if (vaultRef.current) vaultRef.current.value = ""
    if (keyRef.current) keyRef.current.value = ""
  }

  if (opened) {
    return (
      <div className="space-y-6">
        <Status tone="ok" icon={<Check className="size-4" aria-hidden />}>
          ‘{opened.folder}’ 폴더를 열었습니다. 파일 {opened.count}개가 담긴 zip 파일을 내려받았어요. 압축을 풀면 원래 폴더가 나옵니다.
        </Status>
        <div className="flex flex-wrap gap-3">
          <Button size="lg" className="h-11 px-4" onClick={() => download(opened.zip, `${safeFileName(opened.folder)}.zip`)}>
            <FolderOpen aria-hidden />
            zip 다시 받기 ({formatBytes(opened.zip.size)})
          </Button>
          <Button size="lg" variant="ghost" className="h-11 px-4" onClick={reset}>
            다른 금고 열기
          </Button>
        </div>
      </div>
    )
  }

  const working = progress !== null
  return (
    <ol className="space-y-8">
      <Step n={1} title="금고 파일 고르기">
        <input
          ref={vaultRef}
          type="file"
          accept=".vault"
          className="sr-only"
          onChange={(e) => {
            setError(null)
            setVault(e.target.files?.[0] ?? null)
          }}
        />
        <Button size="lg" variant="outline" className="h-11 bg-card px-4" disabled={working} onClick={() => vaultRef.current?.click()}>
          <FolderLock aria-hidden />
          {vault ? "다른 금고 파일 고르기" : "금고 파일 고르기 (.vault)"}
        </Button>
        {vault && (
          <p className="mt-3 text-[0.95rem] break-all">
            <span className="font-medium">{vault.name}</span>
            <span className="text-muted-foreground"> {formatBytes(vault.size)}</span>
          </p>
        )}
      </Step>

      <Step n={2} title="열쇠 파일 고르기">
        <input ref={keyRef} type="file" accept=".key" className="sr-only" onChange={(e) => onPickKey(e.target.files?.[0])} />
        <Button size="lg" variant="outline" className="h-11 bg-card px-4" disabled={working} onClick={() => keyRef.current?.click()}>
          <KeyRound aria-hidden />
          {keyName ? "다른 열쇠 파일 고르기" : "열쇠 파일 고르기 (.key)"}
        </Button>
        {key && (
          <p className="mt-3 text-[0.95rem]">
            <span className="font-medium">‘{key.folder}’ 폴더의 열쇠</span>
            <span className="text-muted-foreground"> {formatDate(key.created)}에 만듦</span>
          </p>
        )}
      </Step>

      <Step n={3} title="열기">
        <Button size="lg" className="h-11 px-5" disabled={!vault || !key || working} onClick={onOpen}>
          <FolderOpen aria-hidden />
          {working ? "여는 중…" : "금고 열기"}
        </Button>
        {working && <ProgressRow value={progress} label="복호화하는 중" />}
        {error && <Status tone="error" className="mt-4">{error}</Status>}
      </Step>
    </ol>
  )
}

// ───────────────────────── 공통 조각 ─────────────────────────

function Step({ n, title, muted, children }: { n: number; title: string; muted?: boolean; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-x-3">
      <span
        className={`mt-0.5 flex size-7 items-center justify-center rounded-full border text-sm font-medium tabular-nums ${
          muted ? "border-border text-muted-foreground" : "border-foreground/70"
        }`}
        aria-hidden
      >
        {n}
      </span>
      <div className="min-w-0">
        <h2 className={`mb-3 text-[1.05rem] font-bold ${muted ? "text-muted-foreground" : ""}`}>{title}</h2>
        {children}
      </div>
    </li>
  )
}

function ProgressRow({ value, label }: { value: number | null; label: string }) {
  const pct = Math.round((value ?? 0) * 100)
  return (
    <div className="mt-4 max-w-sm" role="status" aria-live="polite">
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <Progress value={pct} className="[&_[data-slot=progress-indicator]]:bg-brass [&_[data-slot=progress-track]]:h-1.5" />
    </div>
  )
}

const toneClass = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-brass-soft text-[#6b4a0c]",
  error: "bg-signal-soft text-signal",
  neutral: "bg-muted text-foreground",
} as const

function Status({
  tone,
  icon,
  className = "",
  children,
}: {
  tone: keyof typeof toneClass
  icon?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={`flex gap-2.5 rounded-md px-3.5 py-3 text-[0.95rem] leading-6 ${toneClass[tone]} ${className}`}
    >
      {icon && <span className="mt-1 shrink-0">{icon}</span>}
      <span>{children}</span>
    </p>
  )
}

// ───────────────────────── 도우미 ─────────────────────────

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 큰 파일은 다운로드 시작이 늦을 수 있어 넉넉히 기다렸다가 해제
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000)
}

/** 윈도우에서 파일 이름에 못 쓰는 글자를 _로 바꾼다 */
function safeFileName(s: string) {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "folder"
}

/** 진행률이 1% 이상 바뀔 때만 화면을 다시 그린다 */
function throttle(set: (v: number) => void) {
  let last = -1
  return (v: number) => {
    const pct = Math.floor(v * 100)
    if (pct !== last) {
      last = pct
      set(v)
    }
  }
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function messageOf(e: unknown) {
  if (e instanceof VaultError) return e.message
  if (e instanceof DOMException && e.name === "NotReadableError") {
    return "파일을 읽지 못했습니다. 고른 뒤에 폴더 안의 파일이 바뀌었을 수 있으니 다시 골라 주세요."
  }
  return "알 수 없는 오류가 났습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요."
}
