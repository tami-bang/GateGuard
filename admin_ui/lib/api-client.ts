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
 * Policy types (DB: policy / policy_rule)
 * - 너 DB 스키마 기준: is_enabled 컬럼 사용
 */
export type PolicyType = "ALLOWLIST" | "BLOCKLIST" | "MONITOR" | string
export type PolicyAction = "ALLOW" | "BLOCK" | "REDIRECT" | "REVIEW" | string
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string

export type Policy = {
  policy_id: number
  policy_name: string
  policy_type: PolicyType
  action: PolicyAction
  priority: number | null
  is_enabled: number | boolean | null
  risk_level: RiskLevel | null
  category: string | null
  block_status_code: number | null
  redirect_url: string | null
  description: string | null
  created_by: number
  created_at: string | null
  updated_at: string | null
  updated_by: number | null
}

export type PolicyRule = {
  rule_id: number
  policy_id: number
  rule_order: number
  rule_type: string
  match_type: string
  pattern: string
  is_case_sensitive: number | boolean | null
  is_negated: number | boolean | null
  is_enabled: number | boolean | null
}

export type GetPolicyResponse = { policy: Policy | null }
export type ListPolicyRulesResponse = { items: PolicyRule[] }

/**
 * Policy PATCH (policy 메타 수정)
 * - FastAPI: PATCH /v1/policies/{policy_id}
 */
export type PatchPolicyRequest = Partial<
  Pick<
    Policy,
    | "policy_name"
    | "policy_type"
    | "action"
    | "priority"
    | "is_enabled"
    | "risk_level"
    | "category"
    | "block_status_code"
    | "redirect_url"
    | "description"
  >
>

export type PatchPolicyResponse = { policy: Policy }

/**
 * Incident detail response (권장)
 * - UI는 incident만으로 host/path/decision을 알 수 없어서 log를 같이 받아야 함
 */
export type IncidentDetailResponse = {
  review_event: ReviewEvent
  log: AccessLogItem | null
  analyses?: AIAnalysisItem[]
  policy?: Policy | null
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

/**
 * 로그인 유저 ID 캐시 (브라우저에서만)
 * - Next API(/api/auth/me)에서 SSOT로 받아온다.
 */
let _cachedUserId: string | null = null
let _fetchingUserId: Promise<string | null> | null = null

async function getUserIdFromSession(): Promise<string | null> {
  if (typeof window === "undefined") return null
  if (_cachedUserId) return _cachedUserId
  if (_fetchingUserId) return await _fetchingUserId

  _fetchingUserId = (async () => {
    try {
      const res = await fetch("/api/auth/me", { method: "GET", cache: "no-store" })
      if (!res.ok) return null
      const data = await res.json().catch(() => null)
      const id = data?.user?.id
      if (id === undefined || id === null || id === "") return null
      _cachedUserId = String(id)
      return _cachedUserId
    } finally {
      _fetchingUserId = null
    }
  })()

  return await _fetchingUserId
}

async function httpJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}${path}`
  const userId = await getUserIdFromSession()

  const res = await fetch(url, {
    ...init,
    method: init?.method ?? "GET",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "X-User-Id": String(userId) } : {}),
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

  if ("log" in data) {
    return { log: data.log, analyses: Array.isArray(data.analyses) ? data.analyses : [] }
  }

  return {
    log: data as AccessLogItem,
    analyses: Array.isArray((data as any).analyses) ? (data as any).analyses : [],
  }
}

/**
 * Incident APIs (alias: /v1/incidents == /v1/review-events)
 */
export async function apiGetIncidentByLog(logId: number): Promise<GetIncidentByLogResponse> {
  return await httpJson<GetIncidentByLogResponse>(`/v1/incidents/by-log/${logId}`)
}

/**
 * Incident detail (권장: 백엔드가 review_event + access_log join해서 주는 엔드포인트)
 * - 현재 백엔드에 없다면 404가 날 수 있음
 */
export async function apiGetIncident(reviewId: number): Promise<IncidentDetailResponse> {
  return await httpJson<IncidentDetailResponse>(`/v1/incidents/${reviewId}`)
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

export type ListPoliciesResponse = {
  items: Policy[]
  total: number
  limit: number
  offset: number
  sort: string
  dir: string
}

export async function apiListPolicies(params?: {
  limit?: number
  offset?: number
  sort?: string
  dir?: string
}): Promise<ListPoliciesResponse> {
  const qs = buildQuery({
    limit: params?.limit,
    offset: params?.offset,
    sort: params?.sort,
    dir: params?.dir,
  })
  return await httpJson<ListPoliciesResponse>(`/v1/policies${qs}`)
}

/**
 * Policy APIs
 * - 아래 2개 엔드포인트는 FastAPI에 있어야 동작함:
 *   GET /v1/policies/{policy_id}
 *   GET /v1/policies/{policy_id}/rules
 *   PATCH /v1/policies/{policy_id}
 */
export async function apiGetPolicy(policyId: number): Promise<GetPolicyResponse> {
  return await httpJson<GetPolicyResponse>(`/v1/policies/${policyId}`)
}

export async function apiListPolicyRules(policyId: number): Promise<ListPolicyRulesResponse> {
  return await httpJson<ListPolicyRulesResponse>(`/v1/policies/${policyId}/rules`)
}

export async function apiPatchPolicy(policyId: number, req: PatchPolicyRequest): Promise<PatchPolicyResponse> {
  return await httpJson<PatchPolicyResponse>(`/v1/policies/${policyId}`, {
    method: "PATCH",
    body: JSON.stringify(req),
  })
}

/**
 * Policy CREATE APIs
 * - FastAPI에 아래 엔드포인트가 있어야 동작:
 *   POST /v1/policies
 *   POST /v1/policies/{policy_id}/rules
 */
export type CreatePolicyRequest = {
  policy_name: string
  policy_type: PolicyType
  action: PolicyAction
  priority: number
  is_enabled: 0 | 1
  risk_level?: RiskLevel | null
  category?: string | null
  block_status_code?: number | null
  redirect_url?: string | null
  description?: string | null
}

export type CreatePolicyResponse = {
  policy_id?: number
  policy?: Policy
  [k: string]: any
}

export type CreatePolicyRuleRequest = {
  rule_type: string
  match_type: string
  pattern: string
  is_case_sensitive: 0 | 1
  is_negated: 0 | 1
  is_enabled: 0 | 1
  rule_order: number
}

export type CreatePolicyRuleResponse = {
  rule_id?: number
  rule?: PolicyRule
  [k: string]: any
}

export async function apiCreatePolicy(req: CreatePolicyRequest): Promise<CreatePolicyResponse> {
  return await httpJson<CreatePolicyResponse>(`/v1/policies`, {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export async function apiCreatePolicyRule(policyId: number, req: CreatePolicyRuleRequest): Promise<CreatePolicyRuleResponse> {
  return await httpJson<CreatePolicyRuleResponse>(`/v1/policies/${policyId}/rules`, {
    method: "POST",
    body: JSON.stringify(req),
  })
}

/** number | boolean | null -> boolean */
export function toBool(v: any): boolean {
  if (v === true) return true
  if (v === false) return false
  if (v === 1) return true
  if (v === 0) return false
  if (typeof v === "string") {
    const s = v.toLowerCase().trim()
    if (s === "1" || s === "true" || s === "y" || s === "yes") return true
    if (s === "0" || s === "false" || s === "n" || s === "no") return false
  }
  return Boolean(v)
}
