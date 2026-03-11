import { cn } from "@/lib/utils"

/*
GateGuard Status Chip
*/

type ChipType =
  | "decision"
  | "stage"
  | "reason"
  | "review"
  | "policyType"
  | "aiLabel"
  | "health"

type ChipSize = "sm" | "md"

/*
decision 상태
*/
const decisionStyles: Record<string, string> = {
  ALLOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
  BLOCK: "bg-red-50 text-red-700 border-red-200",
  REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
  ERROR: "bg-gray-100 text-gray-600 border-gray-200",
  REDIRECT: "bg-blue-50 text-blue-700 border-blue-200",
}

/*
stage 상태
*/
const stageStyles: Record<string, string> = {
  POLICY_STAGE: "bg-blue-50 text-blue-700 border-blue-200",
  AI_STAGE: "bg-indigo-50 text-indigo-700 border-indigo-200",
  FAIL_STAGE: "bg-red-50 text-red-700 border-red-200",
}

/*
reason 상태
*/
const reasonStyles: Record<string, string> = {
  AI_TIMEOUT: "bg-amber-50 text-amber-700 border-amber-200",
  AI_HTTP_500: "bg-red-50 text-red-700 border-red-200",
  AI_HTTP_4XX: "bg-rose-50 text-rose-700 border-rose-200",
  AI_RESPONSE_INVALID: "bg-orange-50 text-orange-700 border-orange-200",
  AI_CONNECT_ERROR: "bg-rose-50 text-rose-700 border-rose-200",
  AI_SERVER_ERROR: "bg-red-50 text-red-700 border-red-200",
  AI_UNKNOWN: "bg-gray-100 text-gray-600 border-gray-200",
  POLICY: "bg-blue-50 text-blue-700 border-blue-200",
  AI: "bg-indigo-50 text-indigo-700 border-indigo-200",
}

/*
incident review 상태
*/
const reviewStatusStyles: Record<string, string> = {
  OPEN: "bg-amber-50 text-amber-700 border-amber-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  CLOSED: "bg-gray-100 text-gray-600 border-gray-200",
}

/*
policy 타입
*/
const policyTypeStyles: Record<string, string> = {
  ALLOWLIST: "bg-emerald-50 text-emerald-700 border-emerald-200",
  BLOCKLIST: "bg-red-50 text-red-700 border-red-200",
  MONITOR: "bg-amber-50 text-amber-700 border-amber-200",
}

/*
AI label
*/
const aiLabelStyles: Record<string, string> = {
  MALICIOUS: "bg-red-50 text-red-700 border-red-200",
  SUSPICIOUS: "bg-amber-50 text-amber-700 border-amber-200",
  BENIGN: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UNKNOWN: "bg-gray-100 text-gray-600 border-gray-200",
}

/*
system health 상태
*/
const healthStyles: Record<string, string> = {
  RUNNING: "bg-emerald-50 text-emerald-700 border-emerald-200",
  STOPPED: "bg-gray-100 text-gray-600 border-gray-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
  STARTING: "bg-blue-50 text-blue-700 border-blue-200",
  STOPPING: "bg-amber-50 text-amber-700 border-amber-200",
  MISSING: "bg-gray-100 text-gray-600 border-gray-200",
  UNKNOWN: "bg-gray-100 text-gray-600 border-gray-200",
}

/*
기본 fallback
*/
const fallbackStyle = "bg-gray-100 text-gray-600 border-gray-200"

/*
reason 값 정규화
*/
function normalizeReason(v: string): string {
  const s = (v || "").trim()
  if (!s) return "AI_UNKNOWN"

  if (reasonStyles[s]) return s

  const u = s.toUpperCase()

  if (u.includes("TIMEOUT")) return "AI_TIMEOUT"
  if (u.includes("INVALID")) return "AI_RESPONSE_INVALID"
  if (u.includes("HTTP_500") || u.includes(" 500") || u.endsWith("500") || u === "500") return "AI_HTTP_500"
  if (
    u.includes("HTTP_4") ||
    u.includes("401") ||
    u.includes("403") ||
    u.includes("404")
  ) {
    return "AI_HTTP_4XX"
  }
  if (
    u.includes("CONNECT") ||
    u.includes("ECONN") ||
    u.includes("REFUSED") ||
    u.includes("UNREACH")
  ) {
    return "AI_CONNECT_ERROR"
  }
  if (u.includes("SERVER")) return "AI_SERVER_ERROR"
  if (u === "POLICY") return "POLICY"
  if (u === "AI") return "AI"

  return "AI_UNKNOWN"
}

/*
health 값 정규화
*/
function normalizeHealth(v: string): string {
  const s = (v || "").trim()
  if (!s) return "UNKNOWN"

  const u = s.toUpperCase()

  if (u === "ACTIVE" || u === "RUNNING" || u === "LOADED") return "RUNNING"
  if (u === "INACTIVE" || u === "STOPPED") return "STOPPED"
  if (u === "FAILED") return "FAILED"
  if (u === "ACTIVATING" || u === "STARTING") return "STARTING"
  if (u === "DEACTIVATING" || u === "STOPPING") return "STOPPING"
  if (u === "MISSING") return "MISSING"

  return "UNKNOWN"
}

/*
표시용 값 정규화
*/
function normalizeDisplayValue(value: string, type: ChipType): string {
  if (type === "reason") return normalizeReason(value)
  if (type === "health") return normalizeHealth(value)
  return value
}

export function StatusChip({
  value,
  type = "decision",
  size = "md",
}: {
  value: string
  type?: ChipType
  size?: ChipSize
}) {
  const stylesMap =
    type === "stage"
      ? stageStyles
      : type === "reason"
      ? reasonStyles
      : type === "review"
      ? reviewStatusStyles
      : type === "policyType"
      ? policyTypeStyles
      : type === "aiLabel"
      ? aiLabelStyles
      : type === "health"
      ? healthStyles
      : decisionStyles

  const displayValue = normalizeDisplayValue(value, type)

  const style = stylesMap[displayValue] || fallbackStyle

  const sizeClass =
    size === "sm"
      ? "text-[10px] px-1.5 py-0.5"
      : "text-[11px] px-2 py-0.5"

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border font-semibold tracking-wide uppercase",
        sizeClass,
        style
      )}
    >
      {displayValue.replace(/_/g, " ")}
    </span>
  )
}
