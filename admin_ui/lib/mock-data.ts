// ─── GateGuard Mock Data ───

export type Decision = "ALLOW" | "BLOCK" | "REVIEW" | "ERROR"
export type DecisionStage = "POLICY_STAGE" | "AI_STAGE" | "FAIL_STAGE"
export type ReviewStatus = "OPEN" | "IN_PROGRESS" | "CLOSED"
export type PolicyType = "ALLOWLIST" | "BLOCKLIST" | "MONITOR"
export type PolicyAction = "ALLOW" | "BLOCK" | "REDIRECT" | "REVIEW"
export type RuleType = "HOST" | "PATH" | "URL"
export type MatchType = "EXACT" | "PREFIX" | "CONTAINS" | "REGEX"
export type AuditAction = "CREATE" | "UPDATE" | "DELETE"
export type UserRole = "Operator" | "Admin" | "Engineer"
export type AILabel = "MALICIOUS" | "SUSPICIOUS" | "BENIGN" | "UNKNOWN"

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  avatar?: string
}

export interface AccessLog {
  log_id: string
  request_id: string
  detect_timestamp: string
  client_ip: string
  client_port: number
  server_ip: string
  server_port: number
  host: string
  path: string
  method: string
  url_norm: string
  decision: Decision
  reason: string
  decision_stage: DecisionStage
  policy_id: string | null
  user_agent: string
  engine_latency_ms: number
  inject_attempted: boolean
  inject_send: boolean
  inject_errno: number | null
  inject_latency_ms: number | null
  inject_status_code: number | null
}

export interface AIAnalysis {
  ai_analysis_id: string
  log_id: string
  analyzed_at: string
  score: number
  label: AILabel
  ai_response: string
  latency_ms: number
  model_version: string
  error_code: string | null
  analysis_seq: number
}

export interface ReviewEvent {
  review_id: string
  log_id: string
  status: ReviewStatus
  proposed_action: string
  reviewer_id: string | null
  reviewer_name: string | null
  reviewed_at: string | null
  note: string | null
  generated_policy_id: string | null
  created_at: string
  host: string
  path: string
  decision: Decision
  ai_score: number | null
}

export interface Policy {
  policy_id: string
  policy_name: string
  policy_type: PolicyType
  action: PolicyAction
  priority: number
  is_enabled: boolean
  risk_level: string
  category: string
  block_status_code: number | null
  redirect_url: string | null
  description: string
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

export interface PolicyRule {
  rule_id: string
  policy_id: string
  rule_type: RuleType
  match_type: MatchType
  pattern: string
  is_case_sensitive: boolean
  is_negated: boolean
  rule_order: number
  is_enabled: boolean
  created_at: string
}

export interface PolicyAudit {
  audit_id: string
  policy_id: string
  policy_name: string
  action: AuditAction
  changed_by: string
  changed_at: string
  before_snapshot: Record<string, unknown> | null
  after_snapshot: Record<string, unknown> | null
  source_review_id: string | null
  change_note: string
}

// ─── Users ───
export const mockUsers: User[] = [
  { id: "u-1", name: "Sarah Chen", email: "sarah.chen@gateguard.io", role: "Admin" },
  { id: "u-2", name: "James Park", email: "james.park@gateguard.io", role: "Operator" },
  { id: "u-3", name: "Maria Santos", email: "maria.santos@gateguard.io", role: "Engineer" },
  { id: "u-4", name: "Alex Kim", email: "alex.kim@gateguard.io", role: "Operator" },
]

// ─── Access Logs ───
const hosts = ["malware-cdn.evil.net", "phishing-bank.com", "api.legit-service.com", "cdn.trusted.io", "login.fake-portal.xyz", "download.sketchy.ru", "docs.internal.corp", "payment.safe-bank.com", "tracker.adnetwork.io", "store.ecommerce.com"]
const paths = ["/login", "/api/transfer", "/download/payload.exe", "/checkout", "/admin/config", "/static/logo.png", "/api/v2/users", "/webhook/callback", "/images/banner.jpg", "/oauth/authorize"]
const methods = ["GET", "POST", "GET", "POST", "GET", "GET", "GET", "POST", "GET", "GET"]
const decisions: Decision[] = ["BLOCK", "BLOCK", "ALLOW", "ALLOW", "BLOCK", "BLOCK", "ALLOW", "ALLOW", "REVIEW", "ALLOW"]
const stages: DecisionStage[] = ["AI_STAGE", "POLICY_STAGE", "POLICY_STAGE", "POLICY_STAGE", "AI_STAGE", "AI_STAGE", "POLICY_STAGE", "POLICY_STAGE", "AI_STAGE", "POLICY_STAGE"]
const reasons = [
  "AI score 0.92 exceeds threshold",
  "Matched blocklist policy BLK-001",
  "Matched allowlist policy ALW-003",
  "Matched allowlist policy ALW-001",
  "AI score 0.87 exceeds threshold",
  "AI score 0.95 exceeds threshold",
  "Matched allowlist policy ALW-002",
  "Matched allowlist policy ALW-001",
  "AI score 0.65 requires review",
  "Matched allowlist policy ALW-003",
]
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "curl/7.88.1",
  "python-requests/2.31.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "Go-http-client/2.0",
]

