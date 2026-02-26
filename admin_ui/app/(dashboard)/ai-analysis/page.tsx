"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusChip } from "@/components/status-chip"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { X } from "lucide-react"
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts"
import { mockAIAnalyses, aiScoreDistribution, aiLatencyOverTime } from "@/lib/mock-data"

const COLORS = ["#dc2626", "#f59e0b", "#10b981", "#6b7280"]
const PAGE_SIZE = 15

export default function AIAnalysisPage() {
  const [filters, setFilters] = useState({ label: "all", model: "all", minScore: "", maxScore: "" })
  const [page, setPage] = useState(1)

  const models = useMemo(() => [...new Set(mockAIAnalyses.map(a => a.model_version))], [])
  const labelDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    mockAIAnalyses.forEach(a => { counts[a.label] = (counts[a.label] || 0) + 1 })
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [])
  const modelUsage = useMemo(() => {
    const counts: Record<string, number> = {}
    mockAIAnalyses.forEach(a => { counts[a.model_version] = (counts[a.model_version] || 0) + 1 })
    return Object.entries(counts).map(([model, count]) => ({ model, count }))
  }, [])

  const filtered = useMemo(() => {
    let data = [...mockAIAnalyses]
    if (filters.label !== "all") data = data.filter(a => a.label === filters.label)
    if (filters.model !== "all") data = data.filter(a => a.model_version === filters.model)
    if (filters.minScore) data = data.filter(a => a.score >= Number(filters.minScore))
    if (filters.maxScore) data = data.filter(a => a.score <= Number(filters.maxScore))
    return data.sort((a, b) => new Date(b.analyzed_at).getTime() - new Date(a.analyzed_at).getTime())
  }, [filters])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>AI Analysis</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-xl font-semibold text-foreground">AI Analysis</h1>
        <p className="text-sm text-muted-foreground">{filtered.length} analysis records</p>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-foreground">Score Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={aiScoreDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="range" tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid #e5e7eb" }} />
                <Bar dataKey="count" fill="#2563EB" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-foreground">Label Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={labelDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} innerRadius={30} paddingAngle={2}>
                  {labelDistribution.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid #e5e7eb" }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-foreground">Latency Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={aiLatencyOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid #e5e7eb" }} />
                <Line type="monotone" dataKey="avg_latency" stroke="#2563EB" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-foreground">Model Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={modelUsage}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="model" tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid #e5e7eb" }} />
                <Bar dataKey="count" fill="#059669" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Label</label>
            <Select value={filters.label} onValueChange={v => { setFilters(f => ({ ...f, label: v })); setPage(1) }}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="MALICIOUS">Malicious</SelectItem>
                <SelectItem value="SUSPICIOUS">Suspicious</SelectItem>
                <SelectItem value="BENIGN">Benign</SelectItem>
                <SelectItem value="UNKNOWN">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Model</label>
            <Select value={filters.model} onValueChange={v => { setFilters(f => ({ ...f, model: v })); setPage(1) }}>
              <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {models.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Min Score</label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={filters.minScore}
              onChange={e => { setFilters(f => ({ ...f, minScore: e.target.value })); setPage(1) }}
              placeholder="0.0"
              className="h-8 w-[80px] text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Max Score</label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={filters.maxScore}
              onChange={e => { setFilters(f => ({ ...f, maxScore: e.target.value })); setPage(1) }}
              placeholder="1.0"
              className="h-8 w-[80px] text-xs"
            />
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => { setFilters({ label: "all", model: "all", minScore: "", maxScore: "" }); setPage(1) }}>
            <X className="mr-1 size-3" /> Clear
          </Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-[11px]">Analyzed At</TableHead>
              <TableHead className="text-[11px]">Log ID</TableHead>
              <TableHead className="text-[11px]">Score</TableHead>
              <TableHead className="text-[11px]">Label</TableHead>
              <TableHead className="text-[11px]">Latency</TableHead>
              <TableHead className="text-[11px]">Model</TableHead>
              <TableHead className="text-[11px]">Error</TableHead>
              <TableHead className="text-[11px]">Seq</TableHead>
              <TableHead className="text-[11px]">Response</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.map((a) => (
              <TableRow key={a.ai_analysis_id} className="text-xs">
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {new Date(a.analyzed_at).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </TableCell>
                <TableCell><Link href={`/logs/${a.log_id}`} className="font-mono text-[11px] text-primary hover:underline">{a.log_id}</Link></TableCell>
                <TableCell>
                  <span className={`font-mono font-semibold text-[11px] ${a.score >= 0.7 ? "text-red-600" : a.score >= 0.5 ? "text-amber-600" : "text-emerald-600"}`}>
                    {a.score.toFixed(3)}
                  </span>
                </TableCell>
                <TableCell><StatusChip value={a.label} type="aiLabel" /></TableCell>
                <TableCell className="font-mono text-[11px]">{a.latency_ms}ms</TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">{a.model_version}</TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">{a.error_code || "\u2014"}</TableCell>
                <TableCell className="text-[11px]">{a.analysis_seq}</TableCell>
                <TableCell className="max-w-[200px] truncate text-[11px] text-muted-foreground">{a.ai_response}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-xs text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}
