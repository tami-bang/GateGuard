"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import {
  Globe,
  ShieldOff,
  Brain,
  FileText,
  Server,
  Database,
  Cpu,
  Activity,
  ArrowRight,
  BellRing,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"

import {
  apiGetAiThreatDistribution,
  apiGetDashboardSummary,
  apiGetSystemHealth,
  type DashboardAiThreatDistributionItem,
  type DashboardResponse,
  type SystemHealthResponse,
} from "@/lib/api-client"

type TopClientIp = {
  client_ip: string
  count: number
}

type DecisionDistributionItem = {
  decision: string
  count: number
}

type PolicyAiCompositionItem = {
  label: string
  count: number
}

type ExtendedSummary = DashboardResponse["summary"] & {
  ai_block_rate?: number
  policy_block_rate?: number
}

type ExtendedDashboardResponse = DashboardResponse & {
  summary: ExtendedSummary
  top_client_ips?: TopClientIp[]
  decision_distribution?: DecisionDistributionItem[]
  policy_vs_ai_composition?: PolicyAiCompositionItem[]
}

type RecentEvent = DashboardResponse["recent_events"][number]

type KpiItem = {
  label: string
  value: string
  rawNumber?: number
  suffix?: string
  icon: LucideIcon
  href: string
  accentClass: string
  subText: string
  animateNumber?: boolean
}

type HealthItem = {
  label: string
  value: string
  icon: LucideIcon
}

type TriageItem = {
  label: string
  value: string
  countLabel: string
  description: string
  barWidth: number
  barClass: string
  href: string
}

const GG_COLORS = {
  brand: "#1E3A8A",
  primary: "#3B82F6",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
  ai: "#6366F1",
  teal: "#14B8A6",
  border: "#E5E7EB",
  text: "#111827",
  textSecondary: "#6B7280",
  textMuted: "#9CA3AF",
  bgSubtle: "#F8FAFC",
}

const KPI_CARD_HEIGHT = 132
const CHART_CARD_HEIGHT = 236
const BOTTOM_CARD_HEIGHT = 194
const TRIAGE_ROW_HEIGHT = 156
const GRID_GAP_PX = 8
const LIVE_FEED_HEIGHT = KPI_CARD_HEIGHT + CHART_CARD_HEIGHT + GRID_GAP_PX

function formatNumber(v: number | null | undefined): string {
  return Number(v || 0).toLocaleString()
}

