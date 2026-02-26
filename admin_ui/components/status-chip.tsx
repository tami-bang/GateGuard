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

type ChipType = "decision" | "stage" | "review" | "policyType" | "aiLabel"

export function StatusChip({ value, type = "decision" }: { value: string; type?: ChipType }) {
  const stylesMap =
    type === "stage" ? stageStyles :
    type === "review" ? reviewStatusStyles :
    type === "policyType" ? policyTypeStyles :
    type === "aiLabel" ? aiLabelStyles :
    decisionStyles
  const style = stylesMap[value] || "bg-gray-100 text-gray-600 border-gray-200"

  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide border", style)}>
      {value.replace(/_/g, " ")}
    </span>
  )
}
