"use client"

// React 기본 훅들
// Suspense : Next.js 서버 컴포넌트 비동기 처리
// useEffect : 사이드 이펙트 처리
// useMemo : 계산 결과 캐싱
// useState : 상태 관리
import { Suspense, useEffect, useMemo, useState } from "react"

// URL query 파라미터 읽기
import { useSearchParams } from "next/navigation"

// Next.js 내부 라우팅
import Link from "next/link"

// UI 컴포넌트
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// 상태 표시 컴포넌트
// BLOCK / ALLOW / REVIEW 등 표시
import { StatusChip } from "@/components/status-chip"

// Breadcrumb UI
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

// 아이콘
import { Search, X, MessageSquare } from "lucide-react"

// FastAPI 통신 API
import { apiListLogs, type AccessLogItem, type ListLogsResponse } from "@/lib/api-client"

// 페이지당 로그 개수
const PAGE_SIZE = 15

// 필터 상태 타입 정의
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

// 초기 필터 값
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

// URL에서 허용할 decision 값
const ALLOWED_DECISIONS = new Set(["ALLOW", "BLOCK", "REVIEW", "ERROR"])

// URL에서 허용할 stage 값
const ALLOWED_STAGES = new Set(["POLICY_STAGE", "AI_STAGE", "FAIL_STAGE"])

// Logs 페이지 엔트리
export default function LogsPage() {
  return (
    <Suspense fallback={<LogsPageSkeleton />}>
      <LogsPageInner />
    </Suspense>
  )
}

// Suspense fallback UI
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

// 디바운스 훅
// 입력값 변경 후 일정 시간 지나야 값 반영
function useDebounced<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])

  return v
}

// datetime-local → API datetime 변환
function toApiDateTime(value: string): string | undefined {
  if (!value) return undefined
  return `${value.replace("T", " ")}:00`
}

