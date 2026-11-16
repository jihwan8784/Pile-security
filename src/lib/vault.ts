/**
 * 폴더 잠그기/열기 — 전부 브라우저 안에서 동작한다 (Web Crypto, 서버 전송 없음).
 *
 * .vault 파일 구조
 *   [매직 "PILEVLT1" 8B][kid 16B][매니페스트 길이 u32 BE]
 *   [매니페스트: IV 12B + 암호문]           ← 폴더 이름, 파일 경로·크기·수정시각
 *   [청크: IV 12B + 암호문] × N              ← 파일 내용, 1MB 단위
 *
 * - 알고리즘: AES-256-GCM (암호화 + 위조 검사). 청크마다 새 랜덤 IV.
 * - AAD(암호화하지 않지만 위조 검사에 포함되는 값)에 매직+kid, 그리고
 *   (파일 번호, 청크 번호, 마지막 여부)를 넣어 청크 순서 바꾸기·잘라내기를 막는다.
 * - 키가 틀리면 매니페스트 복호화에서 바로 실패한다.
 */
import { Zip, ZipPassThrough } from "fflate"

export const CHUNK_SIZE = 1024 * 1024
/** zip 복원 라이브러리(fflate)가 4GB 이상(ZIP64)을 지원하지 않고, 브라우저 메모리도 고려한 상한 */
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

const MAGIC = new TextEncoder().encode("PILEVLT1")
const KID_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const PREFIX_LEN = MAGIC.length + KID_LEN
const HEADER_LEN = PREFIX_LEN + 4
const MAX_MANIFEST_LEN = 64 * 1024 * 1024
const KEY_FILE_TYPE = "pile-security-key"

export type VaultErrorCode =
  | "not-vault" // .vault 파일이 아님
  | "wrong-key" // 이 금고의 키가 아님
  | "corrupt" // 파일이 손상되었거나 변조됨
  | "bad-key-file" // .key 파일 형식이 아님
  | "bad-path" // 잠글 수 없는 파일 경로
  | "empty" // 잠글 파일이 없음
  | "too-large" // 너무 큼

export class VaultError extends Error {
  readonly code: VaultErrorCode
  constructor(code: VaultErrorCode, message: string) {
    super(message)
    this.name = "VaultError"
    this.code = code
  }
}

export type KeyFile = {
  type: typeof KEY_FILE_TYPE
  v: 1
  kid: string // hex 32자
  key: string // base64, 32바이트
  folder: string
  created: string
}

export type LockInput = { path: string; blob: Blob; mtime: number }
export type VaultEntry = { path: string; size: number; mtime: number }
type Manifest = { v: 1; folder: string; created: string; files: VaultEntry[] }

export type Progress = (fraction: number) => void

// ───────────────────────── 잠그기 ─────────────────────────

export async function lockFolder(
  files: LockInput[],
  folder: string,
  onProgress?: Progress,
): Promise<{ vault: Blob; key: KeyFile; files: VaultEntry[] }> {
  if (files.length === 0) throw new VaultError("empty", "잠글 파일이 없습니다.")

  const entries: VaultEntry[] = files.map((f) => {
    const path = cleanPath(f.path)
    if (!path) throw new VaultError("bad-path", `사용할 수 없는 파일 경로입니다: ${f.path}`)
    return { path, size: f.blob.size, mtime: f.mtime }
  })
  const total = entries.reduce((s, e) => s + e.size, 0)
  if (total > MAX_TOTAL_BYTES) {
    throw new VaultError("too-large", `폴더가 너무 큽니다. 최대 ${formatBytes(MAX_TOTAL_BYTES)}까지 잠글 수 있습니다.`)
  }

  const rawKey = randomBytes(32)
  const kid = randomBytes(KID_LEN)
  const cryptoKey = await importKey(rawKey)
  const prefix = concat(MAGIC, kid)
  const created = new Date().toISOString()

  const manifest: Manifest = { v: 1, folder, created, files: entries }
  const manifestBlock = await encrypt(cryptoKey, new TextEncoder().encode(JSON.stringify(manifest)), prefix)

  const header = new Uint8Array(HEADER_LEN)
  header.set(prefix, 0)
  new DataView(header.buffer).setUint32(PREFIX_LEN, manifestBlock.length)

  const out = new BlobBuilder()
  out.push(header)
  out.push(manifestBlock)

  const totalChunks = entries.reduce((s, e) => s + chunkCount(e.size), 0)
  let doneChunks = 0
  onProgress?.(0)

  for (let fi = 0; fi < files.length; fi++) {
    const blob = files[fi].blob
    const n = chunkCount(blob.size)
    for (let ci = 0; ci < n; ci++) {
      const start = ci * CHUNK_SIZE
      const plain = new Uint8Array(await blob.slice(start, Math.min(blob.size, start + CHUNK_SIZE)).arrayBuffer())
      out.push(await encrypt(cryptoKey, plain, chunkAad(prefix, fi, ci, ci === n - 1)))
      doneChunks++
      onProgress?.(doneChunks / totalChunks)
    }
  }

  const key: KeyFile = {
    type: KEY_FILE_TYPE,
    v: 1,
    kid: toHex(kid),
    key: toBase64(rawKey),
    folder,
    created,
  }
  return { vault: out.finish("application/octet-stream"), key, files: entries }
}

