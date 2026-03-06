"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusChip } from "@/components/status-chip"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Search, X, MessageSquare } from "lucide-react"

import { apiListLogs, type AccessLogItem, type ListLogsResponse } from "@/lib/api-client"

const PAGE_SIZE = 15

type FiltersState = {
  decision: string
  stage: string
  host: string
  clientIp: string
  startTime: string
  endTime: string
  minScore: string
  maxScore: string
  injectAttempted: string
  injectSend: string
  injectStatusCode: string
}

const INITIAL_FILTERS: FiltersState = {
  decision: "all",
  stage: "all",
  host: "",
  clientIp: "",
  startTime: "",
  endTime: "",
  minScore: "",
  maxScore: "",
  injectAttempted: "all",
  injectSend: "all",
  injectStatusCode: "",
}

export default function LogsPage() {
  return (
    <Suspense fallback={<LogsPageSkeleton />}>
      <LogsPageInner />
    </Suspense>
  )
}

function LogsPageSkeleton() {
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
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-6 text-sm text-muted-foreground">Fetching logs from FastAPI...</CardContent>
      </Card>
    </div>
  )
}

// 디바운스 훅
function useDebounced<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return v
}

// datetime-local -> "YYYY-MM-DD HH:MM:SS"
function toApiDateTime(value: string): string | undefined {
  if (!value) return undefined
  return `${value.replace("T", " ")}:00`
}

