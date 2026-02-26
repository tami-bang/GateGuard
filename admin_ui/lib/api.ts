// lib/api.ts
import "server-only"

const API_BASE = process.env.GATEGUARD_API_BASE ?? "http://192.168.1.24:8000"

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    // 세션 쿠키 기반 인증이면 반드시 include
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`API ${res.status} ${res.statusText} - ${text}`)
  }

  return (await res.json()) as T
}

// --------------------
// Types
// --------------------
export type Decision = "ALLOW" | "BLOCK" | "REVIEW" | "ERROR" | "FAIL"
export type DecisionStage = "POLICY_STAGE" | "AI_STAGE" | "FAIL_STAGE"

export type LogRow = {
  log_id: number
  request_id: string
  detect_timestamp: string

  client_ip: string | null
  client_port: number | null
  server_ip: string | null
  server_port: number | null

  host: string | null
  path: string | null
  method: string | null
  url_norm: string | null

  decision: Decision | string
  decision_stage: DecisionStage | string
  reason: string | null

  policy_id: number | null

  engine_latency_ms: number | null

  // Injection
  inject_attempted: number | null
  inject_send: number | null
  inject_errno: number | null
  inject_latency_ms: number | null
  inject_status_code: number | null

  // 최신 AI 요약(목록에서 쓰던 필드가 상세에도 있을 수 있음)
  ai_score: number | null
  ai_model_version: string | null
}

export type AnalysisRow = {
  ai_analysis_id?: number
  log_id?: number
  analysis_seq: number
  score: number | null
  label: string | null
  latency_ms: number | null
  model_version: string | null
  error_code: string | null
  ai_response: string | null
  analyzed_at: string | null
}

export type LogDetailResponse =
  | { log: LogRow; analyses: AnalysisRow[] }
  | (LogRow & { analyses?: AnalysisRow[] })

export type LogDetail = {
  log: LogRow
  analyses: AnalysisRow[]
}

// --------------------
// API
// --------------------
export async function apiGetLogDetail(logId: number): Promise<LogDetail> {
  const data = await apiFetch<LogDetailResponse>(`/v1/logs/${logId}`)

  // 형태 A
  if ("log" in data) {
    return {
      log: data.log,
      analyses: Array.isArray(data.analyses) ? data.analyses : [],
    }
  }

  // 형태 B
  return {
    log: data as LogRow,
    analyses: Array.isArray((data as any).analyses) ? (data as any).analyses : [],
  }
}