function makeTimestamp(daysAgo: number, hoursAgo: number = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(d.getHours() - hoursAgo)
  return d.toISOString()
}

export const mockAccessLogs: AccessLog[] = Array.from({ length: 50 }, (_, i) => {
  const idx = i % 10
  const dec = decisions[idx]
  const host = hosts[idx]
  const path = paths[idx]
  return {
    log_id: `log-${String(i + 1).padStart(5, "0")}`,
    request_id: `req-${String(i + 1).padStart(5, "0")}`,
    detect_timestamp: makeTimestamp(Math.floor(i / 5), i % 24),
    client_ip: `192.168.${1 + (i % 5)}.${10 + (i % 250)}`,
    client_port: 40000 + (i * 13) % 25000,
    server_ip: "10.0.1.50",
    server_port: 443,
    host,
    path,
    method: methods[idx],
    url_norm: `${host}${path}`.toLowerCase(),
    decision: dec,
    reason: reasons[idx],
    decision_stage: stages[idx],
    policy_id: stages[idx] === "POLICY_STAGE" ? `POL-${String((i % 5) + 1).padStart(3, "0")}` : null,
    user_agent: userAgents[i % userAgents.length],
    engine_latency_ms: Math.floor(Math.random() * 45) + 5,
    inject_attempted: dec === "BLOCK",
    inject_send: dec === "BLOCK" && Math.random() > 0.1,
    inject_errno: dec === "BLOCK" && Math.random() < 0.1 ? 110 : null,
    inject_latency_ms: dec === "BLOCK" ? Math.floor(Math.random() * 15) + 1 : null,
    inject_status_code: dec === "BLOCK" ? 403 : null,
  }
})

// ─── AI Analysis ───
let aiSeqCounter = 0
export const mockAIAnalyses: AIAnalysis[] = mockAccessLogs
  .filter(l => l.decision_stage === "AI_STAGE" || l.decision === "REVIEW")
  .flatMap((log, i) => {
    const base: AIAnalysis = {
      ai_analysis_id: `ai-${String(i + 1).padStart(5, "0")}-0`,
      log_id: log.log_id,
      analyzed_at: log.detect_timestamp,
      score: log.decision === "BLOCK" ? 0.75 + Math.random() * 0.25 : log.decision === "REVIEW" ? 0.5 + Math.random() * 0.2 : Math.random() * 0.3,
      label: (log.decision === "BLOCK" ? "MALICIOUS" : log.decision === "REVIEW" ? "SUSPICIOUS" : "BENIGN") as AILabel,
      ai_response: log.decision === "BLOCK"
        ? "High confidence malicious URL pattern detected. Domain associated with known threat actors."
        : log.decision === "REVIEW"
        ? "Moderate risk indicators found. URL exhibits characteristics of both legitimate and suspicious patterns."
        : "URL appears benign with low risk indicators.",
      latency_ms: Math.floor(Math.random() * 200) + 50,
      model_version: i % 3 === 0 ? "v2.4.1" : i % 3 === 1 ? "v2.4.0" : "v2.3.8",
      error_code: Math.random() < 0.05 ? "ERR-03" : null,
      analysis_seq: aiSeqCounter++,
    }
    // Add a second analysis for some entries to show 1:N
    if (i % 4 === 0) {
      return [base, {
        ...base,
        ai_analysis_id: `ai-${String(i + 1).padStart(5, "0")}-1`,
        analyzed_at: makeTimestamp(0, 1),
        score: base.score + (Math.random() * 0.05 - 0.025),
        latency_ms: Math.floor(Math.random() * 150) + 60,
        model_version: "v2.4.1",
        analysis_seq: aiSeqCounter++,
      }]
    }
    return [base]
  })

