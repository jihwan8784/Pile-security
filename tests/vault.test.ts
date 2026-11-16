// 실행: npm test  (Node 내장 테스트 도구 node:test 사용)
import { test } from "node:test"
import assert from "node:assert/strict"
import { unzipSync } from "fflate"
import {
  CHUNK_SIZE,
  VaultError,
  lockFolder,
  parseKeyFile,
  serializeKeyFile,
  unlockVault,
  type LockInput,
} from "../src/lib/vault.ts"

const enc = new TextEncoder()

function randomBytes(n: number) {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i += 65536) {
    crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)))
  }
  return out
}

function sampleFolder(): LockInput[] {
  return [
    { path: "숙제/메모.txt", blob: new Blob([enc.encode("안녕하세요")]), mtime: Date.UTC(2026, 0, 2) },
    { path: "숙제/빈파일.txt", blob: new Blob([]), mtime: Date.UTC(2026, 0, 2) },
    // 청크 경계를 넘는 파일 (1MB 청크 2개 + 조금)
    { path: "숙제/사진/큰파일.bin", blob: new Blob([randomBytes(CHUNK_SIZE * 2 + 123)]), mtime: Date.UTC(2026, 0, 3) },
    // 정확히 청크 크기
    { path: "숙제/딱맞음.bin", blob: new Blob([randomBytes(CHUNK_SIZE)]), mtime: Date.UTC(2026, 0, 4) },
  ]
}

async function bytesOf(b: Blob) {
  return new Uint8Array(await b.arrayBuffer())
}

async function expectVaultError(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof VaultError, `VaultError가 아님: ${e}`)
    assert.equal(e.code, code)
    return true
  })
}

test("잠그고 열면 원본 파일이 그대로 복원된다", async () => {
  const input = sampleFolder()
  const { vault, key } = await lockFolder(input, "숙제")
  const result = await unlockVault(vault, key)

  assert.equal(result.folder, "숙제")
  assert.equal(result.files.length, input.length)

  const unzipped = unzipSync(await bytesOf(result.zip))
  for (const f of input) {
    assert.ok(f.path in unzipped, `zip에 ${f.path} 없음`)
    assert.deepEqual(unzipped[f.path], await bytesOf(f.blob))
  }
})

test(".vault 안에 파일 이름과 내용이 평문으로 남지 않는다", async () => {
  const secret = "아주비밀스러운내용SECRET123"
  const { vault } = await lockFolder(
    [{ path: "비밀폴더/일기장-파일이름.txt", blob: new Blob([enc.encode(secret)]), mtime: Date.now() }],
    "비밀폴더",
  )
  const text = new TextDecoder("utf-8", { fatal: false }).decode(await bytesOf(vault))
  assert.ok(!text.includes(secret))
  assert.ok(!text.includes("일기장-파일이름"))
  assert.ok(!text.includes("비밀폴더"))
})

test("키 파일은 저장했다가 다시 읽을 수 있다", async () => {
  const { vault, key } = await lockFolder(sampleFolder(), "숙제")
  const text = serializeKeyFile(key)
  const parsed = parseKeyFile(text)
  assert.deepEqual(parsed, key)
  await unlockVault(vault, parsed)
})

test("다른 금고의 키로는 열 수 없다 (wrong-key)", async () => {
  const a = await lockFolder(sampleFolder(), "숙제")
  const b = await lockFolder(sampleFolder(), "숙제")
  await expectVaultError(unlockVault(a.vault, b.key), "wrong-key")
})

test("키 아이디는 맞지만 키 값이 틀리면 열 수 없다 (wrong-key)", async () => {
  const a = await lockFolder(sampleFolder(), "숙제")
  const b = await lockFolder(sampleFolder(), "숙제")
  const forged = { ...b.key, kid: a.key.kid }
  await expectVaultError(unlockVault(a.vault, forged), "wrong-key")
})

test("금고 파일이 한 바이트라도 바뀌면 열리지 않는다 (corrupt)", async () => {
  const { vault, key } = await lockFolder(sampleFolder(), "숙제")
  const bytes = await bytesOf(vault)
  const tampered = bytes.slice()
  tampered[tampered.length - 10] ^= 0x01
  await expectVaultError(unlockVault(new Blob([tampered]), key), "corrupt")
})

test("금고 파일이 잘리면 열리지 않는다 (corrupt)", async () => {
  const { vault, key } = await lockFolder(sampleFolder(), "숙제")
  const bytes = await bytesOf(vault)
  await expectVaultError(unlockVault(new Blob([bytes.slice(0, bytes.length - 100)]), key), "corrupt")
})

test("금고 파일이 아니면 not-vault", async () => {
  const { key } = await lockFolder(sampleFolder(), "숙제")
  await expectVaultError(unlockVault(new Blob([enc.encode("그냥 텍스트 파일입니다.")]), key), "not-vault")
})

test("키 파일 형식이 틀리면 bad-key-file", () => {
  for (const text of ["", "hello", "{}", JSON.stringify({ type: "pile-security-key", v: 1, kid: "x", key: "y" })]) {
    assert.throws(() => parseKeyFile(text), (e: unknown) => e instanceof VaultError && e.code === "bad-key-file")
  }
})

test("빈 폴더는 잠글 수 없다 (empty)", async () => {
  await expectVaultError(lockFolder([], "빈폴더"), "empty")
})

test("진행률이 0에서 1까지 올라간다", async () => {
  const seen: number[] = []
  const { vault, key } = await lockFolder(sampleFolder(), "숙제", (p) => seen.push(p))
  assert.ok(seen.length > 1)
  assert.equal(seen.at(-1), 1)
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1])

  const seen2: number[] = []
  await unlockVault(vault, key, (p) => seen2.push(p))
  assert.equal(seen2.at(-1), 1)
})

test("암호화된 청크 두 개의 순서를 바꾸면 열리지 않는다 (corrupt)", async () => {
  const big = { path: "f/a.bin", blob: new Blob([randomBytes(CHUNK_SIZE * 2)]), mtime: Date.now() }
  const { vault, key } = await lockFolder([big], "f")
  const bytes = await bytesOf(vault)
  const manifestLen = new DataView(bytes.buffer).getUint32(24)
  const start = 28 + manifestLen
  const blockLen = 12 + CHUNK_SIZE + 16
  const swapped = bytes.slice()
  swapped.set(bytes.subarray(start + blockLen, start + 2 * blockLen), start)
  swapped.set(bytes.subarray(start, start + blockLen), start + blockLen)
  await expectVaultError(unlockVault(new Blob([swapped]), key), "corrupt")
})
