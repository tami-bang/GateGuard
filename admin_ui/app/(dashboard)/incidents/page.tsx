"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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

import {
  AlertTriangle,
  Clock3,
  CheckCircle2,
  ArrowRight,
} from "lucide-react"

import {
  apiListIncidents,
  type ReviewEvent,
} from "@/lib/api-client"

type IncidentStatusTab = "OPEN" | "IN_PROGRESS" | "CLOSED"

type SummaryCardItem = {
  label: string
  value: number
  icon: typeof AlertTriangle
  accentClass: string
  subText: string
}

/*
시간 포맷
*/
function fmt(ts: string | null | undefined): string {
  if (!ts) return "—"
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/*
요약 카드 accent
*/
function getSummaryAccent(status: IncidentStatusTab): string {
  if (status === "OPEN") return "from-amber-500/90 to-orange-400/70"
  if (status === "IN_PROGRESS") return "from-blue-600/90 to-blue-400/70"
  return "from-slate-500/90 to-slate-400/70"
}

/*
incident 행 강조
*/
function getIncidentRowClass(rev: ReviewEvent): string {
  const status = String(rev.status || "").toUpperCase()

  if (status === "OPEN") {
    return "border-l-2 border-l-amber-400 bg-amber-50/30 hover:bg-amber-50/50"
  }

  if (status === "IN_PROGRESS") {
    return "border-l-2 border-l-blue-400 bg-blue-50/25 hover:bg-blue-50/45"
  }

  return "hover:bg-slate-50"
}

/*
제안 액션 표시용 스타일
- StatusChip과 톤 맞추되 간단한 badge로 처리
*/
function getActionBadgeClass(action: string | null | undefined): string {
  const v = String(action || "").toUpperCase()

  if (v === "BLOCK") return "border-red-200 bg-red-50 text-red-700"
  if (v === "ALLOW") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (v === "CREATE_POLICY" || v === "UPDATE_POLICY") return "border-blue-200 bg-blue-50 text-blue-700"
  if (v === "NO_ACTION") return "border-slate-200 bg-slate-100 text-slate-600"

  return "border-slate-200 bg-slate-100 text-slate-600"
}

export default function IncidentsPage() {
  const [items, setItems] = useState<ReviewEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  /*
  incident 목록 로드
  */
  useEffect(() => {
    let alive = true

    async function load() {
      try {
        setLoading(true)
        setError("")

        const res = await apiListIncidents({ limit: 200, page: 1 })

        if (!alive) return
        setItems(res.items ?? [])
      } catch (e: any) {
        if (!alive) return
        setError(e?.message ?? "Failed to load incidents")
      } finally {
        if (!alive) return
        setLoading(false)
      }
    }

    load()

    return () => {
      alive = false
    }
  }, [])

  /*
  상태별 그룹
  */
  const grouped = useMemo(
    () => ({
      OPEN: items.filter((r) => r.status === "OPEN"),
      IN_PROGRESS: items.filter((r) => r.status === "IN_PROGRESS"),
      CLOSED: items.filter((r) => r.status === "CLOSED"),
    }),
    [items]
  )

  /*
  상단 summary cards
  */
  const summaryCards = useMemo<SummaryCardItem[]>(
    () => [
      {
        label: "Open Incidents",
        value: grouped.OPEN.length,
        icon: AlertTriangle,
        accentClass: getSummaryAccent("OPEN"),
        subText: "Pending analyst attention",
      },
      {
        label: "In Progress",
        value: grouped.IN_PROGRESS.length,
        icon: Clock3,
        accentClass: getSummaryAccent("IN_PROGRESS"),
        subText: "Being reviewed or processed",
      },
      {
        label: "Closed",
        value: grouped.CLOSED.length,
        icon: CheckCircle2,
        accentClass: getSummaryAccent("CLOSED"),
        subText: "Resolved review events",
      },
    ],
    [grouped]
  )

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
            <BreadcrumbPage>Incidents</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* 페이지 헤더 */}
      <div>
        <h1 className="text-xl font-semibold text-[#111827]">
          Incidents (Review Queue)
        </h1>
        <p className="text-sm text-[#6B7280]">
          {loading ? "Loading incidents..." : `${items.length} total incidents`}
        </p>
      </div>

      {/* 에러 표시 */}
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* 요약 카드 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {summaryCards.map((item) => (
          <Card
            key={item.label}
            className="relative overflow-hidden border border-[#E5E7EB] bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            {/* 상단 accent */}
            <div className={cn("h-1 w-full bg-gradient-to-r", item.accentClass)} />

            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-slate-50 p-2">
                    <item.icon className="size-4 text-[#1E3A8A]" />
                  </div>
                  <span className="text-xs font-medium text-[#6B7280]">{item.label}</span>
                </div>

                <ArrowRight className="size-4 text-[#9CA3AF]" />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-2xl font-bold tracking-tight text-[#111827]">
                  {item.value.toLocaleString()}
                </span>
                <span className="text-[11px] text-[#9CA3AF]">{item.subText}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 탭 영역 */}
      <Tabs defaultValue="OPEN">
        <TabsList>
          <TabsTrigger value="OPEN" className="gap-1.5 text-xs">
            Open
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              {grouped.OPEN.length}
            </span>
          </TabsTrigger>

          <TabsTrigger value="IN_PROGRESS" className="gap-1.5 text-xs">
            In Progress
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
              {grouped.IN_PROGRESS.length}
            </span>
          </TabsTrigger>

          <TabsTrigger value="CLOSED" className="gap-1.5 text-xs">
            Closed
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
              {grouped.CLOSED.length}
            </span>
          </TabsTrigger>
        </TabsList>

        {(["OPEN", "IN_PROGRESS", "CLOSED"] as const).map((status: IncidentStatusTab) => (
          <TabsContent key={status} value={status}>
            <Card className="overflow-hidden border border-[#E5E7EB] bg-white shadow-sm">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#F8FAFC]">
                      <TableHead className="text-[11px]">Created</TableHead>
                      <TableHead className="text-[11px]">Log ID</TableHead>
                      <TableHead className="text-[11px]">Status</TableHead>
                      <TableHead className="text-[11px]">Reviewer</TableHead>
                      <TableHead className="text-[11px]">Proposed</TableHead>
                      <TableHead className="text-[11px]">Generated Policy</TableHead>
                      <TableHead className="text-[11px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-[#6B7280]">
                          Loading incidents...
                        </TableCell>
                      </TableRow>
                    ) : grouped[status].length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-[#6B7280]">
                          No incidents with status {status.replace("_", " ")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      grouped[status].map((rev) => (
                        <TableRow
                          key={rev.review_id}
                          className={cn("text-xs transition-colors duration-150", getIncidentRowClass(rev))}
                        >
                          {/* 생성 시각 */}
                          <TableCell className="font-mono text-[11px] text-[#6B7280]">
                            {fmt(rev.created_at)}
                          </TableCell>

                          {/* Log ID */}
                          <TableCell>
                            <Link
                              href={`/logs/${rev.log_id}`}
                              className="font-mono text-primary hover:underline"
                            >
                              {rev.log_id}
                            </Link>
                          </TableCell>

                          {/* Status */}
                          <TableCell>
                            <StatusChip value={rev.status} type="review" size="sm" />
                          </TableCell>

                          {/* Reviewer */}
                          <TableCell className="text-[11px] text-[#6B7280]">
                            {rev.reviewer_id ?? "—"}
                          </TableCell>

                          {/* Proposed action */}
                          <TableCell>
                            {rev.proposed_action ? (
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                  getActionBadgeClass(rev.proposed_action)
                                )}
                              >
                                {rev.proposed_action.replace(/_/g, " ")}
                              </span>
                            ) : (
                              <span className="text-[11px] text-[#6B7280]">—</span>
                            )}
                          </TableCell>

                          {/* 생성된 정책 */}
                          <TableCell className="text-[11px]">
                            {rev.generated_policy_id ? (
                              <Link
                                href={`/policies/${rev.generated_policy_id}`}
                                className="font-mono text-primary hover:underline"
                              >
                                {rev.generated_policy_id}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </TableCell>

                          {/* 상세 이동 */}
                          <TableCell>
                            <Link href={`/incidents/${rev.review_id}`}>
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
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
