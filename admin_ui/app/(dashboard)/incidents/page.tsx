"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusChip } from "@/components/status-chip"
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

const PAGE_SIZE = 10

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

function getSummaryAccent(status: IncidentStatusTab): string {
  if (status === "OPEN") return "from-amber-500/90 to-orange-400/70"
  if (status === "IN_PROGRESS") return "from-blue-600/90 to-blue-400/70"
  return "from-slate-500/90 to-slate-400/70"
}

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

function getActionBadgeClass(action: string | null | undefined): string {
  const v = String(action || "").toUpperCase()

  if (v === "BLOCK") return "border-red-200 bg-red-50 text-red-700"
  if (v === "ALLOW") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (v === "CREATE_POLICY" || v === "UPDATE_POLICY") return "border-blue-200 bg-blue-50 text-blue-700"
  if (v === "NO_ACTION") return "border-slate-200 bg-slate-100 text-slate-600"

  return "border-slate-200 bg-slate-100 text-slate-600"
}

export default function IncidentsPage() {
  const [activeTab, setActiveTab] = useState<IncidentStatusTab>("OPEN")
  const [page, setPage] = useState(1)

  const [items, setItems] = useState<ReviewEvent[]>([])
  const [total, setTotal] = useState(0)

  const [summaryCounts, setSummaryCounts] = useState<Record<IncidentStatusTab, number>>({
    OPEN: 0,
    IN_PROGRESS: 0,
    CLOSED: 0,
  })

  const [loading, setLoading] = useState(true)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let alive = true

    async function loadSummary() {
      try {
        setSummaryLoading(true)

        const [openRes, inProgressRes, closedRes] = await Promise.all([
          apiListIncidents({ status: "OPEN", limit: 1, page: 1 }),
          apiListIncidents({ status: "IN_PROGRESS", limit: 1, page: 1 }),
          apiListIncidents({ status: "CLOSED", limit: 1, page: 1 }),
        ])

        if (!alive) return

        setSummaryCounts({
          OPEN: openRes.total ?? 0,
          IN_PROGRESS: inProgressRes.total ?? 0,
          CLOSED: closedRes.total ?? 0,
        })
      } catch {
        if (!alive) return
      } finally {
        if (!alive) return
        setSummaryLoading(false)
      }
    }

    loadSummary()

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true

    async function load() {
      try {
        setLoading(true)
        setError("")

        const res = await apiListIncidents({
          status: activeTab,
          limit: PAGE_SIZE,
          page,
          sort: "created_at",
          dir: "desc",
        })

        if (!alive) return

        setItems(res.items ?? [])
        setTotal(res.total ?? 0)
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
  }, [activeTab, page])

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(total / PAGE_SIZE))
  }, [total])

  const summaryCards = useMemo<SummaryCardItem[]>(
    () => [
      {
        label: "Open Incidents",
        value: summaryCounts.OPEN,
        icon: AlertTriangle,
        accentClass: getSummaryAccent("OPEN"),
        subText: "Pending analyst attention",
      },
      {
        label: "In Progress",
        value: summaryCounts.IN_PROGRESS,
        icon: Clock3,
        accentClass: getSummaryAccent("IN_PROGRESS"),
        subText: "Being reviewed or processed",
      },
      {
        label: "Closed",
        value: summaryCounts.CLOSED,
        icon: CheckCircle2,
        accentClass: getSummaryAccent("CLOSED"),
        subText: "Resolved review events",
      },
    ],
    [summaryCounts]
  )

  const pageStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const pageEnd = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="flex flex-col gap-4">
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

      <div>
        <h1 className="text-xl font-semibold text-[#111827]">
          Incidents (Review Queue)
        </h1>
        <p className="text-sm text-[#6B7280]">
          {loading
            ? "Loading incidents..."
            : `${activeTab.replace("_", " ")} · ${total.toLocaleString()} total`}
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {summaryCards.map((item) => (
          <Card
            key={item.label}
            className="relative overflow-hidden border border-[#E5E7EB] bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
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
                  {summaryLoading ? "…" : item.value.toLocaleString()}
                </span>
                <span className="text-[11px] text-[#9CA3AF]">{item.subText}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as IncidentStatusTab)
          setPage(1)
        }}
      >
        <TabsList>
          <TabsTrigger value="OPEN" className="gap-1.5 text-xs">
            Open
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              {summaryCounts.OPEN}
            </span>
          </TabsTrigger>

          <TabsTrigger value="IN_PROGRESS" className="gap-1.5 text-xs">
            In Progress
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
              {summaryCounts.IN_PROGRESS}
            </span>
          </TabsTrigger>

          <TabsTrigger value="CLOSED" className="gap-1.5 text-xs">
            Closed
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
              {summaryCounts.CLOSED}
            </span>
          </TabsTrigger>
        </TabsList>

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
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-[#6B7280]">
                      No incidents with status {activeTab.replace("_", " ")}
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((rev) => (
                    <TableRow
                      key={rev.review_id}
                      className={cn("text-xs transition-colors duration-150", getIncidentRowClass(rev))}
                    >
                      <TableCell className="font-mono text-[11px] text-[#6B7280]">
                        {fmt(rev.created_at)}
                      </TableCell>

                      <TableCell>
                        <Link
                          href={`/logs/${rev.log_id}`}
                          className="font-mono text-primary hover:underline"
                        >
                          {rev.log_id}
                        </Link>
                      </TableCell>

                      <TableCell>
                        <StatusChip value={rev.status} type="review" size="sm" />
                      </TableCell>

                      <TableCell className="text-[11px] text-[#6B7280]">
                        {rev.reviewer_id ?? "—"}
                      </TableCell>

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

            <div className="flex items-center justify-between border-t bg-white px-4 py-3">
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
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
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
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </Tabs>
    </div>
  )
}