// ───────────────────────── 열기 ─────────────────────────

export async function unlockVault(
  vault: Blob,
  keyFile: KeyFile,
  onProgress?: Progress,
): Promise<{ folder: string; files: VaultEntry[]; zip: Blob }> {
  if (vault.size < HEADER_LEN) throw notVault()
  const header = new Uint8Array(await vault.slice(0, HEADER_LEN).arrayBuffer())
  if (!equalBytes(header.subarray(0, MAGIC.length), MAGIC)) throw notVault()

  const prefix = header.slice(0, PREFIX_LEN)
  if (toHex(prefix.subarray(MAGIC.length)) !== keyFile.kid) {
    throw new VaultError("wrong-key", "이 키 파일은 이 금고의 키가 아닙니다.")
  }

  const manifestLen = new DataView(header.buffer).getUint32(PREFIX_LEN)
  if (manifestLen < IV_LEN + TAG_LEN || manifestLen > MAX_MANIFEST_LEN || HEADER_LEN + manifestLen > vault.size) {
    throw corrupt()
  }

  const cryptoKey = await importKey(fromBase64(keyFile.key))
  const manifestBlock = new Uint8Array(await vault.slice(HEADER_LEN, HEADER_LEN + manifestLen).arrayBuffer())
  let manifestBytes: Uint8Array
  try {
    manifestBytes = await decrypt(cryptoKey, manifestBlock, prefix)
  } catch {
    throw new VaultError("wrong-key", "키가 맞지 않습니다. 이 금고를 잠글 때 받은 키 파일인지 확인하세요.")
  }
  const manifest = parseManifest(manifestBytes)

  // 전체 길이가 매니페스트와 정확히 맞아야 한다 (잘림·덧붙임 감지)
  const expectedSize =
    HEADER_LEN +
    manifestLen +
    manifest.files.reduce((s, f) => s + f.size + chunkCount(f.size) * (IV_LEN + TAG_LEN), 0)
  if (expectedSize !== vault.size) throw corrupt()

  const out = new BlobBuilder()
  let zipError: Error | null = null
  const zip = new Zip((err, data) => {
    if (err) zipError = err
    else out.push(data)
  })

  const totalChunks = manifest.files.reduce((s, f) => s + chunkCount(f.size), 0)
  let doneChunks = 0
  let offset = HEADER_LEN + manifestLen
  onProgress?.(0)

  for (let fi = 0; fi < manifest.files.length; fi++) {
    const entry = manifest.files[fi]
    const zf = new ZipPassThrough(entry.path)
    zf.mtime = zipDate(entry.mtime)
    zip.add(zf)

    const n = chunkCount(entry.size)
    for (let ci = 0; ci < n; ci++) {
      const plainLen = ci === n - 1 ? entry.size - ci * CHUNK_SIZE : CHUNK_SIZE
      const blockLen = IV_LEN + plainLen + TAG_LEN
      const block = new Uint8Array(await vault.slice(offset, offset + blockLen).arrayBuffer())
      offset += blockLen
      let plain: Uint8Array
      try {
        plain = await decrypt(cryptoKey, block, chunkAad(prefix, fi, ci, ci === n - 1))
      } catch {
        throw corrupt()
      }
      zf.push(plain, ci === n - 1)
      doneChunks++
      onProgress?.(doneChunks / totalChunks)
    }
  }
  zip.end()
  if (zipError) throw zipError

  return { folder: manifest.folder, files: manifest.files, zip: out.finish("application/zip") }
}

// ───────────────────────── 키 파일 ─────────────────────────

export function serializeKeyFile(key: KeyFile): string {
  return JSON.stringify(key, null, 2)
}

export function parseKeyFile(text: string): KeyFile {
  const bad = () => new VaultError("bad-key-file", "올바른 키 파일(.key)이 아닙니다.")
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw bad()
  }
  if (!isRecord(data)) throw bad()
  const { type, v, kid, key, folder, created } = data
  if (type !== KEY_FILE_TYPE || v !== 1) throw bad()
  if (typeof kid !== "string" || !/^[0-9a-f]{32}$/.test(kid)) throw bad()
  if (typeof key !== "string" || typeof folder !== "string" || typeof created !== "string") throw bad()
  try {
    if (fromBase64(key).length !== 32) throw bad()
  } catch {
    throw bad()
  }
  return { type, v, kid, key, folder, created }
}

