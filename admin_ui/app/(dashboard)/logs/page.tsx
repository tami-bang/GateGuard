"use client"

import { useState, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusChip } from "@/components/status-chip"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Search, X, MessageSquare } from "lucide-react"
import { mockAccessLogs, mockAIAnalyses } from "@/lib/mock-data"

const PAGE_SIZE = 15

export default function LogsPage() {
  const searchParams = useSearchParams()
  const fromSlack = searchParams.get("from") === "slack"

  const [filters, setFilters] = useState({
    decision: "all",
    stage: "all",
    host: "",
    clientIp: "",
  })
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<string>("detect_timestamp")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const aiScoreMap = useMemo(() => {
    const map = new Map<string, { score: number; model_version: string }>()
    mockAIAnalyses.forEach(a => {
      // keep the latest (highest seq) analysis per log
      const existing = map.get(a.log_id)
      if (!existing || a.analysis_seq > (existing as { score: number; model_version: string; seq?: number }).score) {
        map.set(a.log_id, { score: a.score, model_version: a.model_version })
      }
    })
    return map
  }, [])

  const filteredLogs = useMemo(() => {
    let logs = [...mockAccessLogs]
    if (filters.decision !== "all") logs = logs.filter(l => l.decision === filters.decision)
    if (filters.stage !== "all") logs = logs.filter(l => l.decision_stage === filters.stage)
    if (filters.host) logs = logs.filter(l => l.host.toLowerCase().includes(filters.host.toLowerCase()))
    if (filters.clientIp) logs = logs.filter(l => l.client_ip.includes(filters.clientIp))

    logs.sort((a, b) => {
      const aVal = a[sortField as keyof typeof a]
      const bVal = b[sortField as keyof typeof b]
      if (typeof aVal === "string" && typeof bVal === "string") return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      if (typeof aVal === "number" && typeof bVal === "number") return sortDir === "asc" ? aVal - bVal : bVal - aVal
      return 0
    })
    return logs
  }, [filters, sortField, sortDir])

  const totalPages = Math.ceil(filteredLogs.length / PAGE_SIZE)
  const paginatedLogs = filteredLogs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("desc")
    }
  }

  function clearFilters() {
    setFilters({ decision: "all", stage: "all", host: "", clientIp: "" })
    setPage(1)
  }

  const SortIndicator = ({ field }: { field: string }) =>
    sortField === field ? <span className="ml-1">{sortDir === "asc" ? "\u2191" : "\u2193"}</span> : null

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Logs</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-xl font-semibold text-foreground">Access Logs</h1>
        <p className="text-sm text-muted-foreground">{filteredLogs.length} log entries</p>
      </div>

      {fromSlack && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
          <MessageSquare className="size-4" />
          <span>You arrived from a Slack notification. Showing relevant log context.</span>
        </div>
      )}

      {/* Filters */}
      <Card className="border shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Decision</label>
            <Select value={filters.decision} onValueChange={v => { setFilters(f => ({ ...f, decision: v })); setPage(1) }}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ALLOW">Allow</SelectItem>
                <SelectItem value="BLOCK">Block</SelectItem>
                <SelectItem value="REVIEW">Review</SelectItem>
                <SelectItem value="ERROR">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Stage</label>
            <Select value={filters.stage} onValueChange={v => { setFilters(f => ({ ...f, stage: v })); setPage(1) }}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="POLICY_STAGE">Policy Stage</SelectItem>
                <SelectItem value="AI_STAGE">AI Stage</SelectItem>
                <SelectItem value="FAIL_STAGE">Fail Stage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Host</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search host..."
                value={filters.host}
                onChange={e => { setFilters(f => ({ ...f, host: e.target.value })); setPage(1) }}
                className="h-8 w-[180px] pl-7 text-xs"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Client IP</label>
            <Input
              placeholder="Filter IP..."
              value={filters.clientIp}
              onChange={e => { setFilters(f => ({ ...f, clientIp: e.target.value })); setPage(1) }}
              className="h-8 w-[140px] text-xs"
            />
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={clearFilters}>
            <X className="mr-1 size-3" /> Clear
          </Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-[11px] cursor-pointer select-none" onClick={() => handleSort("detect_timestamp")}>Timestamp<SortIndicator field="detect_timestamp" /></TableHead>
              <TableHead className="text-[11px] cursor-pointer select-none" onClick={() => handleSort("client_ip")}>Client IP<SortIndicator field="client_ip" /></TableHead>
              <TableHead className="text-[11px] cursor-pointer select-none" onClick={() => handleSort("host")}>Host<SortIndicator field="host" /></TableHead>
              <TableHead className="text-[11px]">Path</TableHead>
              <TableHead className="text-[11px]">Decision</TableHead>
              <TableHead className="text-[11px]">Stage</TableHead>
              <TableHead className="text-[11px]">Policy</TableHead>
              <TableHead className="text-[11px]">AI Score</TableHead>
              <TableHead className="text-[11px]">Model</TableHead>
              <TableHead className="text-[11px] cursor-pointer select-none" onClick={() => handleSort("engine_latency_ms")}>Latency<SortIndicator field="engine_latency_ms" /></TableHead>
              <TableHead className="text-[11px]">Inject</TableHead>
              <TableHead className="text-[11px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedLogs.map(log => {
              const ai = aiScoreMap.get(log.log_id)
              return (
                <TableRow key={log.log_id} className="text-xs">
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {new Date(log.detect_timestamp).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">{log.client_ip}</TableCell>
                  <TableCell className="max-w-[140px] truncate font-medium text-foreground">{log.host}</TableCell>
                  <TableCell className="max-w-[100px] truncate text-muted-foreground">{log.path}</TableCell>
                  <TableCell><StatusChip value={log.decision} /></TableCell>
                  <TableCell><StatusChip value={log.decision_stage} type="stage" /></TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{log.policy_id || "\u2014"}</TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {ai ? (
                      <span className={ai.score >= 0.7 ? "text-red-600 font-semibold" : ai.score >= 0.5 ? "text-amber-600" : "text-muted-foreground"}>
                        {ai.score.toFixed(2)}
                      </span>
                    ) : "\u2014"}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{ai?.model_version || "\u2014"}</TableCell>
                  <TableCell className="font-mono text-[11px]">{log.engine_latency_ms}ms</TableCell>
                  <TableCell className="font-mono text-[11px]">{log.inject_status_code || "\u2014"}</TableCell>
                  <TableCell>
                    <Link href={`/logs/${log.log_id}`}>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-primary">
                        Open
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-xs text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredLogs.length)} of {filteredLogs.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              Previous
            </Button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
              <Button
                key={p}
                variant={p === page ? "default" : "outline"}
                size="sm"
                className="h-7 w-7 text-xs p-0"
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            ))}
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