function formatPercent(v: number | null | undefined): string {
  return `${Number(v || 0).toFixed(1)}%`
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "N/A"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

function getEventTimestamp(item: RecentEvent): string {
  const event = item as Record<string, unknown>

  const candidate =
    (typeof event.created_at === "string" ? event.created_at : null) ??
    (typeof event.timestamp === "string" ? event.timestamp : null) ??
    (typeof event.detected_at === "string" ? event.detected_at : null) ??
    (typeof event.event_time === "string" ? event.event_time : null)

  return formatTimestamp(candidate)
}

function getEventHref(item: RecentEvent): string {
  const event = item as Record<string, unknown>

  if (event.log_id !== undefined && event.log_id !== null) {
    return `/logs/${encodeURIComponent(String(event.log_id))}`
  }

  const params = new URLSearchParams()

  if (event.request_id !== undefined && event.request_id !== null) {
    params.set("request_id", String(event.request_id))
  }
  if (typeof item.host === "string" && item.host) {
    params.set("host", item.host)
  }
  if (typeof item.client_ip === "string" && item.client_ip) {
    params.set("client_ip", item.client_ip)
  }
  if (typeof item.path === "string" && item.path) {
    params.set("path", item.path)
  }
  if (typeof item.decision === "string" && item.decision) {
    params.set("decision", item.decision)
  }

  const query = params.toString()
  return query ? `/logs?${query}` : "/logs"
}

function normalizeHealthLabel(value: string | null | undefined): string {
  const v = String(value || "").toLowerCase()

  if (!v) return "UNKNOWN"
  if (v === "active") return "RUNNING"
  if (v === "inactive") return "STOPPED"
  if (v === "failed") return "FAILED"
  if (v === "running") return "RUNNING"
  if (v === "error") return "ERROR"
  if (v === "missing") return "MISSING"
  if (v === "loaded") return "RUNNING"
  if (v === "unknown") return "UNKNOWN"

  return v.toUpperCase()
}
const chartTooltipStyle = {
  fontSize: 11,
  borderRadius: 10,
  border: `1px solid ${GG_COLORS.border}`,
  backgroundColor: "#FFFFFF",
}

function getRecentEventRowClass(log: RecentEvent): string {
  const decision = String(log.decision || "").toUpperCase()
  const stage = String(log.decision_stage || "").toUpperCase()

  if (decision === "BLOCK" && stage === "FAIL_STAGE") {
    return "border-l-2 border-l-red-500 bg-red-50/50 hover:bg-red-50"
  }

  if (decision === "BLOCK") {
    return "border-l-2 border-l-red-400 bg-red-50/30 hover:bg-red-50/60"
  }

  if (decision === "REVIEW") {
    return "border-l-2 border-l-amber-400 bg-amber-50/30 hover:bg-amber-50/50"
  }

  return "hover:bg-slate-50"
}

function getKpiAccentClass(label: string): string {
  if (label === "Blocked Requests") return "from-red-500/90 to-red-400/70"
  if (label === "AI Block Rate") return "from-indigo-500/90 to-indigo-400/70"
  if (label === "Policy Block Rate") return "from-blue-600/90 to-blue-400/70"
  return "from-blue-700/90 to-blue-400/70"
}

function getDecisionColor(decision: string): string {
  const v = String(decision || "").toUpperCase()

  if (v === "ALLOW") return GG_COLORS.success
  if (v === "BLOCK") return GG_COLORS.danger
  if (v === "REVIEW") return GG_COLORS.warning
  if (v === "ERROR") return GG_COLORS.textMuted

  return GG_COLORS.primary
}

function getAiThreatColor(label: string): string {
  const v = String(label || "").toLowerCase()

  if (v === "benign") return GG_COLORS.success
  if (v === "phishing") return GG_COLORS.warning
  if (v === "malware") return GG_COLORS.danger

  return GG_COLORS.ai
}

function getHealthBadgeClass(status: string): string {
  const v = String(status || "").toUpperCase()

  if (v === "RUNNING") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  }

  if (v === "STOPPED") {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }
  
  if (v === "FAILED" || v === "ERROR" || v === "MISSING") {
    return "border-red-200 bg-red-50 text-red-700"
  }

  return "border-slate-200 bg-slate-50 text-slate-700"
}

function getSeverityInfo(item: RecentEvent): { label: string; className: string } {
  const decision = String(item.decision || "").toUpperCase()
  const stage = String(item.decision_stage || "").toUpperCase()

  if (decision === "BLOCK" && (stage === "AI_STAGE" || stage === "FAIL_STAGE")) {
    return {
      label: "HIGH",
      className: "border-red-200 bg-red-50 text-red-700",
    }
  }

  if (decision === "BLOCK") {
    return {
      label: "MEDIUM",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    }
  }

  if (decision === "REVIEW") {
    return {
      label: "LOW",
      className: "border-blue-200 bg-blue-50 text-blue-700",
    }
  }

  return {
    label: "INFO",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  }
}

function getDecisionCount(items: DecisionDistributionItem[], decision: string): number {
  return items.find((item) => String(item.decision || "").toUpperCase() === decision)?.count ?? 0
}

function safePercent(value: number, total: number): number {
  if (!total || total <= 0) return 0
  return (value / total) * 100
}

function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(0)

  useEffect(() => {
    let rafId = 0
    const start = performance.now()
    const from = 0
    const to = Number.isFinite(target) ? target : 0

    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / durationMs, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const next = from + (to - from) * eased

      setValue(next)

      if (progress < 1) {
        rafId = requestAnimationFrame(tick)
      }
    }

    setValue(0)
    rafId = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(rafId)
  }, [target, durationMs])

  return value
}

function KpiValue({
  value,
  rawNumber,
  suffix,
  animateNumber = false,
}: {
  value: string
  rawNumber?: number
  suffix?: string
  animateNumber?: boolean
}) {
  const animated = useCountUp(rawNumber ?? 0, 750)

  if (!animateNumber || rawNumber === undefined) {
    return <span className="truncate text-[21px] font-bold leading-none tracking-tight text-[#111827]">{value}</span>
  }

  const display =
    suffix === "%"
      ? `${animated.toFixed(1)}%`
      : Math.round(animated).toLocaleString()

  return <span className="truncate text-[21px] font-bold leading-none tracking-tight text-[#111827]">{display}</span>
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200/70", className)} />
}

function EmptyChartState({
  message,
  height = "h-[150px]",
}: {
  message: string
  height?: string
}) {
  return (
    <div className={cn("flex items-center justify-center text-sm text-[#6B7280]", height)}>
      {message}
    </div>
  )
}

