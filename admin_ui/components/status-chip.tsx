import { cn } from "@/lib/utils"

const decisionStyles: Record<string, string> = {
  ALLOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
  BLOCK: "bg-red-50 text-red-700 border-red-200",
  REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
  ERROR: "bg-gray-100 text-gray-600 border-gray-200",
  REDIRECT: "bg-blue-50 text-blue-700 border-blue-200",
}

const stageStyles: Record<string, string> = {
  POLICY_STAGE: "bg-blue-50 text-blue-700 border-blue-200",
  AI_STAGE: "bg-indigo-50 text-indigo-700 border-indigo-200",
  FAIL_STAGE: "bg-red-50 text-red-600 border-red-200",
}

const reasonStyles: Record<string, string> = {
  // AI 실패 원인 (FAIL_STAGE에서 주로 사용)
  AI_TIMEOUT: "bg-amber-50 text-amber-700 border-amber-200",
  AI_HTTP_500: "bg-red-50 text-red-700 border-red-200",
  AI_HTTP_4XX: "bg-rose-50 text-rose-700 border-rose-200",
  AI_RESPONSE_INVALID: "bg-orange-50 text-orange-700 border-orange-200",
  AI_CONNECT_ERROR: "bg-rose-50 text-rose-700 border-rose-200",
  AI_SERVER_ERROR: "bg-red-50 text-red-700 border-red-200",
  AI_UNKNOWN: "bg-gray-100 text-gray-600 border-gray-200",

  // 정책 매칭/기타 (필요 시)
  POLICY: "bg-blue-50 text-blue-700 border-blue-200",
  AI: "bg-indigo-50 text-indigo-700 border-indigo-200",
}

const reviewStatusStyles: Record<string, string> = {
  OPEN: "bg-amber-50 text-amber-700 border-amber-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  CLOSED: "bg-gray-100 text-gray-600 border-gray-200",
}

const policyTypeStyles: Record<string, string> = {
  ALLOWLIST: "bg-emerald-50 text-emerald-700 border-emerald-200",
  BLOCKLIST: "bg-red-50 text-red-700 border-red-200",
  MONITOR: "bg-amber-50 text-amber-700 border-amber-200",
}

const aiLabelStyles: Record<string, string> = {
  MALICIOUS: "bg-red-50 text-red-700 border-red-200",
  SUSPICIOUS: "bg-amber-50 text-amber-700 border-amber-200",
  BENIGN: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UNKNOWN: "bg-gray-100 text-gray-600 border-gray-200",
}

type ChipType = "decision" | "stage" | "reason" | "review" | "policyType" | "aiLabel"

function normalizeReason(v: string): string {
  const s = (v || "").trim()
  if (!s) return "AI_UNKNOWN"

  // 이미 표준키면 그대로
  if (reasonStyles[s]) return s

  // 흔한 케이스 정규화 (FastAPI/DB 값이 조금 흔들려도 UI가 안전하게 표시)
  const u = s.toUpperCase()
  if (u.includes("TIMEOUT")) return "AI_TIMEOUT"
  if (u.includes("INVALID")) return "AI_RESPONSE_INVALID"
  if (u.includes("HTTP_500") || u.includes("500")) return "AI_HTTP_500"
  if (u.includes("HTTP_4") || u.includes("401") || u.includes("403") || u.includes("404")) return "AI_HTTP_4XX"
  if (u.includes("CONNECT") || u.includes("ECONN") || u.includes("REFUSED")) return "AI_CONNECT_ERROR"
  if (u === "POLICY") return "POLICY"
  if (u === "AI") return "AI"
  return "AI_UNKNOWN"
}

export function StatusChip({ value, type = "decision" }: { value: string; type?: ChipType }) {
  const stylesMap =
    type === "stage" ? stageStyles :
    type === "reason" ? reasonStyles :
    type === "review" ? reviewStatusStyles :
    type === "policyType" ? policyTypeStyles :
    type === "aiLabel" ? aiLabelStyles :
    decisionStyles

  const displayValue = type === "reason" ? normalizeReason(value) : value
  const style = stylesMap[displayValue] || "bg-gray-100 text-gray-600 border-gray-200"

  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide border", style)}>
      {displayValue.replace(/_/g, " ")}
    </span>
  )
}
