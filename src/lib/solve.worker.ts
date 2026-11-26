/// <reference lib="webworker" />
/**
 * 풀이 계산 전용 웹 워커.
 * 계산(특히 적분)이 오래 걸려도 화면은 멈추지 않고, 너무 오래 걸리면 화면 쪽에서 이 워커를 끝낸다.
 * Compute Engine(약 1.6MB)은 여기서만 불러오므로 처음 풀이할 때 한 번만 내려받는다.
 */
import { ComputeEngine } from "@cortex-js/compute-engine"
import { solve, type SolveResult } from "./solve"

export type SolveRequest = { id: number; latex: string; methods: string[]; topic: string }
export type SolveResponse = { id: number; result: SolveResult }

const ce = new ComputeEngine()

self.onmessage = (e: MessageEvent<SolveRequest>) => {
  const { id, latex, methods, topic } = e.data
  let result: SolveResult
  try {
    result = solve(ce, latex, methods, topic)
  } catch {
    result = { ok: false, reason: "계산하는 중에 문제가 생겼습니다." }
  }
  self.postMessage({ id, result } satisfies SolveResponse)
}