function CountPill({ value }: { value: number | string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-[#6B7280] shadow-sm">
      {value}
    </span>
  )
}

export default function DashboardPage() {
  const [lastHours, setLastHours] = useState<number>(24)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>("")
  const [data, setData] = useState<ExtendedDashboardResponse | null>(null)

  const [healthLoading, setHealthLoading] = useState<boolean>(false)
  const [healthError, setHealthError] = useState<string>("")
  const [health, setHealth] = useState<SystemHealthResponse | null>(null)

  const [aiThreatDist, setAiThreatDist] = useState<DashboardAiThreatDistributionItem[]>([])
  const [aiThreatLoading, setAiThreatLoading] = useState<boolean>(false)
  const [aiThreatError, setAiThreatError] = useState<string>("")

  useEffect(() => {
    let cancelled = false

    async function run() {
      setLoading(true)
      setError("")

      try {
        const res = (await apiGetDashboardSummary(lastHours)) as ExtendedDashboardResponse
        if (!cancelled) {
          setData(res)
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to load dashboard")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [lastHours])

  useEffect(() => {
    let cancelled = false

    async function run() {
      setAiThreatLoading(true)
      setAiThreatError("")

      try {
        const res = await apiGetAiThreatDistribution(lastHours)
        if (!cancelled) {
          setAiThreatDist(res.items ?? [])
        }
      } catch (e: any) {
        if (!cancelled) {
          setAiThreatError(e?.message || "Failed to load AI threat distribution")
          setAiThreatDist([])
        }
      } finally {
        if (!cancelled) {
          setAiThreatLoading(false)
        }
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [lastHours])

  useEffect(() => {
    let cancelled = false

    async function run() {
      setHealthLoading(true)
      setHealthError("")

      try {
        const res = await apiGetSystemHealth()
        if (!cancelled) {
          setHealth(res)
        }
      } catch (e: any) {
        if (!cancelled) {
          setHealthError(e?.message || "Failed to load system health")
        }
      } finally {
        if (!cancelled) {
          setHealthLoading(false)
        }
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [])

  const summary = data?.summary
  const blockedRequests = Number(summary?.blocked_requests || 0)

  const aiBlockRate =
    summary?.ai_block_rate ??
    (blockedRequests <= 0 ? 0 : (Number(summary?.ai_enforced_blocks || 0) / blockedRequests) * 100)

  const policyBlockRate =
    summary?.policy_block_rate ??
    (blockedRequests <= 0 ? 0 : (Number(summary?.policy_enforced_blocks || 0) / blockedRequests) * 100)

  const requestsOverTime = data?.requests_over_time ?? []
  const topHosts = data?.top_hosts ?? []
  const topPaths = data?.top_paths ?? []
  const recentEvents = data?.recent_events ?? []
  const topClientIps: TopClientIp[] = data?.top_client_ips ?? []

  const logsRangeQuery = useMemo(() => `last_hours=${lastHours}`, [lastHours])

  const decisionDistribution = useMemo<DecisionDistributionItem[]>(() => {
    if (data?.decision_distribution) return data.decision_distribution

    const counts = recentEvents.reduce<Record<string, number>>((acc, log) => {
      const key = String(log.decision || "UNKNOWN").toUpperCase()
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    return Object.entries(counts).map(([decision, count]) => ({ decision, count }))
  }, [data?.decision_distribution, recentEvents])

  const policyVsAiComposition = useMemo<PolicyAiCompositionItem[]>(() => {
    if (data?.policy_vs_ai_composition) return data.policy_vs_ai_composition

    return [
      { label: "AI Blocks", count: Number(summary?.ai_enforced_blocks || 0) },
      { label: "Policy Blocks", count: Number(summary?.policy_enforced_blocks || 0) },
    ]
  }, [data?.policy_vs_ai_composition, summary?.ai_enforced_blocks, summary?.policy_enforced_blocks])

  const criticalEvents = useMemo(() => {
    return recentEvents
      .filter((item) => {
        const decision = String(item.decision || "").toUpperCase()
        return decision === "BLOCK" || decision === "REVIEW"
      })
      .slice(0, 3)
  }, [recentEvents])

  const alertCount = useMemo(() => {
    return Number(summary?.open_incidents ?? criticalEvents.length)
  }, [summary?.open_incidents, criticalEvents.length])

  const kpis = useMemo<KpiItem[]>(() => {
    return [
      {
        label: "Total Requests",
        value: formatNumber(summary?.total_requests),
        rawNumber: Number(summary?.total_requests || 0),
        icon: Globe,
        href: `/logs?${logsRangeQuery}`,
        accentClass: getKpiAccentClass("Total Requests"),
        subText: "All observed HTTP requests",
        animateNumber: true,
      },
      {
        label: "Blocked Requests",
        value: formatNumber(summary?.blocked_requests),
        rawNumber: Number(summary?.blocked_requests || 0),
        icon: ShieldOff,
        href: `/logs?decision=BLOCK&${logsRangeQuery}`,
        accentClass: getKpiAccentClass("Blocked Requests"),
        subText: "Directly blocked traffic",
        animateNumber: true,
      },
      {
        label: "AI Block Rate",
        value: formatPercent(aiBlockRate),
        rawNumber: aiBlockRate,
        suffix: "%",
        icon: Brain,
        href: `/logs?decision=BLOCK&stage=AI_STAGE&${logsRangeQuery}`,
        accentClass: getKpiAccentClass("AI Block Rate"),
        subText: "AI-stage share of blocked events",
        animateNumber: true,
      },
      {
        label: "Policy Block Rate",
        value: formatPercent(policyBlockRate),
        rawNumber: policyBlockRate,
        suffix: "%",
        icon: FileText,
        href: `/logs?decision=BLOCK&stage=POLICY_STAGE&${logsRangeQuery}`,
        accentClass: getKpiAccentClass("Policy Block Rate"),
        subText: "Policy-stage share of blocked events",
        animateNumber: true,
      },
    ]
  }, [summary, aiBlockRate, policyBlockRate, logsRangeQuery])

  const healthItems = useMemo<HealthItem[]>(() => {
    return [
      {
        label: "Engine",
        value: normalizeHealthLabel(health?.engine),
        icon: Activity,
      },
      {
        label: "FastAPI",
        value: normalizeHealthLabel(health?.fastapi),
        icon: Server,
      },
      {
        label: "MariaDB",
        value: normalizeHealthLabel(health?.mariadb),
        icon: Database,
      },
      {
        label: "AI Model",
        value: normalizeHealthLabel(health?.ai_model),
        icon: Cpu,
      },
      {
        label: "Model Version",
        value: health?.model_version || "-",
        icon: Cpu,
      },
    ]
  }, [health])

  const allowCount = useMemo(() => getDecisionCount(decisionDistribution, "ALLOW"), [decisionDistribution])
  const blockCount = useMemo(() => getDecisionCount(decisionDistribution, "BLOCK"), [decisionDistribution])
  const reviewCount = useMemo(() => getDecisionCount(decisionDistribution, "REVIEW"), [decisionDistribution])

  const triageItems = useMemo<TriageItem[]>(() => {
    const totalRequests = Number(summary?.total_requests || 0)
    const blocked = Number(summary?.blocked_requests || 0)
    const aiBlocks = Number(summary?.ai_enforced_blocks || 0)
    const policyBlocks = Number(summary?.policy_enforced_blocks || 0)
    const decisionTotal = allowCount + blockCount + reviewCount

    return [
      {
        label: "Block Pressure",
        value: `${safePercent(blocked, totalRequests).toFixed(1)}%`,
        countLabel: `${formatNumber(blocked)} / ${formatNumber(totalRequests)}`,
        description: "Blocked share of total traffic",
        barWidth: safePercent(blocked, totalRequests),
        barClass: "bg-red-500",
        href: `/logs?decision=BLOCK&${logsRangeQuery}`,
      },
      {
        label: "AI Enforcement Bias",
        value: `${safePercent(aiBlocks, blocked).toFixed(1)}%`,
        countLabel: `${formatNumber(aiBlocks)} AI blocks`,
        description: "AI-stage share of blocked events",
        barWidth: safePercent(aiBlocks, blocked),
        barClass: "bg-indigo-500",
        href: `/logs?decision=BLOCK&stage=AI_STAGE&${logsRangeQuery}`,
      },
      {
        label: "Policy Enforcement Bias",
        value: `${safePercent(policyBlocks, blocked).toFixed(1)}%`,
        countLabel: `${formatNumber(policyBlocks)} policy blocks`,
        description: "Policy-stage share of blocked events",
        barWidth: safePercent(policyBlocks, blocked),
        barClass: "bg-blue-500",
        href: `/logs?decision=BLOCK&stage=POLICY_STAGE&${logsRangeQuery}`,
      },
      {
        label: "Review Pressure",
        value: `${safePercent(reviewCount, decisionTotal).toFixed(1)}%`,
        countLabel: `${formatNumber(reviewCount)} review events`,
        description: "Review share across decisions",
        barWidth: safePercent(reviewCount, decisionTotal),
        barClass: "bg-amber-500",
        href: `/logs?decision=REVIEW&${logsRangeQuery}`,
      },
    ]
  }, [summary, allowCount, blockCount, reviewCount, logsRangeQuery])

  return (
    <div className="flex h-[calc(100vh-72px)] flex-col gap-2 overflow-y-auto px-1 pb-1 pr-1">
      <div className="flex shrink-0 flex-col gap-1.5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[#111827]">Dashboard</h1>
          <p className="mt-0.5 text-xs text-[#6B7280]">
            GateGuard AI-driven web access control overview for the last {lastHours} hours
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <span className="font-semibold text-[#111827]">System Status:</span>

            {healthLoading && !health ? (
              <div className="flex gap-2">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <SkeletonBlock key={idx} className="h-5 w-20 rounded-full" />
                ))}
              </div>
            ) : healthError ? (
              <span className="text-red-600">{healthError}</span>
            ) : (
              healthItems.map((item) => (
                <Badge
                  key={item.label}
                  variant="outline"
                  className={cn("gap-1 px-2 py-0.5 text-[11px]", getHealthBadgeClass(item.value))}
                >
                  <item.icon className="size-3" />
                  {item.label}: {item.value}
                </Badge>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 self-start rounded-lg border border-[#E5E7EB] bg-white p-1 shadow-sm">
          <Button
            variant={lastHours === 24 ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setLastHours(24)}
            disabled={loading}
          >
            24h
          </Button>
          <Button
            variant={lastHours === 48 ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setLastHours(48)}
            disabled={loading}
          >
            48h
          </Button>
          <Button
            variant={lastHours === 72 ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setLastHours(72)}
            disabled={loading}
          >
            72h
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border border-red-200 bg-red-50 shadow-sm">
          <CardContent className="p-2 text-sm text-red-700">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid min-h-0 flex-1 content-start gap-2">
        <div className="grid min-h-0 gap-2 xl:grid-cols-[1.06fr_3.14fr]">
          <Card
            className="row-span-2 flex overflow-hidden border border-[#E5E7EB] bg-white shadow-sm"
            style={{ height: `${LIVE_FEED_HEIGHT}px` }}
          >
            <div className="flex h-full w-full flex-col">
              <CardHeader className="shrink-0 pb-1 pt-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
                  <BellRing className="size-4 text-[#1E3A8A]" />
                  Live Threat Feed
                </CardTitle>
              </CardHeader>

              <CardContent className="flex min-h-0 flex-1 flex-col pt-0 pb-3">
                <div className="grid shrink-0 grid-cols-2 gap-1.5">
                  <Link
                    href={`/logs?${logsRangeQuery}`}
                    className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1.5 transition-colors hover:bg-slate-50"
                  >
                    <div className="text-[10px] text-[#6B7280]">Window</div>
                    <div className="text-sm font-semibold text-[#111827]">{lastHours}h</div>
                  </Link>

                  <Link
                    href={`/incidents?status=OPEN`}
                    className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1.5 transition-colors hover:bg-slate-50"
                  >
                    <div className="text-[10px] text-[#6B7280]">Alerts</div>
                    <div className="text-sm font-semibold text-[#111827]">{alertCount}</div>
                  </Link>
                </div>

                <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto pr-1">
                  <div className="flex flex-col gap-1">
                    {criticalEvents.length === 0 ? (
                      <div className="flex h-full min-h-[110px] items-center justify-center rounded-md border border-dashed border-[#E5E7EB] text-xs text-[#6B7280]">
                        No active alerts.
                      </div>
                    ) : (
                      criticalEvents.map((item, index) => {
                        const decision = String(item.decision || "UNKNOWN").toUpperCase()
                        const severity = getSeverityInfo(item)
                        const eventRecord = item as Record<string, unknown>
                        const keyValue =
                          typeof eventRecord.request_id === "string" || typeof eventRecord.request_id === "number"
                            ? String(eventRecord.request_id)
                            : `evt-${index}`

                        return (
                          <Link
                            key={keyValue}
                            href={getEventHref(item)}
                            className={cn(
                              "rounded-md border px-2 py-1.5 transition-colors",
                              getRecentEventRowClass(item)
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-[10px] font-semibold text-[#111827]">
                                  {item.host || "Unknown Host"}
                                </div>
                                <div className="truncate text-[9px] text-[#6B7280]">
                                  {item.path || "/"} · {item.client_ip || "N/A"}
                                </div>
                                <div className="mt-0.5 text-[9px] text-[#9CA3AF]">{getEventTimestamp(item)}</div>
                              </div>

                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <Badge variant="outline" className={cn("text-[9px]", severity.className)}>
                                  {severity.label}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[9px]",
                                    decision === "BLOCK"
                                      ? "border-red-200 bg-red-50 text-red-700"
                                      : "border-amber-200 bg-amber-50 text-amber-700"
                                  )}
                                >
                                  {decision}
                                </Badge>
                              </div>
                            </div>
                          </Link>
                        )
                      })
                    )}
                  </div>
                </div>
              </CardContent>
            </div>
          </Card>

          <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {loading && !data
              ? Array.from({ length: 4 }).map((_, idx) => (
                  <Card
                    key={idx}
                    className="border border-[#E5E7EB] bg-white shadow-sm"
                    style={{ height: `${KPI_CARD_HEIGHT}px` }}
                  >
                    <CardContent className="flex h-full flex-col px-3 pb-3 pt-2">
                      <div className="flex items-center justify-between gap-2">
                        <SkeletonBlock className="h-4 w-24" />
                        <SkeletonBlock className="h-4 w-4" />
                      </div>
                      <div className="flex flex-1 flex-col justify-center gap-1">
                        <SkeletonBlock className="h-7 w-24" />
                        <SkeletonBlock className="h-3 w-28" />
                      </div>
                    </CardContent>
                  </Card>
                ))
              : kpis.map((kpi) => (
                  <Link key={kpi.label} href={kpi.href} className="group block">
                    <Card
                      className="relative overflow-hidden border border-[#E5E7EB] bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                      style={{ height: `${KPI_CARD_HEIGHT}px` }}
                    >
                      <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", kpi.accentClass)} />

                      <CardContent className="flex h-full min-w-0 flex-col px-3 pb-3 pt-2">
                        <div className="flex w-full items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="rounded-md bg-slate-50 p-1.5 transition-colors duration-200 group-hover:bg-slate-100">
                              <kpi.icon className="size-4 text-[#1E3A8A]" />
                            </div>
                            <span className="truncate text-[11px] font-medium text-[#6B7280]">{kpi.label}</span>
                          </div>

                          <ArrowRight className="size-4 shrink-0 text-[#9CA3AF] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#3B82F6]" />
                        </div>

                        <div className="flex flex-1 flex-col justify-center">
                          <KpiValue
                            value={kpi.value}
                            rawNumber={kpi.rawNumber}
                            suffix={kpi.suffix}
                            animateNumber={kpi.animateNumber}
                          />
                          <span className="mt-1 line-clamp-1 text-[10px] text-[#9CA3AF]" title={kpi.subText}>
                            {kpi.subText}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Link href={`/logs?${logsRangeQuery}`} className="group block">
              <Card
                className="flex overflow-hidden border border-[#E5E7EB] bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                style={{ height: `${CHART_CARD_HEIGHT}px` }}
              >
                <div className="flex h-full w-full flex-col">
                  <CardHeader className="shrink-0 pb-1 pt-2.5">
                    <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold text-[#111827]">
                      <span>Hourly Detection Pattern</span>
                      <ArrowRight className="size-4 shrink-0 text-[#9CA3AF] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#3B82F6]" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex min-h-0 flex-1 flex-col justify-center pt-0 pb-3">
                    {requestsOverTime.length === 0 ? (
                      <EmptyChartState message="No request trend data." height="h-[170px]" />
                    ) : (
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={requestsOverTime} margin={{ top: 0, right: 8, left: -18, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={GG_COLORS.border} />
                          <XAxis
                            dataKey="hour"
                            tick={{ fontSize: 9, fill: GG_COLORS.textSecondary }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 9, fill: GG_COLORS.textSecondary }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <Tooltip contentStyle={chartTooltipStyle} />
                          <Line
                            type="monotone"
                            dataKey="requests"
                            stroke={GG_COLORS.primary}
                            strokeWidth={2.35}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </div>
              </Card>
            </Link>

            <Link href={`/logs?stage=AI_STAGE&${logsRangeQuery}`} className="group block">
              <Card
                className="flex overflow-hidden border border-[#E5E7EB] bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                style={{ height: `${CHART_CARD_HEIGHT}px` }}
              >
                <div className="flex h-full w-full flex-col">
                  <CardHeader className="shrink-0 pb-1 pt-2.5">
                    <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold text-[#111827]">
                      <span>AI Threat Distribution</span>
                      <ArrowRight className="size-4 shrink-0 text-[#9CA3AF] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#3B82F6]" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex min-h-0 flex-1 flex-col justify-center pt-0 pb-3">
                    {aiThreatLoading ? (
                      <EmptyChartState message="Loading AI threat distribution..." height="h-[170px]" />
                    ) : aiThreatError ? (
                      <EmptyChartState message={aiThreatError} height="h-[170px]" />
                    ) : aiThreatDist.length === 0 ? (
                      <EmptyChartState message="No AI threat distribution data." height="h-[170px]" />
                    ) : (
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart margin={{ top: 0, right: 4, left: 4, bottom: 12 }}>
                          <Pie
                            data={aiThreatDist}
                            dataKey="count"
                            nameKey="label"
                            cx="50%"
                            cy="43%"
                            innerRadius={30}
                            outerRadius={49}
                            paddingAngle={3}
                          >
                            {aiThreatDist.map((entry, index) => (
                              <Cell key={`${entry.label}-${index}`} fill={getAiThreatColor(entry.label)} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={chartTooltipStyle}
                            formatter={(value: any, _name: any, props: any) => {
                              const payload = props?.payload
                              if (!payload) return [value, "Count"]
                              return [`${payload.count} (${payload.percent}%)`, payload.label]
                            }}
                          />
                          <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </div>
              </Card>
            </Link>

            <Link href={`/logs?${logsRangeQuery}`} className="group block">
              <Card
                className="flex overflow-hidden border border-[#E5E7EB] bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                style={{ height: `${CHART_CARD_HEIGHT}px` }}
              >
                <div className="flex h-full w-full flex-col">
                  <CardHeader className="shrink-0 pb-1 pt-2.5">
                    <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold text-[#111827]">
                      <span>Decision Distribution</span>
                      <ArrowRight className="size-4 shrink-0 text-[#9CA3AF] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#3B82F6]" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex min-h-0 flex-1 flex-col justify-center pt-0 pb-3">
                    {decisionDistribution.length === 0 ? (
                      <EmptyChartState message="No decision distribution data." height="h-[170px]" />
                    ) : (
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart margin={{ top: 0, right: 4, left: 4, bottom: 12 }}>
                          <Pie
                            data={decisionDistribution}
                            dataKey="count"
                            nameKey="decision"
                            cx="50%"
                            cy="43%"
                            innerRadius={30}
                            outerRadius={49}
                            paddingAngle={3}
                          >
                            {decisionDistribution.map((entry, index) => (
                              <Cell key={`${entry.decision}-${index}`} fill={getDecisionColor(entry.decision)} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={chartTooltipStyle} />
                          <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </div>
              </Card>
            </Link>
          </div>
        </div>

        <div className="grid min-h-0 gap-2 xl:grid-cols-4">
          <Card
            className="flex overflow-hidden border border-[#E5E7EB] bg-white shadow-sm"
            style={{ height: `${BOTTOM_CARD_HEIGHT}px` }}
          >
            <div className="flex h-full w-full flex-col">
              <CardHeader className="shrink-0 pb-1 pt-2.5">
                <CardTitle className="text-sm font-semibold text-[#111827]">Top Threat Sources</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-center pt-0 pb-3">
                <div className="flex flex-col gap-1.5">
                  {topClientIps.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs text-[#6B7280]">
                      No attacker data.
                    </div>
                  ) : (
                    topClientIps.slice(0, 3).map((item, index) => (
                      <Link
                        key={`${item.client_ip}-${index}`}
                        href={`/logs?client_ip=${encodeURIComponent(item.client_ip)}&${logsRangeQuery}`}
                        className="flex items-center justify-between rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1.5 transition-colors hover:bg-slate-50"
                      >
                        <span className="truncate font-mono text-[10px] text-[#111827]">
                          {index + 1}. {item.client_ip}
                        </span>
                        <CountPill value={item.count} />
                      </Link>
                    ))
                  )}
                </div>
              </CardContent>
            </div>
          </Card>

          <Card
            className="flex overflow-hidden border border-[#E5E7EB] bg-white shadow-sm"
            style={{ height: `${BOTTOM_CARD_HEIGHT}px` }}
          >
            <div className="flex h-full w-full flex-col">
              <CardHeader className="shrink-0 pb-1 pt-2.5">
                <CardTitle className="text-sm font-semibold text-[#111827]">Top Target Hosts</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-center pt-0 pb-3">
                <div className="flex flex-col gap-1.5">
                  {topHosts.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs text-[#6B7280]">
                      No target host data.
                    </div>
                  ) : (
                    topHosts.slice(0, 3).map((item: any, index: number) => (
                      <Link
                        key={`${item.host}-${index}`}
                        href={`/logs?host=${encodeURIComponent(item.host || "")}&${logsRangeQuery}`}
                        className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1.5 transition-colors hover:bg-slate-50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[10px] font-medium text-[#111827]">
                            {index + 1}. {item.host || "Unknown Host"}
                          </span>
                          <CountPill value={item.count} />
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </CardContent>
            </div>
          </Card>

          <Card
            className="flex overflow-hidden border border-[#E5E7EB] bg-white shadow-sm"
            style={{ height: `${BOTTOM_CARD_HEIGHT}px` }}
          >
            <div className="flex h-full w-full flex-col">
              <CardHeader className="shrink-0 pb-1 pt-2.5">
                <CardTitle className="text-sm font-semibold text-[#111827]">Top Risk Paths</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-center pt-0 pb-3">
                <div className="flex flex-col gap-1.5">
                  {topPaths.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs text-[#6B7280]">
                      No target path data.
                    </div>
                  ) : (
                    topPaths.slice(0, 3).map((item: any, index: number) => (
                      <Link
                        key={`${item.path}-${index}`}
                        href={`/logs?path=${encodeURIComponent(item.path || "")}&${logsRangeQuery}`}
                        className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1.5 transition-colors hover:bg-slate-50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[10px] font-medium text-[#111827]">
                            {index + 1}. {item.path || "/"}
                          </span>
                          <CountPill value={item.count} />
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </CardContent>
            </div>
          </Card>

          <Link href={`/logs?decision=BLOCK&${logsRangeQuery}`} className="group block">
            <Card
              className="flex overflow-hidden border border-[#E5E7EB] bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
              style={{ height: `${BOTTOM_CARD_HEIGHT}px` }}
            >
              <div className="flex h-full w-full flex-col">
                <CardHeader className="shrink-0 pb-1 pt-2.5">
                  <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold text-[#111827]">
                    <span className="flex items-center gap-2">
                      <ShieldOff className="size-4 text-[#1E3A8A]" />
                      Enforcement Split
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-[#9CA3AF] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#3B82F6]" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col justify-center pt-0 pb-3">
                  {policyVsAiComposition.length === 0 ? (
                    <EmptyChartState message="No enforcement data." height="h-[130px]" />
                  ) : (
                    <ResponsiveContainer width="100%" height={132}>
                      <BarChart data={policyVsAiComposition} margin={{ top: 0, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={GG_COLORS.border} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 9, fill: GG_COLORS.textSecondary }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 9, fill: GG_COLORS.textSecondary }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip contentStyle={chartTooltipStyle} />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={38}>
                          {policyVsAiComposition.map((entry, index) => (
                            <Cell
                              key={`${entry.label}-${index}`}
                              fill={entry.label === "AI Blocks" ? GG_COLORS.ai : GG_COLORS.primary}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </div>
            </Card>
          </Link>
        </div>

        <div className="grid min-h-0 gap-2 xl:grid-cols-4">
          {triageItems.map((item) => (
            <Link key={item.label} href={item.href} className="group block">
              <Card
                className="flex overflow-hidden border border-[#E5E7EB] bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                style={{ height: `${TRIAGE_ROW_HEIGHT}px` }}
              >
                <CardContent className="flex h-full flex-col px-3 pb-3 pt-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <ShieldCheck className="size-3.5 shrink-0 text-[#1E3A8A]" />
                      <div className="truncate text-[10px] font-semibold text-[#111827]">{item.label}</div>
                    </div>
                    <ArrowRight className="size-3.5 shrink-0 text-[#9CA3AF] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#3B82F6]" />
                  </div>

                  <div className="flex flex-1 flex-col justify-center">
                    <div className="text-[20px] font-bold leading-none tracking-tight text-[#111827]">
                      {item.value}
                    </div>
                    <div className="mt-1 text-[10px] text-[#6B7280]">{item.countLabel}</div>
                    <div className="mt-1 line-clamp-1 text-[9px] text-[#9CA3AF]">{item.description}</div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between text-[9px]">
                      <span className="text-[#6B7280]">Coverage</span>
                      <span className="font-medium text-[#111827]">{item.barWidth.toFixed(1)}%</span>
                    </div>

                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={cn("h-full rounded-full transition-all duration-500", item.barClass)}
                        style={{ width: `${Math.max(0, Math.min(item.barWidth, 100))}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
