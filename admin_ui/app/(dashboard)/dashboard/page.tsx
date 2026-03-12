"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusChip } from "@/components/status-chip"
import { cn } from "@/lib/utils"

import {
  Globe,
  ShieldOff,
  Brain,
  FileText,
  ExternalLink,
  Server,
  Database,
  Cpu,
  Activity,
  ArrowRight,
  Radar,
  Target,
  type LucideIcon,
} from "lucide-react"

import {
  AreaChart,
  Area,
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

/*
로컬 확장 타입
- 백엔드가 아직 안 주는 필드는 optional
*/
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

/*
GateGuard color system
*/
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
  fontSize: 12,
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
  if (label === "Top Attacker IP") return "from-amber-500/90 to-orange-400/70"
  if (label === "Top Target Host") return "from-teal-500/90 to-teal-400/70"
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

/*
백엔드 필드가 없을 때 프론트 fallback 계산
*/
function safePercent(numerator: number | null | undefined, denominator: number | null | undefined): number {
  const n = Number(numerator || 0)
  const d = Number(denominator || 0)
  if (d <= 0) return 0
  return (n / d) * 100
}

/*
숫자 count-up
- KPI 숫자에만 사용
*/
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

/*
KPI 숫자 표시
- 숫자일 때만 count-up
- IP / host 문자열은 그대로 표시
*/
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

/*
간단한 skeleton block
*/
function SkeletonBlock({ className }: { className: string }) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200/70", className)} />
}