// 숫자 문자열 -> number
function toNumberOrUndefined(value: string): number | undefined {
  const s = value.trim()
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function LogsPageInner() {
  const searchParams = useSearchParams()
  const fromSlack = searchParams.get("from") === "slack"

  const [filters, setFilters] = useState<FiltersState>(INITIAL_FILTERS)
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<string>("detect_timestamp")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>("")
  const [data, setData] = useState<ListLogsResponse | null>(null)

  const offset = (page - 1) * PAGE_SIZE

  // 텍스트 입력 디바운스
  const hostDebounced = useDebounced(filters.host.trim(), 300)
  const clientIpDebounced = useDebounced(filters.clientIp.trim(), 300)
  const startTimeDebounced = useDebounced(filters.startTime, 200)
  const endTimeDebounced = useDebounced(filters.endTime, 200)
  const minScoreDebounced = useDebounced(filters.minScore.trim(), 300)
  const maxScoreDebounced = useDebounced(filters.maxScore.trim(), 300)
  const injectStatusCodeDebounced = useDebounced(filters.injectStatusCode.trim(), 300)

  // API 파라미터
  const apiParams = useMemo(() => {
    return {
      limit: PAGE_SIZE,
      offset,
      decision: filters.decision !== "all" ? filters.decision : undefined,
      stage: filters.stage !== "all" ? filters.stage : undefined,
      host: hostDebounced || undefined,
      client_ip: clientIpDebounced || undefined,
      start_time: toApiDateTime(startTimeDebounced),
      end_time: toApiDateTime(endTimeDebounced),
      min_score: toNumberOrUndefined(minScoreDebounced),
      max_score: toNumberOrUndefined(maxScoreDebounced),
      inject_attempted: filters.injectAttempted !== "all" ? Number(filters.injectAttempted) : undefined,
      inject_send: filters.injectSend !== "all" ? Number(filters.injectSend) : undefined,
      inject_status_code: toNumberOrUndefined(injectStatusCodeDebounced),
      sort: sortField || "detect_timestamp",
      dir: sortDir || "desc",
    }
  }, [
    filters.decision,
    filters.stage,
    filters.injectAttempted,
    filters.injectSend,
    hostDebounced,
    clientIpDebounced,
    startTimeDebounced,
    endTimeDebounced,
    minScoreDebounced,
    maxScoreDebounced,
    injectStatusCodeDebounced,
    offset,
    sortField,
    sortDir,
  ])

  useEffect(() => {
    let cancelled = false

    async function run() {
      setLoading(true)
      setError("")
      try {
        const res = await apiListLogs(apiParams)
        if (!cancelled) setData(res)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load logs")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [apiParams])

  const items: AccessLogItem[] = data?.items || []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("desc")
    }
    setPage(1)
  }

  function clearFilters() {
    setFilters(INITIAL_FILTERS)
    setPage(1)
    setSortField("detect_timestamp")
    setSortDir("desc")
  }

  function updateFilter<K extends keyof FiltersState>(key: K, value: FiltersState[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const SortIndicator = ({ field }: { field: string }) =>
    sortField === field ? <span className="ml-1">{sortDir === "asc" ? "\u2191" : "\u2193"}</span> : null

  const activeFilterCount =
    (filters.decision !== "all" ? 1 : 0) +
    (filters.stage !== "all" ? 1 : 0) +
    (filters.host.trim() ? 1 : 0) +
    (filters.clientIp.trim() ? 1 : 0) +
    (filters.startTime ? 1 : 0) +
    (filters.endTime ? 1 : 0) +
    (filters.minScore.trim() ? 1 : 0) +
    (filters.maxScore.trim() ? 1 : 0) +
    (filters.injectAttempted !== "all" ? 1 : 0) +
    (filters.injectSend !== "all" ? 1 : 0) +
    (filters.injectStatusCode.trim() ? 1 : 0)

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Logs</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Access Logs</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading..." : `${total} log entries`}
            {error ? <span className="ml-2 text-destructive">({error})</span> : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={clearFilters}
            disabled={activeFilterCount === 0 && page === 1 && sortField === "detect_timestamp" && sortDir === "desc"}
          >
            <X className="mr-1 size-3.5" /> Reset
          </Button>
        </div>
      </div>

      {fromSlack && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
          <MessageSquare className="size-4" />
          <span>You arrived from a Slack notification. Showing relevant log context.</span>
        </div>
      )}

      {/* 필터 영역 */}
      <Card className="border shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Decision</label>
            <Select value={filters.decision} onValueChange={(v) => updateFilter("decision", v)}>
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
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Stage</label>
            <Select value={filters.stage} onValueChange={(v) => updateFilter("stage", v)}>
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
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Host</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search host..."
                value={filters.host}
                onChange={(e) => updateFilter("host", e.target.value)}
                className="h-8 w-[220px] pl-7 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Client IP</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search client IP..."
                value={filters.clientIp}
                onChange={(e) => updateFilter("clientIp", e.target.value)}
                className="h-8 w-[220px] pl-7 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Start Time</label>
            <Input
              type="datetime-local"
              value={filters.startTime}
              onChange={(e) => updateFilter("startTime", e.target.value)}
              className="h-8 w-[190px] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">End Time</label>
            <Input
              type="datetime-local"
              value={filters.endTime}
              onChange={(e) => updateFilter("endTime", e.target.value)}
              className="h-8 w-[190px] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Min Score</label>
            <Input
              type="number"
              min="0"
              max="1"
              step="0.0001"
              placeholder="0.0000"
              value={filters.minScore}
              onChange={(e) => updateFilter("minScore", e.target.value)}
              className="h-8 w-[120px] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Max Score</label>
            <Input
              type="number"
              min="0"
              max="1"
              step="0.0001"
              placeholder="1.0000"
              value={filters.maxScore}
              onChange={(e) => updateFilter("maxScore", e.target.value)}
              className="h-8 w-[120px] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Inject Attempted</label>
            <Select value={filters.injectAttempted} onValueChange={(v) => updateFilter("injectAttempted", v)}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="1">Yes</SelectItem>
                <SelectItem value="0">No</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Inject Send</label>
            <Select value={filters.injectSend} onValueChange={(v) => updateFilter("injectSend", v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="1">Success</SelectItem>
                <SelectItem value="0">Fail</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Inject Code</label>
            <Input
              type="number"
              placeholder="403"
              value={filters.injectStatusCode}
              onChange={(e) => updateFilter("injectStatusCode", e.target.value)}
              className="h-8 w-[110px] text-xs"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="text-xs text-muted-foreground">
              {activeFilterCount > 0 ? `${activeFilterCount} filter(s)` : "No filters"}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 로그 테이블 */}
      <Card className="overflow-hidden border shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[90px] text-[11px]">
                  <button className="hover:underline" onClick={() => handleSort("log_id")}>
                    ID<SortIndicator field="log_id" />
                  </button>
                </TableHead>
                <TableHead className="text-[11px]">
                  <button className="hover:underline" onClick={() => handleSort("detect_timestamp")}>
                    Timestamp<SortIndicator field="detect_timestamp" />
                  </button>
                </TableHead>
                <TableHead className="text-[11px]">Client</TableHead>
                <TableHead className="text-[11px]">Host / Path</TableHead>
                <TableHead className="w-[120px] text-[11px]">
                  <button className="hover:underline" onClick={() => handleSort("decision")}>
                    Decision<SortIndicator field="decision" />
                  </button>
                </TableHead>
                <TableHead className="w-[140px] text-[11px]">
                  <button className="hover:underline" onClick={() => handleSort("decision_stage")}>
                    Stage<SortIndicator field="decision_stage" />
                  </button>
                </TableHead>
                <TableHead className="w-[90px] text-[11px]">
                  <button className="hover:underline" onClick={() => handleSort("ai_score")}>
                    AI Score<SortIndicator field="ai_score" />
                  </button>
                </TableHead>
                <TableHead className="w-[110px] text-[11px]">
                  <button className="hover:underline" onClick={() => handleSort("inject_status_code")}>
                    Inject<SortIndicator field="inject_status_code" />
                  </button>
                </TableHead>
                <TableHead className="text-[11px]">Reason</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {!loading && items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    No logs found.
                  </TableCell>
                </TableRow>
              ) : null}

              {items.map((it) => {
                const client =
                  it.client_ip && it.client_port ? `${it.client_ip}:${it.client_port}` : it.client_ip || "N/A"
                const host = it.host || "N/A"
                const path = it.path || "N/A"

                return (
                  <TableRow key={it.log_id} className="text-xs">
                    <TableCell className="font-mono text-[11px]">
                      <Link href={`/logs/${it.log_id}`} className="text-primary hover:underline">
                        {it.log_id}
                      </Link>
                    </TableCell>

                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {it.detect_timestamp ? new Date(it.detect_timestamp).toLocaleString() : "N/A"}
                    </TableCell>

                    <TableCell className="font-mono text-[11px]">
                      {client}
                    </TableCell>

                    <TableCell className="max-w-[420px]">
                      <div className="truncate font-mono text-[11px]">{host}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">{path}</div>
                    </TableCell>

                    <TableCell>
                      <StatusChip value={String(it.decision || "ERROR")} />
                    </TableCell>

                    <TableCell>
                      <StatusChip value={String(it.decision_stage || "FAIL_STAGE")} type="stage" />
                    </TableCell>

                    <TableCell className="font-mono text-[11px]">
                      {typeof it.ai_score === "number" ? it.ai_score.toFixed(4) : "—"}
                    </TableCell>

                    <TableCell className="font-mono text-[11px]">
                      {it.inject_attempted === 1
                        ? `${it.inject_send === 1 ? "OK" : "FAIL"} / ${it.inject_status_code ?? "—"}`
                        : "—"}
                    </TableCell>

                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {it.reason || "—"}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 페이지네이션 */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Page {page} / {totalPages} · Showing {items.length} of {total}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
