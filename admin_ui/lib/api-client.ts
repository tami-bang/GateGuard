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
 * Review/Incident (review_event) types
 * - 설계서/백엔드 구현 기준: incidents == review-events alias
 */
export type ReviewStatus = "OPEN" | "IN_PROGRESS" | "CLOSED" | string
export type ReviewAction = "ALLOW" | "BLOCK" | "CREATE_POLICY" | "UPDATE_POLICY" | "NO_ACTION" | string

export type ReviewEvent = {
  review_id: number
  log_id: number
  status: ReviewStatus
  proposed_action: ReviewAction | null
  reviewer_id: number | null
  note: string | null
  created_at: string | null
  reviewed_at: string | null
  generated_policy_id: number | null
  updated_at?: string | null
}

export type CreateIncidentRequest = {
  log_id: number
  proposed_action?: ReviewAction | null
  note?: string | null
  reviewer_id?: number | null
}

export type PatchIncidentRequest = {
  status?: ReviewStatus | null
  proposed_action?: ReviewAction | null
  note?: string | null
  reviewer_id?: number | null
}

export type CreatePolicyFromIncidentRequest = {
  policy_name?: string | null
  policy_type?: string | null
  action?: string | null
  host?: string | null
  path?: string | null
  method?: string | null
}

export type GetIncidentByLogResponse = { review_event: ReviewEvent | null }
export type CreateIncidentResponse = { review_event: ReviewEvent; log: AccessLogItem }
export type PatchIncidentResponse = { review_event: ReviewEvent }
export type CreatePolicyFromIncidentResponse = {
  policy_id: number
  policy?: any
  review_event: ReviewEvent
}

/**
 * Base URL 규칙
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

/**
 * Incident APIs (alias: /v1/incidents == /v1/review-events)
 * - 데모/운영은 incidents 경로를 UI에서 쓰는 게 직관적이라 incidents로 통일
 */
export async function apiGetIncidentByLog(logId: number): Promise<GetIncidentByLogResponse> {
  return await httpJson<GetIncidentByLogResponse>(`/v1/incidents/by-log/${logId}`)
}

export async function apiCreateIncident(req: CreateIncidentRequest): Promise<CreateIncidentResponse> {
  return await httpJson<CreateIncidentResponse>(`/v1/incidents`, {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export async function apiPatchIncident(reviewId: number, req: PatchIncidentRequest): Promise<PatchIncidentResponse> {
  return await httpJson<PatchIncidentResponse>(`/v1/incidents/${reviewId}`, {
    method: "PATCH",
    body: JSON.stringify(req),
  })
}

export async function apiCreatePolicyFromIncident(
  reviewId: number,
  req?: CreatePolicyFromIncidentRequest
): Promise<CreatePolicyFromIncidentResponse> {
  return await httpJson<CreatePolicyFromIncidentResponse>(`/v1/incidents/${reviewId}/actions/create-policy`, {
    method: "POST",
    body: JSON.stringify(req ?? {}),
  })
}
