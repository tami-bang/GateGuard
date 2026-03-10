"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusChip } from "@/components/status-chip"
import {
  Globe,
  ShieldOff,
  Percent,
  Brain,
  FileText,
  AlertTriangle,
  ExternalLink,
} from "lucide-react"
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

type DashboardSummary = {
  total_requests: number
  blocked_requests: number
  block_rate: number
  ai_enforced_blocks: number
  policy_enforced_blocks: number
  open_incidents: number
}

type HourRequests = {
  hour: string
  requests: number
}

type HourDecisionSeries = {
  hour: string
  allow: number
  block: number
  review: number
}

type CountByHost = {
  host: string
  count: number
}

type CountByPath = {
  path: string
  count: number
}

type ScoreBucket = {
  range: string
  count: number
}

type LatencySeries = {
  hour: string
  avg_latency: number
  max_latency: number
}

type RecentEvent = {
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
  decision: string
  reason: string | null
  decision_stage: string
  policy_id: number | null
  user_agent: string | null
  engine_latency_ms: number | null
  inject_attempted: number | null
  inject_send: number | null
  inject_errno: number | null
  inject_latency_ms: number | null
  inject_status_code: number | null
  ai_score: number | null
  ai_label: string | null
  ai_model_version: string | null
  ai_latency_ms: number | null
  ai_error_code: string | null
}

type DashboardResponse = {
  summary: DashboardSummary
  requests_over_time: HourRequests[]
  block_vs_allow_over_time: HourDecisionSeries[]
  top_hosts: CountByHost[]
  top_paths: CountByPath[]
  ai_score_distribution: ScoreBucket[]
  ai_latency_over_time: LatencySeries[]
  recent_events: RecentEvent[]
  last_hours: number
}

type KpiItem = {
  label: string
  value: string
  icon: typeof Globe
  color: string
  href: string
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

async function fetchDashboardSummary(lastHours: number): Promise<DashboardResponse> {
  const url = `${getBaseUrl()}/v1/dashboard/summary?last_hours=${lastHours}`

  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`${res.status} ${res.statusText} ${text}`)
  }

  return (await res.json()) as DashboardResponse
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

