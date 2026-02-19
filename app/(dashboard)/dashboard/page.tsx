"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusChip } from "@/components/status-chip"
import Link from "next/link"
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
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import {
  dashboardStats,
  requestsOverTime,
  blockVsAllowOverTime,
  topHosts,
  topPaths,
  aiScoreDistribution,
  aiLatencyOverTime,
  mockAccessLogs,
} from "@/lib/mock-data"

const kpis = [
  { label: "Total Requests", value: dashboardStats.totalRequests.toLocaleString(), icon: Globe, color: "#2563EB" },
  { label: "Blocked Requests", value: dashboardStats.blockedRequests.toLocaleString(), icon: ShieldOff, color: "#dc2626" },
  { label: "Block Rate", value: `${dashboardStats.blockRate}%`, icon: Percent, color: "#d97706" },
  { label: "AI-Enforced Blocks", value: dashboardStats.aiEnforcedBlocks.toLocaleString(), icon: Brain, color: "#7c3aed" },
  { label: "Policy-Enforced Blocks", value: dashboardStats.policyEnforcedBlocks.toLocaleString(), icon: FileText, color: "#2563EB" },
  { label: "Open Incidents", value: dashboardStats.openIncidents.toString(), icon: AlertTriangle, color: "#d97706" },
]

export default function DashboardPage() {
  const recentLogs = mockAccessLogs.slice(0, 8)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Security operations overview</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="border shadow-sm">
            <CardContent className="flex flex-col gap-1 p-4">
              <div className="flex items-center gap-2">
                <kpi.icon className="size-4" style={{ color: kpi.color }} />
                <span className="text-xs font-medium text-muted-foreground">{kpi.label}</span>
              </div>
              <span className="text-2xl font-bold text-foreground">{kpi.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row 1 */}
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

      {/* Charts Row 2 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Top Target Hosts</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topHosts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis dataKey="host" type="category" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} width={140} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }} />
                <Bar dataKey="count" fill="#2563EB" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Top Target Paths</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topPaths} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis dataKey="path" type="category" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} width={140} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }} />
                <Bar dataKey="count" fill="#059669" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 3 */}
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
                <Line type="monotone" dataKey="p95_latency" stroke="#dc2626" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="P95" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recent Security Events */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-foreground">Recent Security Events</CardTitle>
            <Link href="/logs">
              <Badge variant="outline" className="cursor-pointer text-xs font-normal gap-1">
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
              {recentLogs.map(log => (
                <TableRow key={log.log_id} className="text-xs">
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {new Date(log.detect_timestamp).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">{log.client_ip}</TableCell>
                  <TableCell className="max-w-[160px] truncate text-foreground font-medium">{log.host}</TableCell>
                  <TableCell className="max-w-[120px] truncate text-muted-foreground">{log.path}</TableCell>
                  <TableCell><StatusChip value={log.decision} /></TableCell>
                  <TableCell><StatusChip value={log.decision_stage} type="stage" /></TableCell>
                  <TableCell className="font-mono text-[11px]">{log.engine_latency_ms}ms</TableCell>
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