function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="flex h-[240px] items-center justify-center text-sm text-[#6B7280]">
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
  
  /*
  dashboard summary 로드
  */
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
  
    /*
  AI threat distribution 로드
  */
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

  /*
  system health 로드
  */
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

  /*
  summary fallback
  */
  const summary = data?.summary
  const blockedRequests = Number(summary?.blocked_requests || 0)

  const aiBlockRate =
    summary?.ai_block_rate ??
    safePercent(summary?.ai_enforced_blocks, blockedRequests)

  const policyBlockRate =
    summary?.policy_block_rate ??
    safePercent(summary?.policy_enforced_blocks, blockedRequests)

  /*
  원본 데이터
  */
  const requestsOverTime = data?.requests_over_time ?? []
  const blockVsAllowOverTime = data?.block_vs_allow_over_time ?? []
  const topHosts = data?.top_hosts ?? []
  const topPaths = data?.top_paths ?? []
  const aiScoreDistribution = data?.ai_score_distribution ?? []
  const aiLatencyOverTime = data?.ai_latency_over_time ?? []
  const recentEvents = data?.recent_events ?? []
  const topClientIps: TopClientIp[] = data?.top_client_ips ?? []

  /*
  파생 데이터
  */
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

  const decisionTotal = useMemo(() => {
    return decisionDistribution.reduce((acc, item) => acc + Number(item.count || 0), 0)
  }, [decisionDistribution])

  /*
  KPI
  */
  const kpis = useMemo<KpiItem[]>(() => {
    const topAttacker = topClientIps[0]
    const topHost = topHosts[0]

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
      {
        label: "Top Attacker IP",
        value: topAttacker?.client_ip || "N/A",
        icon: Radar,
        href: topAttacker?.client_ip ? `/logs?client_ip=${encodeURIComponent(topAttacker.client_ip)}` : "/logs",
        accentClass: getKpiAccentClass("Top Attacker IP"),
        subText: topAttacker ? `${formatNumber(topAttacker.count)} events` : "No attacker data",
        animateNumber: false,
      },
      {
        label: "Top Target Host",
        value: topHost?.host || "N/A",
        icon: Target,
        href: topHost?.host ? `/logs?host=${encodeURIComponent(topHost.host)}` : "/logs",
        accentClass: getKpiAccentClass("Top Target Host"),
        subText: topHost ? `${formatNumber(topHost.count)} events` : "No target data",
        animateNumber: false,
      },
    ]
  }, [summary, aiBlockRate, policyBlockRate, topClientIps, topHosts])

  /*
  health 카드
  */
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
    <div className="flex flex-col gap-6">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#111827]">Dashboard</h1>
          <p className="text-sm text-[#6B7280]">
            SOC-style security operations overview
            {loading ? " · Loading..." : ""}
            {error ? ` · ${error}` : ""}
          </p>
        </div>

        {/* time range */}
        <div className="flex items-center gap-2">
          <Button
            variant={lastHours === 24 ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs transition-all duration-200"
            onClick={() => setLastHours(24)}
            disabled={loading}
          >
            24h
          </Button>
          <Button
            variant={lastHours === 48 ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs transition-all duration-200"
            onClick={() => setLastHours(48)}
            disabled={loading}
          >
            48h
          </Button>
          <Button
            variant={lastHours === 72 ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs transition-all duration-200"
            onClick={() => setLastHours(72)}
            disabled={loading}
          >
            72h
          </Button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {loading && !data
          ? Array.from({ length: 6 }).map((_, idx) => (
              <Card key={idx} className="border border-[#E5E7EB] bg-white shadow-sm">
                <CardContent className="flex flex-col gap-3 p-4">
                  <SkeletonBlock className="h-4 w-24" />
                  <SkeletonBlock className="h-8 w-28" />
                  <SkeletonBlock className="h-3 w-32" />
                </CardContent>
              </Card>
            ))
          : kpis.map((kpi) => (
              <Link key={kpi.label} href={kpi.href} className="group block">
                <Card className="relative overflow-hidden border border-[#E5E7EB] bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]">
                  <div className={cn("h-1 w-full bg-gradient-to-r", kpi.accentClass)} />

                  <CardContent className="flex min-w-0 flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="rounded-md bg-slate-50 p-2 transition-colors duration-200 group-hover:bg-slate-100">
                          <kpi.icon className="size-4 text-[#1E3A8A]" />
                        </div>
                        <span className="truncate text-xs font-medium text-[#6B7280]">{kpi.label}</span>
                      </div>

                      <ArrowRight className="size-4 shrink-0 text-[#9CA3AF] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#3B82F6]" />
                    </div>

                    <div className="flex min-w-0 flex-col gap-1">
                      <KpiValue
                        value={kpi.value}
                        rawNumber={kpi.rawNumber}
                        suffix={kpi.suffix}
                        animateNumber={kpi.animateNumber}
                      />
                      <span className="truncate text-[11px] text-[#9CA3AF]" title={kpi.subText}>
                        {kpi.subText}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
      </div>

      {/* system status */}
      <Card className="border border-[#E5E7EB] bg-white shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm font-semibold text-[#111827]">System Status</CardTitle>
            <Badge variant="outline" className="text-xs font-normal">
              {healthLoading ? "Loading..." : healthError ? "Health Check Error" : "Live Status"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {healthItems.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 transition-colors duration-200 hover:bg-[#F1F5F9]"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-white p-2 shadow-sm">
                    <item.icon className="size-4 text-[#6B7280]" />
                  </div>

                  <div className="flex flex-col">
                    <span className="text-xs text-[#6B7280]">{item.label}</span>
                    <span className="text-sm font-medium text-[#111827]">{item.value}</span>
                  </div>
                </div>

                <StatusChip value={item.value} type="health" size="sm" />
              </div>
            ))}
          </div>

          {healthError ? <div className="mt-3 text-xs text-red-600">{healthError}</div> : null}
        </CardContent>
      </Card>

      {/* request trend + decision distribution */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border border-[#E5E7EB] bg-white shadow-sm xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#111827]">Requests Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {requestsOverTime.length === 0 ? (
              <EmptyChartState message="No request trend data." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={requestsOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GG_COLORS.border} />
                  <XAxis dataKey="hour" tick={{ fontSize: 11, fill: GG_COLORS.textSecondary }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: GG_COLORS.textSecondary }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Line type="monotone" dataKey="requests" stroke={GG_COLORS.primary} strokeWidth={2.25} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#111827]">Decision Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {decisionDistribution.length === 0 ? (
              <EmptyChartState message="No decision distribution data." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={decisionDistribution}
                    dataKey="count"
                    nameKey="decision"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                  >
                    {decisionDistribution.map((entry, index) => (
                      <Cell key={`${entry.decision}-${index}`} fill={getDecisionColor(entry.decision)} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <text
                    x="50%"
                    y="48%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={GG_COLORS.text}
                    style={{ fontSize: 14, fontWeight: 600 }}
                  >
                    {decisionTotal.toLocaleString()}
                  </text>
                  <text
                    x="50%"
                    y="58%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={GG_COLORS.textMuted}
                    style={{ fontSize: 11 }}
                  >
                    Events
                  </text>
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* enforcement trend + composition */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border border-[#E5E7EB] bg-white shadow-sm xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#111827]">Block vs Allow Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {blockVsAllowOverTime.length === 0 ? (
              <EmptyChartState message="No block / allow trend data." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={blockVsAllowOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GG_COLORS.border} />
                  <XAxis dataKey="hour" tick={{ fontSize: 11, fill: GG_COLORS.textSecondary }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: GG_COLORS.textSecondary }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Area type="monotone" dataKey="allow" stackId="1" stroke={GG_COLORS.success} fill="#D1FAE5" />
                  <Area type="monotone" dataKey="block" stackId="1" stroke={GG_COLORS.danger} fill="#FEE2E2" />
                  <Area type="monotone" dataKey="review" stackId="1" stroke={GG_COLORS.warning} fill="#FEF3C7" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#111827]">Policy vs AI Blocks</CardTitle>
          </CardHeader>
          <CardContent>
            {policyVsAiComposition.length === 0 ? (
              <EmptyChartState message="No enforcement composition data." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={policyVsAiComposition}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GG_COLORS.border} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: GG_COLORS.textSecondary }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: GG_COLORS.textSecondary }} tickLine={false} axisLine={false} />
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

      {/* attacker / target analysis */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-semibold text-[#111827]">Top Attacker IPs</CardTitle>
              <Link href="/logs">
                <Badge variant="outline" className="cursor-pointer gap-1 text-xs font-normal transition-colors hover:bg-slate-50">
                  Open Logs <ExternalLink className="size-3" />
                </Badge>
              </Link>
            </div>
          </CardHeader>

          <CardContent>
            <div className="flex flex-col gap-2">
              {topClientIps.length === 0 ? (
                <div className="text-sm text-[#6B7280]">No attacker data.</div>
              ) : (
                topClientIps.slice(0, 8).map((item, index) => (
                  <Link
                    key={`${item.client_ip}-${index}`}
                    href={`/logs?client_ip=${encodeURIComponent(item.client_ip)}`}
                    className="flex items-center justify-between rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-xs transition-colors hover:bg-slate-50"
                    title={item.client_ip}
                  >
                    <span className="truncate font-mono text-[#111827]">
                      {index + 1}. {item.client_ip}
                    </span>
                    <span className="font-mono text-[#6B7280]">{item.count}</span>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-semibold text-[#111827]">Top Target Hosts</CardTitle>
              <Link href="/logs">
                <Badge variant="outline" className="cursor-pointer gap-1 text-xs font-normal transition-colors hover:bg-slate-50">
                  Open Logs <ExternalLink className="size-3" />
                </Badge>
              </Link>
            </div>
          </CardHeader>

          <CardContent>
            {topHosts.length === 0 ? (
              <EmptyChartState message="No target host data." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topHosts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={GG_COLORS.border} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: GG_COLORS.textSecondary }} tickLine={false} axisLine={false} />
                  <YAxis
                    dataKey="host"
                    type="category"
                    tick={{ fontSize: 10, fill: GG_COLORS.textSecondary }}
                    tickLine={false}
                    axisLine={false}
                    width={150}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="count" fill={GG_COLORS.primary} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-semibold text-[#111827]">Top Target Paths</CardTitle>
              <Link href="/logs">
                <Badge variant="outline" className="cursor-pointer gap-1 text-xs font-normal transition-colors hover:bg-slate-50">
                  Open Logs <ExternalLink className="size-3" />
                </Badge>
              </Link>
            </div>
          </CardHeader>

          <CardContent>
            {topPaths.length === 0 ? (
              <EmptyChartState message="No target path data." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topPaths} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={GG_COLORS.border} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: GG_COLORS.textSecondary }} tickLine={false} axisLine={false} />
                  <YAxis
                    dataKey="path"
                    type="category"
                    tick={{ fontSize: 10, fill: GG_COLORS.textSecondary }}
                    tickLine={false}
                    axisLine={false}
                    width={150}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="count" fill={GG_COLORS.teal} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI charts */}
      <div className="grid gap-4 lg:grid-cols-3">
	            <Card className="border border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#111827]">AI Threat Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {aiThreatLoading ? (
              <EmptyChartState message="Loading AI threat distribution..." />
            ) : aiThreatError ? (
              <EmptyChartState message={aiThreatError} />
            ) : aiThreatDist.length === 0 ? (
              <EmptyChartState message="No AI threat distribution data." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={aiThreatDist}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={55}
                    outerRadius={85}
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
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <text
                    x="50%"
                    y="48%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={GG_COLORS.text}
                    style={{ fontSize: 14, fontWeight: 600 }}
                  >
                    {aiThreatTotal.toLocaleString()}
                  </text>
                  <text
                    x="50%"
                    y="58%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={GG_COLORS.textMuted}
                    style={{ fontSize: 11 }}
                  >
                    AI Labels
                  </text>
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#111827]">AI Score Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {aiScoreDistribution.length === 0 ? (
              <EmptyChartState message="No AI score distribution data." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={aiScoreDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GG_COLORS.border} />
                  <XAxis dataKey="range" tick={{ fontSize: 10, fill: GG_COLORS.textSecondary }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: GG_COLORS.textSecondary }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="count" fill={GG_COLORS.ai} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#111827]">AI Latency Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {aiLatencyOverTime.length === 0 ? (
              <EmptyChartState message="No AI latency data." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={aiLatencyOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GG_COLORS.border} />
                  <XAxis dataKey="hour" tick={{ fontSize: 11, fill: GG_COLORS.textSecondary }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: GG_COLORS.textSecondary }} tickLine={false} axisLine={false} unit="ms" />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Line type="monotone" dataKey="avg_latency" stroke={GG_COLORS.primary} strokeWidth={2.25} dot={false} name="Avg" />
                  <Line
                    type="monotone"
                    dataKey="max_latency"
                    stroke={GG_COLORS.danger}
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="4 2"
                    name="Max"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* recent events */}
      <Card className="overflow-hidden border border-[#E5E7EB] bg-white shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold text-[#111827]">Recent Security Events</CardTitle>
              <p className="mt-1 text-xs text-[#6B7280]">Latest analyst-relevant traffic and enforcement results</p>
            </div>

            <Link href="/logs">
              <Badge variant="outline" className="cursor-pointer gap-1 text-xs font-normal transition-colors hover:bg-slate-50">
                View all <ExternalLink className="size-3" />
              </Badge>
            </Link>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F8FAFC]">
                <TableHead className="text-xs">Timestamp</TableHead>
                <TableHead className="text-xs">Client IP</TableHead>
                <TableHead className="text-xs">Host</TableHead>
                <TableHead className="text-xs">Path</TableHead>
                <TableHead className="text-xs">Decision</TableHead>
                <TableHead className="text-xs">Stage</TableHead>
                <TableHead className="text-xs">Latency</TableHead>
                <TableHead className="text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {!loading && recentEvents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-[#6B7280]">
                    No recent events found.
                  </TableCell>
                </TableRow>
              ) : null}

              {recentEvents.map((log) => (
                <TableRow key={log.log_id} className={cn("text-xs transition-colors duration-150", getRecentEventRowClass(log))}>
                  <TableCell className="font-mono text-[11px] text-[#6B7280]">{formatTimestamp(log.detect_timestamp)}</TableCell>

                  <TableCell className="font-mono text-[11px]">{log.client_ip || "N/A"}</TableCell>

                  <TableCell className="max-w-[180px] truncate font-medium text-[#111827]">
                    {log.host || "N/A"}
                  </TableCell>

                  <TableCell className="max-w-[150px] truncate text-[#6B7280]">{log.path || "N/A"}</TableCell>

                  <TableCell>
                    <StatusChip value={log.decision || "ERROR"} size="sm" />
                  </TableCell>

                  <TableCell>
                    <StatusChip value={log.decision_stage || "FAIL_STAGE"} type="stage" size="sm" />
                  </TableCell>

                  <TableCell className="font-mono text-[11px]">
                    {log.engine_latency_ms !== null && log.engine_latency_ms !== undefined
                      ? `${log.engine_latency_ms}ms`
                      : "N/A"}
                  </TableCell>

                  <TableCell>
                    <Link href={`/logs/${log.log_id}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-[#1E3A8A] transition-colors hover:bg-slate-100 hover:text-[#2563EB]"
                      >
                        Detail
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
