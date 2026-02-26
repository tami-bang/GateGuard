// lib/api-client.ts

export type Decision = "ALLOW" | "BLOCK" | "REVIEW" | "ERROR" | "FAIL" | string
export type DecisionStage = "POLICY_STAGE" | "AI_STAGE" | "FAIL_STAGE" | string

export type AccessLogItem = {
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
  user_agent: string | null

  decision: Decision
  reason: string | null
  decision_stage: DecisionStage
  policy_id: number | null

  engine_latency_ms: number | null

  // Injection
  inject_attempted: number | null
  inject_send: number | null
  inject_errno: number | null
  inject_latency_ms: number | null
  inject_status_code: number | null

  // 최신 AI 요약(있으면 사용, 없어도 무방)
  ai_score: number | null
  ai_model_version: string | null
}

export type AIAnalysisItem = {
  ai_analysis_id?: number
  log_id?: number
  analyzed_at: string | null

  analysis_seq: number
  score: number | null
  label: string | null
  model_version: string | null
  latency_ms: number | null

  ai_response: string | null
  error_code: string | null
}

export type ListLogsResponse = {
  items: AccessLogItem[]
  total: number
  limit: number
  offset: number
  sort: string
  dir: string
}

/**
 * 상세 응답은 서버 구현에 따라 아래 2가지 형태가 있을 수 있어 안전하게 처리한다.
 * A) { log: {...}, analyses: [...] }
 * B) { ...access_log_fields..., analyses: [...] }
 */
export type LogDetail = { log: AccessLogItem; analyses: AIAnalysisItem[] }
type LogDetailRespA = { log: AccessLogItem; analyses: AIAnalysisItem[] }
type LogDetailRespB = AccessLogItem & { analyses?: AIAnalysisItem[] }

/**
 * Base URL 규칙 (너 기존 규칙 유지 + fallback 개선)
 * 1) NEXT_PUBLIC_FASTAPI_BASE_URL 있으면 사용
 * 2) 브라우저면 "현재 UI 접속 호스트:8000" 자동 추론
 * 3) SSR/빌드 환경이면 192.168.1.24:8000 (VM 기준)
 */
function getBaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_FASTAPI_BASE_URL
  if (v && v.trim()) return v.trim().replace(/\/+$/, "")

  if (typeof window !== "undefined") {
    const proto = window.location.protocol
    const host = window.location.hostname
    return `${proto}//${host}:8000`
  }

  return "http://192.168.1.24:8000"
}

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return
    q.set(k, String(v))
  })
  const s = q.toString()
  return s ? `?${s}` : ""
}

async function httpJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}${path}`

  const res = await fetch(url, {
    ...init,
    method: init?.method ?? "GET",
    cache: "no-store",
    // 쿠키 세션 인증이면 필수
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`${res.status} ${res.statusText} (${path}) ${text}`)
  }

  return (await res.json()) as T
}

/** 목록 */
export async function apiListLogs(params: {
  limit?: number
  offset?: number
  decision?: string
  stage?: string
  host?: string
  client_ip?: string
  sort?: string
  dir?: string
}): Promise<ListLogsResponse> {
  const qs = buildQuery({
    limit: params.limit,
    offset: params.offset,
    decision: params.decision,
    stage: params.stage,
    host: params.host,
    client_ip: params.client_ip,
    sort: params.sort,
    dir: params.dir,
  })
  return await httpJson<ListLogsResponse>(`/v1/logs${qs}`)
}

/** 상세 */
export async function apiGetLogDetail(logId: number): Promise<LogDetail> {
  const data = await httpJson<LogDetailRespA | LogDetailRespB>(`/v1/logs/${logId}`)

  // A) {log, analyses}
  if ("log" in data) {
    return {
      log: data.log,
      analyses: Array.isArray(data.analyses) ? data.analyses : [],
    }
  }

  // B) {...logFields, analyses}
  return {
    log: data as AccessLogItem,
    analyses: Array.isArray((data as any).analyses) ? (data as any).analyses : [],
  }
}