// ─── Review Events / Incidents ───
export const mockReviewEvents: ReviewEvent[] = [
  { review_id: "rev-001", log_id: "log-00009", status: "OPEN", proposed_action: "BLOCK", reviewer_id: null, reviewer_name: null, reviewed_at: null, note: null, generated_policy_id: null, created_at: makeTimestamp(0, 2), host: "tracker.adnetwork.io", path: "/webhook/callback", decision: "REVIEW", ai_score: 0.65 },
  { review_id: "rev-002", log_id: "log-00019", status: "OPEN", proposed_action: "BLOCK", reviewer_id: null, reviewer_name: null, reviewed_at: null, note: null, generated_policy_id: null, created_at: makeTimestamp(0, 5), host: "tracker.adnetwork.io", path: "/webhook/callback", decision: "REVIEW", ai_score: 0.68 },
  { review_id: "rev-003", log_id: "log-00001", status: "IN_PROGRESS", proposed_action: "BLOCK", reviewer_id: "u-2", reviewer_name: "James Park", reviewed_at: null, note: "Investigating traffic pattern", generated_policy_id: null, created_at: makeTimestamp(1, 3), host: "malware-cdn.evil.net", path: "/login", decision: "BLOCK", ai_score: 0.92 },
  { review_id: "rev-004", log_id: "log-00006", status: "IN_PROGRESS", proposed_action: "BLOCK", reviewer_id: "u-4", reviewer_name: "Alex Kim", reviewed_at: null, note: "Known malware distribution", generated_policy_id: null, created_at: makeTimestamp(1, 8), host: "download.sketchy.ru", path: "/download/payload.exe", decision: "BLOCK", ai_score: 0.95 },
  { review_id: "rev-005", log_id: "log-00002", status: "CLOSED", proposed_action: "BLOCK", reviewer_id: "u-2", reviewer_name: "James Park", reviewed_at: makeTimestamp(2, 1), note: "Confirmed phishing. Policy created.", generated_policy_id: "POL-006", created_at: makeTimestamp(3, 0), host: "phishing-bank.com", path: "/api/transfer", decision: "BLOCK", ai_score: 0.88 },
  { review_id: "rev-006", log_id: "log-00005", status: "CLOSED", proposed_action: "BLOCK", reviewer_id: "u-1", reviewer_name: "Sarah Chen", reviewed_at: makeTimestamp(4, 2), note: "False positive. Domain is legitimate.", generated_policy_id: null, created_at: makeTimestamp(5, 0), host: "login.fake-portal.xyz", path: "/admin/config", decision: "BLOCK", ai_score: 0.87 },
]

// ─── Policies ───
export const mockPolicies: Policy[] = [
  { policy_id: "POL-001", policy_name: "Internal Corp Allowlist", policy_type: "ALLOWLIST", action: "ALLOW", priority: 100, is_enabled: true, risk_level: "LOW", category: "Internal", block_status_code: null, redirect_url: null, description: "Allow all traffic to internal corporate domains", created_by: "Sarah Chen", created_at: makeTimestamp(90), updated_by: "Sarah Chen", updated_at: makeTimestamp(30) },
  { policy_id: "POL-002", policy_name: "Trusted CDN Allowlist", policy_type: "ALLOWLIST", action: "ALLOW", priority: 90, is_enabled: true, risk_level: "LOW", category: "CDN", block_status_code: null, redirect_url: null, description: "Allow known CDN and static asset domains", created_by: "Sarah Chen", created_at: makeTimestamp(85), updated_by: "Maria Santos", updated_at: makeTimestamp(15) },
  { policy_id: "POL-003", policy_name: "Payment Gateway Allowlist", policy_type: "ALLOWLIST", action: "ALLOW", priority: 95, is_enabled: true, risk_level: "LOW", category: "Finance", block_status_code: null, redirect_url: null, description: "Allow verified payment processing domains", created_by: "Sarah Chen", created_at: makeTimestamp(80), updated_by: "Sarah Chen", updated_at: makeTimestamp(10) },
  { policy_id: "POL-004", policy_name: "Known Malware Blocklist", policy_type: "BLOCKLIST", action: "BLOCK", priority: 200, is_enabled: true, risk_level: "CRITICAL", category: "Malware", block_status_code: 403, redirect_url: null, description: "Block known malware distribution domains", created_by: "James Park", created_at: makeTimestamp(60), updated_by: "James Park", updated_at: makeTimestamp(5) },
  { policy_id: "POL-005", policy_name: "Phishing Domain Blocklist", policy_type: "BLOCKLIST", action: "BLOCK", priority: 195, is_enabled: true, risk_level: "HIGH", category: "Phishing", block_status_code: 403, redirect_url: null, description: "Block known phishing and credential harvesting domains", created_by: "Alex Kim", created_at: makeTimestamp(45), updated_by: "Alex Kim", updated_at: makeTimestamp(3) },
  { policy_id: "POL-006", policy_name: "Phishing Bank Block", policy_type: "BLOCKLIST", action: "BLOCK", priority: 190, is_enabled: true, risk_level: "HIGH", category: "Phishing", block_status_code: 403, redirect_url: null, description: "Block phishing-bank.com - confirmed phishing from review rev-005", created_by: "James Park", created_at: makeTimestamp(2), updated_by: "James Park", updated_at: makeTimestamp(2) },
  { policy_id: "POL-007", policy_name: "Ad Tracker Monitor", policy_type: "MONITOR", action: "REVIEW", priority: 50, is_enabled: true, risk_level: "MEDIUM", category: "Tracking", block_status_code: null, redirect_url: null, description: "Monitor ad tracking domains for suspicious patterns", created_by: "Maria Santos", created_at: makeTimestamp(30), updated_by: "Maria Santos", updated_at: makeTimestamp(7) },
  { policy_id: "POL-008", policy_name: "Deprecated Redirect", policy_type: "BLOCKLIST", action: "REDIRECT", priority: 80, is_enabled: false, risk_level: "LOW", category: "Deprecated", block_status_code: null, redirect_url: "https://warning.gateguard.io/blocked", description: "Redirect deprecated service URLs to warning page", created_by: "Sarah Chen", created_at: makeTimestamp(120), updated_by: "Sarah Chen", updated_at: makeTimestamp(60) },
]

