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

function normalizeHealthLabel(value: string | null | undefined): string {
  const v = String(value || "").toLowerCase()

  if (v === "active") return "RUNNING"
  if (v === "inactive") return "STOPPED"
  if (v === "failed") return "FAILED"
  if (v === "activating") return "STARTING"
  if (v === "deactivating") return "STOPPING"
  if (v === "loaded") return "RUNNING"
  if (v === "missing") return "MISSING"

  return "UNKNOWN"
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

  if (v === "FAILED" || v === "STOPPED" || v === "MISSING") {
    return "border-red-200 bg-red-50 text-red-700"
  }

  return "border-amber-200 bg-amber-50 text-amber-700"
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
    return <span className="truncate text-2xl font-bold tracking-tight text-[#111827]">{value}</span>
  }

  const display =
    suffix === "%"
      ? `${animated.toFixed(1)}%`
      : Math.round(animated).toLocaleString()

  return <span className="truncate text-2xl font-bold tracking-tight text-[#111827]">{display}</span>
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

export default function DashboardPage() {
  const [lastHours, setLastHours] = useState<number>(24)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>("")
  const [data, setData] = useState<ExtendedDashboardResponse | null>(null)

  const [healthLoading, setHealthLoading] = useState<boolean>(false)
  const [healthError, setHealthError] = useState<string>("")
  const [health, setHealth] = useState<SystemHealthResponse | null>(null)

  const [aiThreatDist, setAiThreatDist] = useState<DashboardAiThreatDistributionItem[]>([])
  const [aiThreatTotal, setAiThreatTotal] = useState<number>(0)
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
          setAiThreatTotal(Number(res.total || 0))
        }
      } catch (e: any) {
        if (!cancelled) {
          setAiThreatError(e?.message || "Failed to load AI threat distribution")
          setAiThreatDist([])
          setAiThreatTotal(0)
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

  const kpis = useMemo<KpiItem[]>(() => {
    return [
      {
        label: "Total Requests",
        value: formatNumber(summary?.total_requests),
        rawNumber: Number(summary?.total_requests || 0),
        icon: Globe,
        href: "/logs",
        accentClass: getKpiAccentClass("Total Requests"),
        subText: "All observed HTTP requests",
        animateNumber: true,
      },
      {
        label: "Blocked Requests",
        value: formatNumber(summary?.blocked_requests),
        rawNumber: Number(summary?.blocked_requests || 0),
        icon: ShieldOff,
        href: "/logs?decision=BLOCK",
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
        href: "/logs?decision=BLOCK&stage=AI_STAGE",
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
        href: "/logs?decision=BLOCK&stage=POLICY_STAGE",
        accentClass: getKpiAccentClass("Policy Block Rate"),
        subText: "Policy-stage share of blocked events",
        animateNumber: true,
      },
    ]
  }, [summary, aiBlockRate, policyBlockRate])

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
    ]
  }, [health])

  return (
    <div className="flex h-[calc(100vh-72px)] flex-col gap-2 overflow-y-auto pr-1">
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

      <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {loading && !data
          ? Array.from({ length: 4 }).map((_, idx) => (
              <Card key={idx} className="border border-[#E5E7EB] bg-white shadow-sm">
                <CardContent className="flex flex-col gap-2 p-2.5">
                  <SkeletonBlock className="h-4 w-24" />
                  <SkeletonBlock className="h-7 w-24" />
                  <SkeletonBlock className="h-3 w-28" />
                </CardContent>
              </Card>
            ))
          : kpis.map((kpi) => (
              <Link key={kpi.label} href={kpi.href} className="group block">
                <Card className="relative overflow-hidden border border-[#E5E7EB] bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                  <div className={cn("h-1 w-full bg-gradient-to-r", kpi.accentClass)} />

                  <CardContent className="flex min-w-0 flex-col gap-1.5 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="rounded-md bg-slate-50 p-1.5 transition-colors duration-200 group-hover:bg-slate-100">
                          <kpi.icon className="size-4 text-[#1E3A8A]" />
                        </div>
                        <span className="truncate text-[11px] font-medium text-[#6B7280]">{kpi.label}</span>
                      </div>

                      <ArrowRight className="size-4 shrink-0 text-[#9CA3AF] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#3B82F6]" />
                    </div>

                    <div className="flex min-w-0 flex-col gap-0.5">
                      <KpiValue
                        value={kpi.value}
                        rawNumber={kpi.rawNumber}
                        suffix={kpi.suffix}
                        animateNumber={kpi.animateNumber}
                      />
                      <span className="truncate text-[10px] text-[#9CA3AF]" title={kpi.subText}>
                        {kpi.subText}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
      </div>

	  <div className="grid min-h-0 flex-1 gap-2">
  <div className="grid min-h-0 gap-2 xl:grid-cols-4">
    <Card className="h-[240px] border border-[#E5E7EB] bg-white shadow-sm">
      <CardHeader className="pb-1 pt-2.5">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
          <BellRing className="size-4 text-[#1E3A8A]" />
          Live Threat Feed
        </CardTitle>
      </CardHeader>

      <CardContent className="flex h-[calc(100%-44px)] flex-col pt-0">
        <div className="grid shrink-0 grid-cols-2 gap-1.5">
          <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1.5">
            <div className="text-[10px] text-[#6B7280]">Window</div>
            <div className="text-sm font-semibold text-[#111827]">{lastHours}h</div>
          </div>
          <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1.5">
            <div className="text-[10px] text-[#6B7280]">Alerts</div>
            <div className="text-sm font-semibold text-[#111827]">{criticalEvents.length}</div>
          </div>
        </div>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1">
            {criticalEvents.length === 0 ? (
              <div className="flex h-full min-h-[120px] items-center justify-center rounded-md border border-dashed border-[#E5E7EB] text-xs text-[#6B7280]">
                No active alerts.
              </div>
            ) : (
              criticalEvents.slice(0, 3).map((item, index) => {
                const decision = String(item.decision || "UNKNOWN").toUpperCase()
                const severity = getSeverityInfo(item)

                return (
                  <Link
                    key={`${item.request_id ?? "evt"}-${index}`}
                    href="/logs"
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
    </Card>

    <Card className="h-[240px] border border-[#E5E7EB] bg-white shadow-sm">
      <CardHeader className="pb-1 pt-2.5">
        <CardTitle className="text-sm font-semibold text-[#111827]">Hourly Detection Pattern</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {requestsOverTime.length === 0 ? (
          <EmptyChartState message="No request trend data." height="h-[160px]" />
        ) : (
          <ResponsiveContainer width="100%" height={170}>
            <LineChart
              data={requestsOverTime}
              margin={{ top: 8, right: 8, left: -18, bottom: 8 }}
            >
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
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>

    <Card className="h-[240px] border border-[#E5E7EB] bg-white shadow-sm">
      <CardHeader className="pb-1 pt-2.5">
        <CardTitle className="text-sm font-semibold text-[#111827]">AI Threat Distribution</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {aiThreatLoading ? (
          <EmptyChartState message="Loading AI threat distribution..." height="h-[160px]" />
        ) : aiThreatError ? (
          <EmptyChartState message={aiThreatError} height="h-[160px]" />
        ) : aiThreatDist.length === 0 ? (
          <EmptyChartState message="No AI threat distribution data." height="h-[160px]" />
        ) : (
          <ResponsiveContainer width="100%" height={170}>
            <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 20 }}>
              <Pie
                data={aiThreatDist}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="42%"
                innerRadius={28}
                outerRadius={44}
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
              <Legend
                verticalAlign="bottom"
                height={28}
                wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>

    <Card className="h-[240px] border border-[#E5E7EB] bg-white shadow-sm">
      <CardHeader className="pb-1 pt-2.5">
        <CardTitle className="text-sm font-semibold text-[#111827]">Decision Distribution</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {decisionDistribution.length === 0 ? (
          <EmptyChartState message="No decision distribution data." height="h-[160px]" />
        ) : (
          <ResponsiveContainer width="100%" height={170}>
            <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 20 }}>
              <Pie
                data={decisionDistribution}
                dataKey="count"
                nameKey="decision"
                cx="50%"
                cy="42%"
                innerRadius={28}
                outerRadius={44}
                paddingAngle={3}
              >
                {decisionDistribution.map((entry, index) => (
                  <Cell key={`${entry.decision}-${index}`} fill={getDecisionColor(entry.decision)} />
                ))}
              </Pie>
              <Tooltip contentStyle={chartTooltipStyle} />
              <Legend
                verticalAlign="bottom"
                height={28}
                wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  </div>

  <div className="grid min-h-0 gap-2 xl:grid-cols-4">
	  
          <Card className="h-[220px] border border-[#E5E7EB] bg-white shadow-sm">
            <CardHeader className="pb-1 pt-2.5">
              <CardTitle className="text-sm font-semibold text-[#111827]">Top Threat Sources</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex h-[150px] flex-col gap-1 overflow-hidden">
                {topClientIps.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-[#6B7280]">
                    No attacker data.
                  </div>
                ) : (
                  topClientIps.slice(0, 4).map((item, index) => (
                    <Link
                      key={`${item.client_ip}-${index}`}
                      href={`/logs?client_ip=${encodeURIComponent(item.client_ip)}`}
                      className="flex items-center justify-between rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1.5 text-[10px] transition-colors hover:bg-slate-50"
                    >
                      <span className="truncate font-mono text-[#111827]">
                        {index + 1}. {item.client_ip}
                      </span>
                      <span className="ml-2 shrink-0 font-mono text-[#6B7280]">{item.count}</span>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="h-[220px] border border-[#E5E7EB] bg-white shadow-sm">
            <CardHeader className="pb-1 pt-2.5">
              <CardTitle className="text-sm font-semibold text-[#111827]">Top Target Hosts</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex h-[150px] flex-col gap-1 overflow-hidden">
                {topHosts.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-[#6B7280]">
                    No target host data.
                  </div>
                ) : (
                  topHosts.slice(0, 4).map((item: any, index: number) => (
                    <Link
                      key={`${item.host}-${index}`}
                      href={`/logs?host=${encodeURIComponent(item.host || "")}`}
                      className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1.5 transition-colors hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[10px] font-medium text-[#111827]">
                          {index + 1}. {item.host || "Unknown Host"}
                        </span>
                        <span className="shrink-0 text-[10px] font-mono text-[#6B7280]">{item.count}</span>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="h-[220px] border border-[#E5E7EB] bg-white shadow-sm">
            <CardHeader className="pb-1 pt-2.5">
              <CardTitle className="text-sm font-semibold text-[#111827]">Top Risk Paths</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex h-[150px] flex-col gap-1 overflow-hidden">
                {topPaths.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-[#6B7280]">
                    No target path data.
                  </div>
                ) : (
                  topPaths.slice(0, 4).map((item: any, index: number) => (
                    <Link
                      key={`${item.path}-${index}`}
                      href={`/logs?path=${encodeURIComponent(item.path || "")}`}
                      className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1.5 transition-colors hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[10px] font-medium text-[#111827]">
                          {index + 1}. {item.path || "/"}
                        </span>
                        <span className="shrink-0 text-[10px] font-mono text-[#6B7280]">{item.count}</span>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="h-[220px] border border-[#E5E7EB] bg-white shadow-sm">
            <CardHeader className="pb-1 pt-2.5">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
                <ShieldOff className="size-4 text-[#1E3A8A]" />
                Enforcement Split
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {policyVsAiComposition.length === 0 ? (
                <EmptyChartState message="No enforcement data." height="h-[150px]" />
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart
                    data={policyVsAiComposition}
                    margin={{ top: 8, right: 8, left: -18, bottom: 8 }}
                  >
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
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
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
          </Card>
        </div>
      </div>
    </div>
  )
}