// ───────────────────────── 내부 도구 ─────────────────────────

function chunkCount(size: number) {
  // 빈 파일도 청크 1개(빈 내용)를 둬서, 잘라내기 감지를 똑같이 적용한다
  return Math.max(1, Math.ceil(size / CHUNK_SIZE))
}

function chunkAad(prefix: Uint8Array, fileIndex: number, chunkIndex: number, last: boolean) {
  const aad = new Uint8Array(prefix.length + 9)
  aad.set(prefix, 0)
  const dv = new DataView(aad.buffer)
  dv.setUint32(prefix.length, fileIndex)
  dv.setUint32(prefix.length + 4, chunkIndex)
  dv.setUint8(prefix.length + 8, last ? 1 : 0)
  return aad
}

async function importKey(raw: Uint8Array) {
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"])
}

async function encrypt(key: CryptoKey, plain: Uint8Array, aad: Uint8Array) {
  const iv = randomBytes(IV_LEN)
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad) },
    key,
    toArrayBuffer(plain),
  )
  return concat(iv, new Uint8Array(ct))
}

async function decrypt(key: CryptoKey, block: Uint8Array, aad: Uint8Array) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(block.subarray(0, IV_LEN)), additionalData: toArrayBuffer(aad) },
    key,
    toArrayBuffer(block.subarray(IV_LEN)),
  )
  return new Uint8Array(pt)
}

function parseManifest(bytes: Uint8Array): Manifest {
  let data: unknown
  try {
    data = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw corrupt()
  }
  if (!isRecord(data) || data.v !== 1 || typeof data.folder !== "string" || !Array.isArray(data.files)) {
    throw corrupt()
  }
  const files: VaultEntry[] = data.files.map((f: unknown) => {
    if (!isRecord(f)) throw corrupt()
    const path = typeof f.path === "string" ? cleanPath(f.path) : null
    const { size, mtime } = f
    if (!path || !Number.isSafeInteger(size) || (size as number) < 0 || typeof mtime !== "number") {
      throw corrupt()
    }
    return { path, size: size as number, mtime }
  })
  return { v: 1, folder: data.folder, created: String(data.created ?? ""), files }
}

/** "a/b/c.txt" 형태만 허용. "..", 절대 경로, 드라이브 문자는 거부 (zip 경로 탈출 방지) */
function cleanPath(p: string): string | null {
  const segs = p.replace(/\\/g, "/").split("/")
  if (segs.some((s) => s === "" || s === "." || s === "..")) return null
  if (/^[a-zA-Z]:$/.test(segs[0])) return null
  return segs.join("/")
}

/** zip 날짜 형식은 1980~2099년만 표현 가능 */
function zipDate(ms: number) {
  const min = new Date(1980, 0, 2).getTime()
  const max = new Date(2099, 11, 31).getTime()
  return Number.isFinite(ms) ? Math.min(max, Math.max(min, ms)) : min
}

/** 결과를 32MB마다 Blob으로 묶어 둔다 — 큰 폴더에서 메모리 사용을 줄이기 위함 */
class BlobBuilder {
  private blobs: Blob[] = []
  private pending: Uint8Array[] = []
  private pendingSize = 0

  push(part: Uint8Array) {
    this.pending.push(part)
    this.pendingSize += part.length
    if (this.pendingSize >= 32 * 1024 * 1024) this.flush()
  }

  finish(type: string) {
    this.flush()
    return new Blob(this.blobs, { type })
  }

  private flush() {
    if (this.pending.length === 0) return
    this.blobs.push(new Blob(this.pending.map(toArrayBuffer)))
    this.pending = []
    this.pendingSize = 0
  }
}

function notVault() {
  return new VaultError("not-vault", "Pile Security 금고 파일(.vault)이 아닙니다.")
}

function corrupt() {
  return new VaultError("corrupt", "금고 파일이 손상되었거나 변조되었습니다.")
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x)
}

function randomBytes(n: number) {
  return crypto.getRandomValues(new Uint8Array(n))
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function equalBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/** Web Crypto·Blob에 넘길 때 정확히 그 범위만 담긴 ArrayBuffer로 바꾼다 */
function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer instanceof ArrayBuffer && u.byteOffset === 0 && u.byteLength === u.buffer.byteLength
    ? u.buffer
    : (u.slice().buffer as ArrayBuffer)
}

function toHex(u: Uint8Array) {
  return Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("")
}

function toBase64(u: Uint8Array) {
  return btoa(String.fromCharCode(...u))
}

function fromBase64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB"]
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}