// ─── Policy Rules ───
export const mockPolicyRules: PolicyRule[] = [
  { rule_id: "r-001", policy_id: "POL-001", rule_type: "HOST", match_type: "CONTAINS", pattern: ".internal.corp", is_case_sensitive: false, is_negated: false, rule_order: 1, is_enabled: true, created_at: makeTimestamp(90) },
  { rule_id: "r-002", policy_id: "POL-001", rule_type: "HOST", match_type: "EXACT", pattern: "docs.internal.corp", is_case_sensitive: false, is_negated: false, rule_order: 2, is_enabled: true, created_at: makeTimestamp(90) },
  { rule_id: "r-003", policy_id: "POL-002", rule_type: "HOST", match_type: "CONTAINS", pattern: "cdn.", is_case_sensitive: false, is_negated: false, rule_order: 1, is_enabled: true, created_at: makeTimestamp(85) },
  { rule_id: "r-004", policy_id: "POL-002", rule_type: "HOST", match_type: "EXACT", pattern: "cdn.trusted.io", is_case_sensitive: false, is_negated: false, rule_order: 2, is_enabled: true, created_at: makeTimestamp(85) },
  { rule_id: "r-005", policy_id: "POL-003", rule_type: "HOST", match_type: "EXACT", pattern: "payment.safe-bank.com", is_case_sensitive: false, is_negated: false, rule_order: 1, is_enabled: true, created_at: makeTimestamp(80) },
  { rule_id: "r-006", policy_id: "POL-004", rule_type: "HOST", match_type: "EXACT", pattern: "malware-cdn.evil.net", is_case_sensitive: false, is_negated: false, rule_order: 1, is_enabled: true, created_at: makeTimestamp(60) },
  { rule_id: "r-007", policy_id: "POL-004", rule_type: "HOST", match_type: "REGEX", pattern: ".*\\.evil\\.(net|com)", is_case_sensitive: false, is_negated: false, rule_order: 2, is_enabled: true, created_at: makeTimestamp(60) },
  { rule_id: "r-008", policy_id: "POL-005", rule_type: "HOST", match_type: "CONTAINS", pattern: "phishing", is_case_sensitive: false, is_negated: false, rule_order: 1, is_enabled: true, created_at: makeTimestamp(45) },
  { rule_id: "r-009", policy_id: "POL-005", rule_type: "HOST", match_type: "CONTAINS", pattern: "fake-portal", is_case_sensitive: false, is_negated: false, rule_order: 2, is_enabled: true, created_at: makeTimestamp(45) },
  { rule_id: "r-010", policy_id: "POL-006", rule_type: "HOST", match_type: "EXACT", pattern: "phishing-bank.com", is_case_sensitive: false, is_negated: false, rule_order: 1, is_enabled: true, created_at: makeTimestamp(2) },
  { rule_id: "r-011", policy_id: "POL-007", rule_type: "HOST", match_type: "CONTAINS", pattern: "adnetwork", is_case_sensitive: false, is_negated: false, rule_order: 1, is_enabled: true, created_at: makeTimestamp(30) },
  { rule_id: "r-012", policy_id: "POL-007", rule_type: "HOST", match_type: "CONTAINS", pattern: "tracker", is_case_sensitive: false, is_negated: false, rule_order: 2, is_enabled: true, created_at: makeTimestamp(30) },
]