export default function DashboardPage() {
  const [lastHours, setLastHours] = useState<number>(24)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>("")
  const [data, setData] = useState<DashboardResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    async function run() {
      setLoading(true)
      setError("")
      try {
        const res = await fetchDashboardSummary(lastHours)
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

  const kpis = useMemo<KpiItem[]>(() => {
    const summary = data?.summary
    return [
      {
        label: "Total Requests",
        value: formatNumber(summary?.total_requests),
        icon: Globe,
        color: "#2563EB",
        href: "/logs",
      },
      {
        label: "Blocked Requests",
        value: formatNumber(summary?.blocked_requests),
        icon: ShieldOff,
        color: "#dc2626",
        href: "/logs?decision=BLOCK",
      },
      {
        label: "Block Rate",
        value: formatPercent(summary?.block_rate),
        icon: Percent,
        color: "#d97706",
        href: "/logs?decision=BLOCK",
      },
      {
        label: "AI-Enforced Blocks",
        value: formatNumber(summary?.ai_enforced_blocks),
        icon: Brain,
        color: "#7c3aed",
        href: "/logs?decision=BLOCK&stage=AI_STAGE",
      },
      {
        label: "Policy-Enforced Blocks",
        value: formatNumber(summary?.policy_enforced_blocks),
        icon: FileText,
        color: "#2563EB",
        href: "/logs?decision=BLOCK&stage=POLICY_STAGE",
      },
      {
        label: "Open Incidents",
        value: formatNumber(summary?.open_incidents),
        icon: AlertTriangle,
        color: "#d97706",
        href: "/incidents",
      },
    ]
  }, [data])

  const requestsOverTime = data?.requests_over_time ?? []
  const blockVsAllowOverTime = data?.block_vs_allow_over_time ?? []
  const topHosts = data?.top_hosts ?? []
  const topPaths = data?.top_paths ?? []
  const aiScoreDistribution = data?.ai_score_distribution ?? []
  const aiLatencyOverTime = data?.ai_latency_over_time ?? []
  const recentEvents = data?.recent_events ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Security operations overview
            {loading ? " · Loading..." : ""}
            {error ? ` · ${error}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={lastHours === 24 ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setLastHours(24)}
            disabled={loading}
          >
            24h
          </Button>
          <Button
            variant={lastHours === 48 ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setLastHours(48)}
            disabled={loading}
          >
            48h
          </Button>
          <Button
            variant={lastHours === 72 ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setLastHours(72)}
            disabled={loading}
          >
            72h
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <Link key={kpi.label} href={kpi.href}>
            <Card className="cursor-pointer border shadow-sm transition-colors hover:bg-muted/40">
              <CardContent className="flex flex-col gap-1 p-4">
                <div className="flex items-center gap-2">
                  <kpi.icon className="size-4" style={{ color: kpi.color }} />
                  <span className="text-xs font-medium text-muted-foreground">{kpi.label}</span>
                </div>
                <span className="text-2xl font-bold text-foreground">{kpi.value}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Requests Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={requestsOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }} />
                <Line type="monotone" dataKey="requests" stroke="#2563EB" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Block vs Allow Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={blockVsAllowOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }} />
                <Area type="monotone" dataKey="allow" stackId="1" stroke="#10b981" fill="#d1fae5" />
                <Area type="monotone" dataKey="block" stackId="1" stroke="#dc2626" fill="#fee2e2" />
                <Area type="monotone" dataKey="review" stackId="1" stroke="#d97706" fill="#fef3c7" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-semibold text-foreground">Top Target Hosts</CardTitle>
              <Link href="/logs">
                <Badge variant="outline" className="cursor-pointer gap-1 text-xs font-normal">
                  Open Logs <ExternalLink className="size-3" />
                </Badge>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topHosts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis
                  dataKey="host"
                  type="category"
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  tickLine={false}
                  axisLine={false}
                  width={140}
                />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }} />
                <Bar dataKey="count" fill="#2563EB" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>

            <div className="mt-3 flex flex-col gap-1">
              {topHosts.slice(0, 5).map((item) => (
                <Link
                  key={item.host}
                  href={`/logs?host=${encodeURIComponent(item.host)}`}
                  className="text-xs text-primary hover:underline"
                >
                  {item.host} ({item.count})
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-semibold text-foreground">Top Target Paths</CardTitle>
              <Link href="/logs">
                <Badge variant="outline" className="cursor-pointer gap-1 text-xs font-normal">
                  Open Logs <ExternalLink className="size-3" />
                </Badge>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topPaths} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis
                  dataKey="path"
                  type="category"
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  tickLine={false}
                  axisLine={false}
                  width={140}
                />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }} />
                <Bar dataKey="count" fill="#059669" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>

            <div className="mt-3 flex flex-col gap-1">
              {topPaths.slice(0, 5).map((item) => (
                <div
                  key={`${item.path}-${item.count}`}
                  className="truncate text-xs text-muted-foreground"
                  title={item.path}
                >
                  {item.path} ({item.count})
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">AI Score Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={aiScoreDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="range" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }} />
                <Bar dataKey="count" fill="#7c3aed" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">AI Latency Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={aiLatencyOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} unit="ms" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }} />
                <Line type="monotone" dataKey="avg_latency" stroke="#2563EB" strokeWidth={2} dot={false} name="Avg" />
                <Line
                  type="monotone"
                  dataKey="max_latency"
                  stroke="#dc2626"
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="4 2"
                  name="Max"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-foreground">Recent Security Events</CardTitle>
            <Link href="/logs">
              <Badge variant="outline" className="cursor-pointer gap-1 text-xs font-normal">
                View all <ExternalLink className="size-3" />
              </Badge>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
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
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                    No recent events found.
                  </TableCell>
                </TableRow>
              ) : null}

              {recentEvents.map((log) => (
                <TableRow key={log.log_id} className="text-xs">
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {formatTimestamp(log.detect_timestamp)}
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">{log.client_ip || "N/A"}</TableCell>
                  <TableCell className="max-w-[160px] truncate font-medium text-foreground">
                    {log.host || "N/A"}
                  </TableCell>
                  <TableCell className="max-w-[120px] truncate text-muted-foreground">
                    {log.path || "N/A"}
                  </TableCell>
                  <TableCell>
                    <StatusChip value={log.decision || "ERROR"} />
                  </TableCell>
                  <TableCell>
                    <StatusChip value={log.decision_stage || "FAIL_STAGE"} type="stage" />
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {log.engine_latency_ms !== null && log.engine_latency_ms !== undefined
                      ? `${log.engine_latency_ms}ms`
                      : "N/A"}
                  </TableCell>
                  <TableCell>
                    <Link href={`/logs/${log.log_id}`}>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-primary">
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