// 문자열 숫자 → number 변환
function toNumberOrUndefined(value: string): number | undefined {
  const s = value.trim()
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

// decision 파라미터 검증
function normalizeDecisionParam(value: string | null): string {
  if (!value) return "all"
  const upper = value.toUpperCase()
  return ALLOWED_DECISIONS.has(upper) ? upper : "all"
}

// stage 파라미터 검증
function normalizeStageParam(value: string | null): string {
  if (!value) return "all"
  const upper = value.toUpperCase()
  return ALLOWED_STAGES.has(upper) ? upper : "all"
}

// host 파라미터 정리
function normalizeHostParam(value: string | null): string {
  return value?.trim() ?? ""
}

// 실제 로그 페이지 내부 컴포넌트
function LogsPageInner() {

  // URL query 파라미터 읽기
  // 예
  // /logs?decision=BLOCK
  // /logs?decision=BLOCK&stage=AI_STAGE
  const searchParams = useSearchParams()

  // Slack 알림 링크에서 들어왔는지 확인
  const fromSlack = searchParams.get("from") === "slack"


  // 필터 상태
  const [filters, setFilters] = useState<FiltersState>(INITIAL_FILTERS)

  // 페이지 번호
  const [page, setPage] = useState(1)

  // 정렬 필드
  const [sortField, setSortField] = useState<string>("detect_timestamp")

  // 정렬 방향
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  // 로딩 상태
  const [loading, setLoading] = useState(false)

  // 에러 메시지
  const [error, setError] = useState<string>("")

  // API 응답 데이터
  const [data, setData] = useState<ListLogsResponse | null>(null)


  // URL query → filters 반영
  // Dashboard KPI 클릭 시
  // /logs?decision=BLOCK
  // /logs?stage=AI_STAGE
  // /logs?host=evil.test
  useEffect(() => {

    // decision 파라미터 검증
    const nextDecision = normalizeDecisionParam(searchParams.get("decision"))

    // stage 파라미터 검증
    const nextStage = normalizeStageParam(searchParams.get("stage"))

    // host 파라미터 정리
    const nextHost = normalizeHostParam(searchParams.get("host"))

    // 기존 필터와 비교
    setFilters(prev => {

      const next: FiltersState = {
        ...prev,
        decision: nextDecision,
        stage: nextStage,
        host: nextHost
      }

      // 실제 값이 변경됐는지 확인
      const changed =
        prev.decision !== next.decision ||
        prev.stage !== next.stage ||
        prev.host !== next.host

      return changed ? next : prev
    })

    // 필터 변경 시 페이지 초기화
    setPage(1)

  }, [searchParams])


  // 페이지 offset 계산
  const offset = (page - 1) * PAGE_SIZE


  // 입력값 디바운스 처리
  const hostDebounced = useDebounced(filters.host.trim(), 300)
  const clientIpDebounced = useDebounced(filters.clientIp.trim(), 300)

  const startTimeDebounced = useDebounced(filters.startTime, 200)
  const endTimeDebounced = useDebounced(filters.endTime, 200)

  const minScoreDebounced = useDebounced(filters.minScore.trim(), 300)
  const maxScoreDebounced = useDebounced(filters.maxScore.trim(), 300)

  const injectStatusCodeDebounced = useDebounced(filters.injectStatusCode.trim(), 300)


  // FastAPI 요청 파라미터 생성
  const apiParams = useMemo(() => {

    return {

      // 페이지네이션
      limit: PAGE_SIZE,
      offset,

      // decision 필터
      decision: filters.decision !== "all"
        ? filters.decision
        : undefined,

      // stage 필터
      stage: filters.stage !== "all"
        ? filters.stage
        : undefined,

      // host 검색
      host: hostDebounced || undefined,

      // client ip 검색
      client_ip: clientIpDebounced || undefined,

      // 시간 필터
      start_time: toApiDateTime(startTimeDebounced),
      end_time: toApiDateTime(endTimeDebounced),

      // AI score 필터
      min_score: toNumberOrUndefined(minScoreDebounced),
      max_score: toNumberOrUndefined(maxScoreDebounced),

      // inject_attempted 필터
      inject_attempted:
        filters.injectAttempted !== "all"
          ? Number(filters.injectAttempted)
          : undefined,

      // inject_send 필터
      inject_send:
        filters.injectSend !== "all"
          ? Number(filters.injectSend)
          : undefined,

      // inject status code
      inject_status_code:
        toNumberOrUndefined(injectStatusCodeDebounced),

      // 정렬 필드
      sort: sortField || "detect_timestamp",

      // 정렬 방향
      dir: sortDir || "desc"

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
    sortDir
  ])


  // FastAPI 로그 조회
  useEffect(() => {

    let cancelled = false

    async function run() {

      // 로딩 시작
      setLoading(true)

      // 에러 초기화
      setError("")

      try {

        // FastAPI 호출
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


  // 로그 데이터
  const items: AccessLogItem[] = data?.items || []

  // 전체 로그 수
  const total = data?.total ?? 0

  // 전체 페이지 수
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

    // 정렬 처리
  function handleSort(field: string) {

    // 같은 필드 다시 클릭하면 asc / desc 전환
    if (sortField === field) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"))
    } else {
      // 다른 필드 클릭하면 해당 필드로 변경 후 기본 desc
      setSortField(field)
      setSortDir("desc")
    }

    // 정렬 변경 시 첫 페이지로 이동
    setPage(1)
  }


  // 필터 전체 초기화
  function clearFilters() {

    setFilters(INITIAL_FILTERS)

    setPage(1)
    setSortField("detect_timestamp")
    setSortDir("desc")
  }


  // 개별 필터 업데이트
  function updateFilter<K extends keyof FiltersState>(key: K, value: FiltersState[K]) {

    setFilters(prev => ({
      ...prev,
      [key]: value
    }))

    // 필터 변경 시 첫 페이지로 이동
    setPage(1)
  }


  // 정렬 표시 화살표
  const SortIndicator = ({ field }: { field: string }) =>
    sortField === field
      ? <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
      : null


  // 현재 활성화된 필터 개수 계산
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


  // 화면 렌더링
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
          <h1 className="text-xl font-semibold text-foreground">
            Access Logs
          </h1>

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

      {/* Slack 알림에서 유입된 경우 안내 */}
      {fromSlack && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
          <MessageSquare className="size-4" />
          <span>You arrived from a Slack notification. Showing relevant log context.</span>
        </div>
      )}

      {/* 필터 영역 */}
      <Card className="border shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-3">

          {/* Decision 필터 */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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

          {/* Stage 필터 */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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

          {/* Host 검색 */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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

          {/* Client IP 검색 */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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

          {/* 활성 필터 개수 표시 */}
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

                {/* Log ID 정렬 */}
                <TableHead className="w-[90px] text-[11px]">
                  <button className="hover:underline" onClick={() => handleSort("log_id")}>
                    ID<SortIndicator field="log_id" />
                  </button>
                </TableHead>

                {/* Timestamp 정렬 */}
                <TableHead className="text-[11px]">
                  <button className="hover:underline" onClick={() => handleSort("detect_timestamp")}>
                    Timestamp<SortIndicator field="detect_timestamp" />
                  </button>
                </TableHead>

                <TableHead className="text-[11px]">Client</TableHead>
                <TableHead className="text-[11px]">Host / Path</TableHead>

                {/* Decision 정렬 */}
                <TableHead className="w-[120px] text-[11px]">
                  <button className="hover:underline" onClick={() => handleSort("decision")}>
                    Decision<SortIndicator field="decision" />
                  </button>
                </TableHead>

                {/* Stage 정렬 */}
                <TableHead className="w-[140px] text-[11px]">
                  <button className="hover:underline" onClick={() => handleSort("decision_stage")}>
                    Stage<SortIndicator field="decision_stage" />
                  </button>
                </TableHead>

                {/* AI Score 정렬 */}
                <TableHead className="w-[90px] text-[11px]">
                  <button className="hover:underline" onClick={() => handleSort("ai_score")}>
                    AI Score<SortIndicator field="ai_score" />
                  </button>
                </TableHead>

                {/* Inject 정렬 */}
                <TableHead className="w-[110px] text-[11px]">
                  <button className="hover:underline" onClick={() => handleSort("inject_status_code")}>
                    Inject<SortIndicator field="inject_status_code" />
                  </button>
                </TableHead>

                <TableHead className="text-[11px]">Reason</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>

              {/* 결과 없음 */}
              {!loading && items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    No logs found.
                  </TableCell>
                </TableRow>
              ) : null}

              {/* 로그 행 렌더링 */}
              {items.map((it) => {

                const client =
                  it.client_ip && it.client_port
                    ? `${it.client_ip}:${it.client_port}`
                    : it.client_ip || "N/A"

                const host = it.host || "N/A"
                const path = it.path || "N/A"

                return (
                  <TableRow key={it.log_id} className="text-xs">

                    {/* log id */}
                    <TableCell className="font-mono text-[11px]">
                      <Link href={`/logs/${it.log_id}`} className="text-primary hover:underline">
                        {it.log_id}
                      </Link>
                    </TableCell>

                    {/* timestamp */}
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {it.detect_timestamp
                        ? new Date(it.detect_timestamp).toLocaleString()
                        : "N/A"}
                    </TableCell>

                    {/* client */}
                    <TableCell className="font-mono text-[11px]">
                      {client}
                    </TableCell>

                    {/* host/path */}
                    <TableCell className="max-w-[420px]">
                      <div className="truncate font-mono text-[11px]">{host}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">{path}</div>
                    </TableCell>

                    {/* decision */}
                    <TableCell>
                      <StatusChip value={String(it.decision || "ERROR")} />
                    </TableCell>

                    {/* stage */}
                    <TableCell>
                      <StatusChip value={String(it.decision_stage || "FAIL_STAGE")} type="stage" />
                    </TableCell>

                    {/* AI score */}
                    <TableCell className="font-mono text-[11px]">
                      {typeof it.ai_score === "number"
                        ? it.ai_score.toFixed(4)
                        : "—"}
                    </TableCell>

                    {/* inject 상태 */}
                    <TableCell className="font-mono text-[11px]">
                      {it.inject_attempted === 1
                        ? `${it.inject_send === 1 ? "OK" : "FAIL"} / ${it.inject_status_code ?? "—"}`
                        : "—"}
                    </TableCell>

                    {/* reason */}
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

          {/* 이전 페이지 */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            Prev
          </Button>

          {/* 다음 페이지 */}
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