// ─── Policy Audit ───
export const mockPolicyAudits: PolicyAudit[] = [
  { audit_id: "aud-001", policy_id: "POL-006", policy_name: "Phishing Bank Block", action: "CREATE", changed_by: "James Park", changed_at: makeTimestamp(2), before_snapshot: null, after_snapshot: { policy_name: "Phishing Bank Block", action: "BLOCK", priority: 190 }, source_review_id: "rev-005", change_note: "Policy created from incident review rev-005" },
  { audit_id: "aud-002", policy_id: "POL-004", policy_name: "Known Malware Blocklist", action: "UPDATE", changed_by: "James Park", changed_at: makeTimestamp(5), before_snapshot: { priority: 180 }, after_snapshot: { priority: 200 }, source_review_id: null, change_note: "Increased priority to ensure malware blocks take precedence" },
  { audit_id: "aud-003", policy_id: "POL-002", policy_name: "Trusted CDN Allowlist", action: "UPDATE", changed_by: "Maria Santos", changed_at: makeTimestamp(15), before_snapshot: { description: "Allow CDN domains" }, after_snapshot: { description: "Allow known CDN and static asset domains" }, source_review_id: null, change_note: "Updated description for clarity" },
  { audit_id: "aud-004", policy_id: "POL-007", policy_name: "Ad Tracker Monitor", action: "CREATE", changed_by: "Maria Santos", changed_at: makeTimestamp(30), before_snapshot: null, after_snapshot: { policy_name: "Ad Tracker Monitor", action: "REVIEW", priority: 50 }, source_review_id: null, change_note: "New monitoring policy for ad tracker domains" },
  { audit_id: "aud-005", policy_id: "POL-008", policy_name: "Deprecated Redirect", action: "UPDATE", changed_by: "Sarah Chen", changed_at: makeTimestamp(60), before_snapshot: { is_enabled: true }, after_snapshot: { is_enabled: false }, source_review_id: null, change_note: "Disabled deprecated redirect policy" },
]

// ─── Dashboard Stats ───
export const dashboardStats = {
  totalRequests: 12847,
  blockedRequests: 3412,
  blockRate: 26.6,
  aiEnforcedBlocks: 1893,
  policyEnforcedBlocks: 1519,
  openIncidents: mockReviewEvents.filter(r => r.status === "OPEN").length,
}

// ─── Chart Data ───
export const requestsOverTime = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, "0")}:00`,
  requests: Math.floor(Math.random() * 400) + 200,
}))

export const blockVsAllowOverTime = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, "0")}:00`,
  allow: Math.floor(Math.random() * 300) + 150,
  block: Math.floor(Math.random() * 120) + 30,
  review: Math.floor(Math.random() * 20) + 2,
}))

export const topHosts = [
  { host: "malware-cdn.evil.net", count: 487 },
  { host: "phishing-bank.com", count: 342 },
  { host: "tracker.adnetwork.io", count: 298 },
  { host: "download.sketchy.ru", count: 256 },
  { host: "login.fake-portal.xyz", count: 189 },
  { host: "api.legit-service.com", count: 156 },
  { host: "cdn.trusted.io", count: 134 },
  { host: "store.ecommerce.com", count: 98 },
]

export const topPaths = [
  { path: "/api/transfer", count: 412 },
  { path: "/login", count: 387 },
  { path: "/download/payload.exe", count: 298 },
  { path: "/admin/config", count: 234 },
  { path: "/webhook/callback", count: 189 },
  { path: "/checkout", count: 145 },
]

export const aiScoreDistribution = [
  { range: "0.0-0.1", count: 1245 },
  { range: "0.1-0.2", count: 987 },
  { range: "0.2-0.3", count: 756 },
  { range: "0.3-0.4", count: 543 },
  { range: "0.4-0.5", count: 432 },
  { range: "0.5-0.6", count: 321 },
  { range: "0.6-0.7", count: 298 },
  { range: "0.7-0.8", count: 456 },
  { range: "0.8-0.9", count: 678 },
  { range: "0.9-1.0", count: 543 },
]

export const aiLatencyOverTime = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, "0")}:00`,
  avg_latency: Math.floor(Math.random() * 80) + 60,
  p95_latency: Math.floor(Math.random() * 120) + 100,
}))
