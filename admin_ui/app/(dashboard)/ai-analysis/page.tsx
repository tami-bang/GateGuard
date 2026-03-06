"use client"

/*
AI Analysis Page

역할
- /v1/logs API 기반 AI 분석 결과 조회
- ai_score 존재하는 로그만 AI 분석 데이터로 사용
- 기존 UI (필터 / 차트 / 테이블 / 페이지네이션) 유지
*/

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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

import { X } from "lucide-react"

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"

import { apiListLogs, AccessLogItem } from "@/lib/api-client"

const COLORS = ["#dc2626", "#f59e0b", "#10b981", "#6b7280"]
const PAGE_SIZE = 15

export default function AIAnalysisPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <AIAnalysisPageInner />
    </Suspense>
  )
}

function AIAnalysisPageInner() {

  /* 로그 데이터 */
  const [logs, setLogs] = useState<AccessLogItem[]>([])

  /* 상태 관리 */
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  /* 필터 상태 */
  const [filters, setFilters] = useState({
    label: "all",
    model: "all",
    minScore: "",
    maxScore: "",
  })

  /* 페이지 */
  const [page, setPage] = useState(1)


  /*
  로그 API 호출
  */
  useEffect(() => {

    async function load() {

      try {

        const res = await apiListLogs({ limit: 300 })

        setLogs(res.items)

      } catch (e: any) {

        setError(e?.message || "Failed to load AI analysis")

      } finally {

        setLoading(false)

      }

    }

    load()

  }, [])



  /*
  AI 분석 로그 추출
  label 정규화
  */
  const aiLogs = useMemo(() => {

    return logs
      .filter(l => l.ai_score !== null)
      .map(l => ({
        ...l,
        ai_label: (l.ai_label ?? "unknown").toLowerCase(),
      }))

  }, [logs])



  /*
  모델 목록 생성
  */
  const models = useMemo(() => {

    return [...new Set(aiLogs.map(a => a.ai_model_version).filter((v): v is string => Boolean(v)))]

  }, [aiLogs])



  /*
  Label 분포 계산
  */
  const labelDistribution = useMemo(() => {

    const counts: Record<string, number> = {}

    aiLogs.forEach(a => {

      const label = a.ai_label ?? "unknown"

      counts[label] = (counts[label] || 0) + 1

    })

    return Object.entries(counts).map(([name, value]) => ({
      name,
      value
    }))

  }, [aiLogs])



  /*
  모델 사용량 계산
  */
  const modelUsage = useMemo(() => {

    const counts: Record<string, number> = {}

    aiLogs.forEach(a => {

      const model = a.ai_model_version ?? "unknown"

      counts[model] = (counts[model] || 0) + 1

    })

    return Object.entries(counts).map(([model, count]) => ({
      model,
      count
    }))

  }, [aiLogs])



  /*
  Latency 추세 계산
  */
  const aiLatencyOverTime = useMemo(() => {

    const buckets: Record<string, number[]> = {}

    aiLogs.forEach(l => {

      const hour = (l.detect_timestamp ?? "").slice(0, 13)

      if (!buckets[hour]) buckets[hour] = []

      if (l.ai_latency_ms !== null)
        buckets[hour].push(l.ai_latency_ms as number)

    })

    return Object.entries(buckets).map(([hour, values]) => ({

      hour,

      avg_latency:
        values.reduce((a, b) => a + b, 0) / values.length || 0

    }))

  }, [aiLogs])



  /*
  Score 분포 계산
  */
  const aiScoreDistribution = useMemo(() => {

    const ranges = Array.from({ length: 10 }).map((_, i) => ({
      range: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`,
      count: 0
    }))

    aiLogs.forEach(l => {

      if (l.ai_score === null) return

      const idx = Math.min(9, Math.floor(l.ai_score * 10))

      ranges[idx].count++

    })

    return ranges

  }, [aiLogs])



  /*
  필터 적용
  */
  const filtered = useMemo(() => {

    let data = [...aiLogs]

    if (filters.label !== "all")
      data = data.filter(a => a.ai_label === filters.label)

    if (filters.model !== "all")
      data = data.filter(a => a.ai_model_version === filters.model)

    if (filters.minScore)
      data = data.filter(a => (a.ai_score ?? 0) >= Number(filters.minScore))

    if (filters.maxScore)
      data = data.filter(a => (a.ai_score ?? 0) <= Number(filters.maxScore))

    return data.sort(
      (a, b) =>
        new Date(b.detect_timestamp).getTime() -
        new Date(a.detect_timestamp).getTime()
    )

  }, [filters, aiLogs])



  /*
  페이지 계산
  */
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  const paginated = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  )



  if (loading)
    return <div className="p-4 text-sm">Loading AI analysis...</div>


  return (
    <div className="flex flex-col gap-4">

      {error && (
        <div className="text-sm text-destructive">
          {error}
        </div>
      )}

      <Breadcrumb>
        <BreadcrumbList>

          <BreadcrumbItem>
            <BreadcrumbLink href="/dashboard">
              Dashboard
            </BreadcrumbLink>
          </BreadcrumbItem>

          <BreadcrumbSeparator />

          <BreadcrumbItem>
            <BreadcrumbPage>
              AI Analysis
            </BreadcrumbPage>
          </BreadcrumbItem>

        </BreadcrumbList>
      </Breadcrumb>


      <div>
        <h1 className="text-xl font-semibold text-foreground">
          AI Analysis
        </h1>

        <p className="text-sm text-muted-foreground">
          {filtered.length} analysis records
        </p>
      </div>



      {/* Chart 영역 */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">

        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">
              Score Distribution
            </CardTitle>
          </CardHeader>

          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={aiScoreDistribution}>
                <CartesianGrid strokeDasharray="3 3"/>
                <XAxis dataKey="range"/>
                <YAxis/>
                <Tooltip/>
                <Bar dataKey="count" fill="#2563EB"/>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>


        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">
              Label Distribution
            </CardTitle>
          </CardHeader>

          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={labelDistribution}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={55}
                  innerRadius={30}
                >
                  {labelDistribution.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip/>
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>


        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">
              Latency Trend
            </CardTitle>
          </CardHeader>

          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={aiLatencyOverTime}>
                <CartesianGrid strokeDasharray="3 3"/>
                <XAxis dataKey="hour"/>
                <YAxis/>
                <Tooltip/>
                <Line
                  type="monotone"
                  dataKey="avg_latency"
                  stroke="#2563EB"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>


        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">
              Model Usage
            </CardTitle>
          </CardHeader>

          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={modelUsage}>
                <CartesianGrid strokeDasharray="3 3"/>
                <XAxis dataKey="model"/>
                <YAxis/>
                <Tooltip/>
                <Bar dataKey="count" fill="#059669"/>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

      </div>



      {/* 필터 UI */}
      <Card className="border shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-3">

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase">Label</label>

            <Select
              value={filters.label}
              onValueChange={v => {
                setFilters(f => ({ ...f, label: v }))
                setPage(1)
              }}
            >

              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="malicious">Malicious</SelectItem>
                <SelectItem value="suspicious">Suspicious</SelectItem>
                <SelectItem value="benign">Benign</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>

            </Select>
          </div>


          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase">Model</label>

            <Select
              value={filters.model}
              onValueChange={v => {
                setFilters(f => ({ ...f, model: v }))
                setPage(1)
              }}
            >

              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="all">All</SelectItem>

                {models.map(m => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}

              </SelectContent>

            </Select>
          </div>


          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase">Min Score</label>

            <Input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={filters.minScore}
              onChange={e => {
                setFilters(f => ({ ...f, minScore: e.target.value }))
                setPage(1)
              }}
              className="h-8 w-[80px] text-xs"
            />
          </div>


          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase">Max Score</label>

            <Input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={filters.maxScore}
              onChange={e => {
                setFilters(f => ({ ...f, maxScore: e.target.value }))
                setPage(1)
              }}
              className="h-8 w-[80px] text-xs"
            />
          </div>


          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setFilters({
                label: "all",
                model: "all",
                minScore: "",
                maxScore: ""
              })
              setPage(1)
            }}
          >
            <X className="mr-1 size-3"/>
            Clear
          </Button>

        </CardContent>
      </Card>



      {/* 테이블 */}
      <Card className="border shadow-sm overflow-hidden">

        <Table>

          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Log ID</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Model</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>

            {paginated.map(log => (

              <TableRow key={log.log_id}>

                <TableCell className="font-mono">
                  {new Date(log.detect_timestamp).toLocaleString()}
                </TableCell>

                <TableCell>
                  <Link
                    href={`/logs/${log.log_id}`}
                    className="text-primary hover:underline"
                  >
                    {log.log_id}
                  </Link>
                </TableCell>

                <TableCell className="font-mono">
                  {log.ai_score?.toFixed(3)}
                </TableCell>

                <TableCell>
                  <StatusChip value={log.ai_label ?? "unknown"} type="aiLabel"/>
                </TableCell>

                <TableCell className="font-mono">
                  {log.ai_latency_ms ?? "-"} ms
                </TableCell>

                <TableCell className="font-mono text-muted-foreground">
                  {log.ai_model_version}
                </TableCell>

              </TableRow>

            ))}

          </TableBody>

        </Table>

      </Card>



      {/* 페이지네이션 */}
      <div className="flex items-center justify-between text-sm">

        <span className="text-xs text-muted-foreground">
          Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
        </span>

        <div className="flex items-center gap-1">

          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </Button>

        </div>

      </div>

    </div>
  )
}
