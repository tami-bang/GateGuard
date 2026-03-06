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

  // 최신 AI 요약
  ai_score: number | null
  ai_label?: string | null
  ai_model_version: string | null
  ai_latency_ms?: number | null
  ai_error_code?: string | null
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

export type LogDetail = { log: AccessLogItem; analyses: AIAnalysisItem[] }
type LogDetailRespA = { log: AccessLogItem; analyses: AIAnalysisItem[] }
type LogDetailRespB = AccessLogItem & { analyses?: AIAnalysisItem[] }

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

export type IncidentDetailResponse = {
  review_event: ReviewEvent
  log: AccessLogItem | null
  analyses?: AIAnalysisItem[]
  policy?: Policy | null
}

export type PolicyAuditAction = "CREATE" | "UPDATE" | "DELETE" | string

export type PolicyAuditItem = {
  audit_id: number
  policy_id: number
  policy_name: string | null
  action: PolicyAuditAction
  changed_by: number | string | null
  changed_at: string | null
  source_review_id: number | null
  change_note: string | null
  before_snapshot: string | null
  after_snapshot: string | null
}

export type ListPolicyAuditsResponse = {
  items: PolicyAuditItem[]
  total: number
  limit: number
  offset: number
  sort: string
  dir: string
}

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

// logs 목록 API
export async function apiListLogs(params: {
  limit?: number
  offset?: number
  decision?: string
  stage?: string
  host?: string
  client_ip?: string
  start_time?: string
  end_time?: string
  min_score?: number
  max_score?: number
  inject_attempted?: number
  inject_send?: number
  inject_status_code?: number
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
    start_time: params.start_time,
    end_time: params.end_time,
    min_score: params.min_score,
    max_score: params.max_score,
    inject_attempted: params.inject_attempted,
    inject_send: params.inject_send,
    inject_status_code: params.inject_status_code,
    sort: params.sort,
    dir: params.dir,
  })
  return await httpJson<ListLogsResponse>(`/v1/logs${qs}`)
}

// logs 상세 API
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

// incident API
export type IncidentListResponse = {
  items: ReviewEvent[]
  total: number
  page: number
  limit: number
}

export async function apiListIncidents(params?: {
  status?: ReviewStatus | "all"
  limit?: number
  page?: number
}): Promise<IncidentListResponse> {
  const qs = new URLSearchParams()

  if (params?.status && params.status !== "all") {
    qs.set("status", params.status)
  }

  if (params?.limit) {
    qs.set("limit", String(params.limit))
  }

  if (params?.page) {
    qs.set("page", String(params.page))
  }

  const suffix = qs.toString() ? `?${qs.toString()}` : ""

  return await httpJson<IncidentListResponse>(`/v1/incidents${suffix}`)
}
export async function apiGetIncidentByLog(logId: number): Promise<GetIncidentByLogResponse> {
  return await httpJson<GetIncidentByLogResponse>(`/v1/incidents/by-log/${logId}`)
}

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

// policy 목록 API
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

// policy 상세 API
export async function apiGetPolicy(policyId: number): Promise<GetPolicyResponse> {
  return await httpJson<GetPolicyResponse>(`/v1/policies/${policyId}`)
}

// policy rule 목록 API
export async function apiListPolicyRules(policyId: number): Promise<ListPolicyRulesResponse> {
  return await httpJson<ListPolicyRulesResponse>(`/v1/policies/${policyId}/rules`)
}

// policy 수정 API
export async function apiPatchPolicy(policyId: number, req: PatchPolicyRequest): Promise<PatchPolicyResponse> {
  return await httpJson<PatchPolicyResponse>(`/v1/policies/${policyId}`, {
    method: "PATCH",
    body: JSON.stringify(req),
  })
}

export async function apiListPolicyAudits(params?: {
  limit?: number
  offset?: number
  policy_id?: number
  action?: string
  source_review_id?: number
  sort?: string
  dir?: string
}): Promise<ListPolicyAuditsResponse> {
  const qs = buildQuery({
    limit: params?.limit,
    offset: params?.offset,
    policy_id: params?.policy_id,
    action: params?.action,
    source_review_id: params?.source_review_id,
    sort: params?.sort,
    dir: params?.dir,
  })

  return await httpJson<ListPolicyAuditsResponse>(`/v1/policy-audits${qs}`)
}

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

// policy 생성 API
export async function apiCreatePolicy(req: CreatePolicyRequest): Promise<CreatePolicyResponse> {
  return await httpJson<CreatePolicyResponse>(`/v1/policies`, {
    method: "POST",
    body: JSON.stringify(req),
  })
}

// policy rule 생성 API
export async function apiCreatePolicyRule(policyId: number, req: CreatePolicyRuleRequest): Promise<CreatePolicyRuleResponse> {
  return await httpJson<CreatePolicyRuleResponse>(`/v1/policies/${policyId}/rules`, {
    method: "POST",
    body: JSON.stringify(req),
  })
}

// boolean 정규화
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
