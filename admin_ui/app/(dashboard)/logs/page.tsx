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
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

import { Search, X, MessageSquare, Filter, ShieldAlert, Bot, FileText, AlertTriangle, Syringe } from "lucide-react"

import { apiListLogs, type AccessLogItem, type ListLogsResponse } from "@/lib/api-client"

/*
페이지당 로그 개수
*/
const PAGE_SIZE = 15

/*
필터 상태 타입
*/
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

/*
초기 필터 값
*/
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

const ALLOWED_DECISIONS = new Set(["ALLOW", "BLOCK", "REVIEW", "ERROR"])
const ALLOWED_STAGES = new Set(["POLICY_STAGE", "AI_STAGE", "FAIL_STAGE"])

/*
Quick Filter 정의
*/
type QuickFilterItem = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
}

/*
엔트리
*/
export default function LogsPage() {
  return (
    <Suspense fallback={<LogsPageSkeleton />}>
      <LogsPageInner />
    </Suspense>
  )
}

/*
Suspense fallback
*/
function LogsPageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Logs</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-xl font-semibold text-foreground">Access Logs</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Fetching logs from FastAPI...
        </CardContent>
      </Card>
    </div>
  )
}

/*
입력 디바운스
*/
function useDebounced<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])

  return v
}

/*
datetime-local → API datetime
*/
function toApiDateTime(value: string): string | undefined {
  if (!value) return undefined
  return `${value.replace("T", " ")}:00`
}

/*
문자열 숫자 → number
*/
function toNumberOrUndefined(value: string): number | undefined {
  const s = value.trim()
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function normalizeDecisionParam(value: string | null): string {
  if (!value) return "all"
  const upper = value.toUpperCase()
  return ALLOWED_DECISIONS.has(upper) ? upper : "all"
}

function normalizeStageParam(value: string | null): string {
  if (!value) return "all"
  const upper = value.toUpperCase()
  return ALLOWED_STAGES.has(upper) ? upper : "all"
}

function normalizeHostParam(value: string | null): string {
  return value?.trim() ?? ""
}

/*
행 강조 클래스
- BLOCK / REVIEW / FAIL_STAGE 우선 강조
*/
function getRowClass(it: AccessLogItem): string {
  const decision = String(it.decision || "").toUpperCase()
  const stage = String(it.decision_stage || "").toUpperCase()

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

/*
시간대 quick filter
*/
function getRangePreset(hours: number): { startTime: string; endTime: string } {
  const now = new Date()
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000)

  const toInput = (d: Date) => {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const dd = String(d.getDate()).padStart(2, "0")
    const hh = String(d.getHours()).padStart(2, "0")
    const mi = String(d.getMinutes()).padStart(2, "0")
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
  }

  return {
    startTime: toInput(start),
    endTime: toInput(now),
  }
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

  /*
  URL query → filters 반영
  */
  useEffect(() => {
    const nextDecision = normalizeDecisionParam(searchParams.get("decision"))
    const nextStage = normalizeStageParam(searchParams.get("stage"))
    const nextHost = normalizeHostParam(searchParams.get("host"))

    setFilters((prev) => {
      const next: FiltersState = {
        ...prev,
        decision: nextDecision,
        stage: nextStage,
        host: nextHost,
      }

      const changed =
        prev.decision !== next.decision ||
        prev.stage !== next.stage ||
        prev.host !== next.host

      return changed ? next : prev
    })

    setPage(1)
  }, [searchParams])

  const offset = (page - 1) * PAGE_SIZE

  const hostDebounced = useDebounced(filters.host.trim(), 300)
  const clientIpDebounced = useDebounced(filters.clientIp.trim(), 300)
  const startTimeDebounced = useDebounced(filters.startTime, 200)
  const endTimeDebounced = useDebounced(filters.endTime, 200)
  const minScoreDebounced = useDebounced(filters.minScore.trim(), 300)
  const maxScoreDebounced = useDebounced(filters.maxScore.trim(), 300)
  const injectStatusCodeDebounced = useDebounced(filters.injectStatusCode.trim(), 300)

  /*
  API 파라미터 생성
  */
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

  /*
  로그 조회
  */
  useEffect(() => {
    let cancelled = false

    async function run() {
      setLoading(true)
      setError("")

      try {
        const res = await apiListLogs(apiParams)
        if (!cancelled) {
          setData(res)
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to load logs")
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
  }, [apiParams])

  const items: AccessLogItem[] = data?.items || []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + items.length, total)

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
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }))
    setPage(1)
  }

  /*
  Quick Filter 적용
  */
  function applyQuickFilterBlockOnly() {
    setFilters((prev) => ({
      ...prev,
      decision: "BLOCK",
    }))
    setPage(1)
  }

  function applyQuickFilterAiStage() {
    setFilters((prev) => ({
      ...prev,
      decision: "BLOCK",
      stage: "AI_STAGE",
    }))
    setPage(1)
  }

  function applyQuickFilterPolicyStage() {
    setFilters((prev) => ({
      ...prev,
      decision: "BLOCK",
      stage: "POLICY_STAGE",
    }))
    setPage(1)
  }

  function applyQuickFilterFailStage() {
    setFilters((prev) => ({
      ...prev,
      stage: "FAIL_STAGE",
    }))
    setPage(1)
  }

  function applyQuickFilterLast24h() {
    const range = getRangePreset(24)
    setFilters((prev) => ({
      ...prev,
      startTime: range.startTime,
      endTime: range.endTime,
    }))
    setPage(1)
  }

  function applyQuickFilterInjectionFail() {
    setFilters((prev) => ({
      ...prev,
      injectAttempted: "1",
      injectSend: "0",
    }))
    setPage(1)
  }

  const quickFilters: QuickFilterItem[] = [
    {
      key: "block-only",
      label: "BLOCK Only",
      icon: ShieldAlert,
      onClick: applyQuickFilterBlockOnly,
    },
    {
      key: "ai-stage",
      label: "AI Stage",
      icon: Bot,
      onClick: applyQuickFilterAiStage,
    },
    {
      key: "policy-stage",
      label: "Policy Stage",
      icon: FileText,
      onClick: applyQuickFilterPolicyStage,
    },
    {
      key: "fail-stage",
      label: "Fail Stage",
      icon: AlertTriangle,
      onClick: applyQuickFilterFailStage,
    },
    {
      key: "last-24h",
      label: "Last 24h",
      icon: Filter,
      onClick: applyQuickFilterLast24h,
    },
    {
      key: "inject-fail",
      label: "Injection Fail",
      icon: Syringe,
      onClick: applyQuickFilterInjectionFail,
    },
  ]

  const SortIndicator = ({ field }: { field: string }) =>
    sortField === field ? <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span> : null

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

  /*
  Active Filter Pills
  */
  const activeFilterPills = useMemo(() => {
    const pills: Array<{ key: string; label: string; onRemove: () => void }> = []

    if (filters.decision !== "all") {
      pills.push({
        key: "decision",
        label: `Decision: ${filters.decision}`,
        onRemove: () => updateFilter("decision", "all"),
      })
    }

    if (filters.stage !== "all") {
      pills.push({
        key: "stage",
        label: `Stage: ${filters.stage}`,
        onRemove: () => updateFilter("stage", "all"),
      })
    }

    if (filters.host.trim()) {
      pills.push({
        key: "host",
        label: `Host: ${filters.host.trim()}`,
        onRemove: () => updateFilter("host", ""),
      })
    }

    if (filters.clientIp.trim()) {
      pills.push({
        key: "clientIp",
        label: `Client: ${filters.clientIp.trim()}`,
        onRemove: () => updateFilter("clientIp", ""),
      })
    }

    if (filters.startTime) {
      pills.push({
        key: "startTime",
        label: `Start: ${filters.startTime}`,
        onRemove: () => updateFilter("startTime", ""),
      })
    }

    if (filters.endTime) {
      pills.push({
        key: "endTime",
        label: `End: ${filters.endTime}`,
        onRemove: () => updateFilter("endTime", ""),
      })
    }

    if (filters.minScore.trim()) {
      pills.push({
        key: "minScore",
        label: `Min Score: ${filters.minScore.trim()}`,
        onRemove: () => updateFilter("minScore", ""),
      })
    }

    if (filters.maxScore.trim()) {
      pills.push({
        key: "maxScore",
        label: `Max Score: ${filters.maxScore.trim()}`,
        onRemove: () => updateFilter("maxScore", ""),
      })
    }

    if (filters.injectAttempted !== "all") {
      pills.push({
        key: "injectAttempted",
        label: `Inject Attempted: ${filters.injectAttempted}`,
        onRemove: () => updateFilter("injectAttempted", "all"),
      })
    }

    if (filters.injectSend !== "all") {
      pills.push({
        key: "injectSend",
        label: `Inject Send: ${filters.injectSend}`,
        onRemove: () => updateFilter("injectSend", "all"),
      })
    }

    if (filters.injectStatusCode.trim()) {
      pills.push({
        key: "injectStatusCode",
        label: `Inject Code: ${filters.injectStatusCode.trim()}`,
        onRemove: () => updateFilter("injectStatusCode", ""),
      })
    }

    return pills
  }, [filters])

  return (
    <div className="flex flex-col gap-4">
      {/* breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Logs</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* 페이지 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#111827]">Access Logs</h1>
          <p className="text-sm text-[#6B7280]">
            {loading ? "Loading..." : `${total} log entries`}
            {error ? <span className="ml-2 text-destructive">({error})</span> : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs transition-all duration-200"
            onClick={clearFilters}
            disabled={
              activeFilterCount === 0 &&
              page === 1 &&
              sortField === "detect_timestamp" &&
              sortDir === "desc"
            }
          >
            <X className="mr-1 size-3.5" />
            Reset
          </Button>
        </div>
      </div>

      {/* Slack 유입 안내 */}
      {fromSlack && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
          <MessageSquare className="size-4" />
          <span>You arrived from a Slack notification. Showing relevant log context.</span>
        </div>
      )}

      {/* Quick Filters */}
      <Card className="border border-[#E5E7EB] bg-white shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="mr-1 flex items-center gap-2 text-xs font-medium text-[#6B7280]">
            <Filter className="size-3.5" />
            Quick Filters
          </div>

          {quickFilters.map((item) => (
            <Button
              key={item.key}
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs transition-all duration-200 hover:bg-slate-50"
              onClick={item.onClick}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* 필터 영역 */}
      <Card className="border border-[#E5E7EB] bg-white shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          {/* Decision */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
              Decision
            </label>
            <Select value={filters.decision} onValueChange={(v) => updateFilter("decision", v)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ALLOW">Allow</SelectItem>
                <SelectItem value="BLOCK">Block</SelectItem>
                <SelectItem value="REVIEW">Review</SelectItem>
                <SelectItem value="ERROR">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Stage */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
              Stage
            </label>
            <Select value={filters.stage} onValueChange={(v) => updateFilter("stage", v)}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="POLICY_STAGE">Policy Stage</SelectItem>
                <SelectItem value="AI_STAGE">AI Stage</SelectItem>
                <SelectItem value="FAIL_STAGE">Fail Stage</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Host */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
              Host
            </label>
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

          {/* Client IP */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
              Client IP
            </label>
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

          {/* Start Time */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
              Start Time
            </label>
            <Input
              type="datetime-local"
              value={filters.startTime}
              onChange={(e) => updateFilter("startTime", e.target.value)}
              className="h-8 w-[190px] text-xs"
            />
          </div>

          {/* End Time */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
              End Time
            </label>
            <Input
              type="datetime-local"
              value={filters.endTime}
              onChange={(e) => updateFilter("endTime", e.target.value)}
              className="h-8 w-[190px] text-xs"
            />
          </div>

          {/* Min Score */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
              Min Score
            </label>
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

          {/* Max Score */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
              Max Score
            </label>
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

          {/* Inject Attempted */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
              Inject Attempted
            </label>
            <Select value={filters.injectAttempted} onValueChange={(v) => updateFilter("injectAttempted", v)}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="1">Yes</SelectItem>
                <SelectItem value="0">No</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Inject Send */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
              Inject Send
            </label>
            <Select value={filters.injectSend} onValueChange={(v) => updateFilter("injectSend", v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="1">Success</SelectItem>
                <SelectItem value="0">Fail</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Inject Code */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
              Inject Code
            </label>
            <Input
              type="number"
              placeholder="403"
              value={filters.injectStatusCode}
              onChange={(e) => updateFilter("injectStatusCode", e.target.value)}
              className="h-8 w-[110px] text-xs"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="text-xs text-[#6B7280]">
              {activeFilterCount > 0 ? `${activeFilterCount} filter(s)` : "No filters"}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Filters */}
      {activeFilterPills.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-medium text-[#6B7280]">Active Filters</div>

          {activeFilterPills.map((pill) => (
            <Badge
              key={pill.key}
              variant="outline"
              className="gap-1 rounded-md border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-normal text-[#334155]"
            >
              {pill.label}
              <button
                type="button"
                onClick={pill.onRemove}
                className="inline-flex items-center text-[#6B7280] transition-colors hover:text-[#111827]"
                aria-label={`Remove ${pill.label}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      {/* 로그 테이블 */}
      <Card className="overflow-hidden border border-[#E5E7EB] bg-white shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F8FAFC]">
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
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-[#6B7280]">
                    No logs found.
                  </TableCell>
                </TableRow>
              ) : null}

              {items.map((it) => {
                const client =
                  it.client_ip && it.client_port
                    ? `${it.client_ip}:${it.client_port}`
                    : it.client_ip || "N/A"

                const host = it.host || "N/A"
                const path = it.path || "N/A"

                return (
                  <TableRow
                    key={it.log_id}
                    className={cn("text-xs transition-colors duration-150", getRowClass(it))}
                  >
                    <TableCell className="font-mono text-[11px]">
                      <Link href={`/logs/${it.log_id}`} className="text-primary hover:underline">
                        {it.log_id}
                      </Link>
                    </TableCell>

                    <TableCell className="font-mono text-[11px] text-[#6B7280]">
                      {it.detect_timestamp ? new Date(it.detect_timestamp).toLocaleString() : "N/A"}
                    </TableCell>

                    <TableCell className="font-mono text-[11px]">{client}</TableCell>

                    <TableCell className="max-w-[420px]">
                      <div className="truncate font-mono text-[11px] text-[#111827]">{host}</div>
                      <div className="truncate font-mono text-[11px] text-[#6B7280]">{path}</div>
                    </TableCell>

                    <TableCell>
                      <StatusChip value={String(it.decision || "ERROR")} size="sm" />
                    </TableCell>

                    <TableCell>
                      <StatusChip value={String(it.decision_stage || "FAIL_STAGE")} type="stage" size="sm" />
                    </TableCell>

                    <TableCell className="font-mono text-[11px]">
                      {typeof it.ai_score === "number" ? it.ai_score.toFixed(4) : "—"}
                    </TableCell>

                    <TableCell className="font-mono text-[11px]">
                      {it.inject_attempted === 1
                        ? `${it.inject_send === 1 ? "OK" : "FAIL"} / ${it.inject_status_code ?? "—"}`
                        : "—"}
                    </TableCell>

                    <TableCell className="font-mono text-[11px] text-[#6B7280]">
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
      <div className="flex items-center justify-between border rounded-md bg-white px-4 py-3">
        <div className="text-xs text-[#6B7280]">
          {total === 0
            ? "No results"
            : `Showing ${pageStart}-${pageEnd} of ${total.toLocaleString()}`}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>

          <span className="min-w-[88px] text-center text-xs text-[#6B7280]">
            Page {page} / {totalPages}
          </span>

          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
