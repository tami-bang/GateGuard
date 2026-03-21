"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

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

import { AlertTriangle, Clock3, CheckCircle2, ArrowRight, Download } from "lucide-react"

import {
  apiListIncidents,
  downloadCsvFile,
  escapeCsvValue,
  formatLocalDateTimeForFile,
  type ReviewEvent,
} from "@/lib/api-client"

type IncidentStatusTab = "OPEN" | "IN_PROGRESS" | "CLOSED"

type SummaryCardItem = {
  label: string
  value: number
  icon: typeof AlertTriangle
  accentClass: string
  subText: string
  status: IncidentStatusTab
}

type IncidentListCache = {
  items: ReviewEvent[]
  total: number
  summaryCounts: Record<IncidentStatusTab, number>
}

type CachedIncidentList = {
  payload: IncidentListCache
  requestKey: string
}

type SessionCacheEnvelope<T> = {
  savedAt: number
  data: T
}

type IncidentsUrlState = {
  status: IncidentStatusTab
  page: number
}

const PAGE_SIZE = 10
const CACHE_TTL_MS = 45_000
const SUMMARY_CACHE_KEY = "gateguard:incidents:summary"
const EXPORT_BATCH_SIZE = 500

function readSessionCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null

  const raw = window.sessionStorage.getItem(key)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as SessionCacheEnvelope<T>
    if (!parsed || typeof parsed !== "object") {
      window.sessionStorage.removeItem(key)
      return null
    }

    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > CACHE_TTL_MS) {
      window.sessionStorage.removeItem(key)
      return null
    }

    return parsed.data ?? null
  } catch {
    window.sessionStorage.removeItem(key)
    return null
  }
}

function writeSessionCache<T>(key: string, data: T) {
  if (typeof window === "undefined") return

  const payload: SessionCacheEnvelope<T> = {
    savedAt: Date.now(),
    data,
  }

  window.sessionStorage.setItem(key, JSON.stringify(payload))
}

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

function formatDateTimeForCsv(value?: string | null): string {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

function buildIncidentsCsv(items: ReviewEvent[]): string {
  const headers = [
    "review_id",
    "log_id",
    "status",
    "proposed_action",
    "reviewer_id",
    "note",
    "created_at",
    "reviewed_at",
    "generated_policy_id",
  ]

  const rows = items.map((it) =>
    [
      it.review_id,
      it.log_id,
      it.status,
      it.proposed_action,
      it.reviewer_id,
      it.note,
      formatDateTimeForCsv(it.created_at),
      formatDateTimeForCsv(it.reviewed_at),
      it.generated_policy_id,
    ]
      .map(escapeCsvValue)
      .join(",")
  )

  return [headers.join(","), ...rows].join("\n")
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

function normalizeStatusParam(value: string | null): IncidentStatusTab {
  if (value === "OPEN" || value === "IN_PROGRESS" || value === "CLOSED") return value
  return "OPEN"
}

function normalizePageParam(value: string | null): number {
  if (!value) return 1
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
}

function buildIncidentsQuery(status: IncidentStatusTab, page: number): string {
  const qs = new URLSearchParams()
  if (status !== "OPEN") qs.set("status", status)
  if (page > 1) qs.set("page", String(page))
  return qs.toString()
}

export default function IncidentsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [activeTab, setActiveTab] = useState<IncidentStatusTab>("OPEN")
  const [page, setPage] = useState(1)

  const [items, setItems] = useState<ReviewEvent[]>([])
  const [total, setTotal] = useState(0)

  const [summaryCounts, setSummaryCounts] = useState<Record<IncidentStatusTab, number>>({
    OPEN: 0,
    IN_PROGRESS: 0,
    CLOSED: 0,
  })

  const [initialLoading, setInitialLoading] = useState(true)
  const [tableLoading, setTableLoading] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [error, setError] = useState("")
  const [exportLoading, setExportLoading] = useState(false)

  const didHydrateFromUrl = useRef(false)
  const didInitialLoad = useRef(false)
  const restoredRequestKeyRef = useRef("")
  const lastFetchedRequestKeyRef = useRef("")
  const summaryCountsRef = useRef(summaryCounts)
  const lastUrlSnapshotRef = useRef("")

  useEffect(() => {
    summaryCountsRef.current = summaryCounts
  }, [summaryCounts])

  useEffect(() => {
    const nextStatus = normalizeStatusParam(searchParams.get("status"))
    const nextPage = normalizePageParam(searchParams.get("page"))

    const snapshot = JSON.stringify({
      status: nextStatus,
      page: nextPage,
    })

    if (lastUrlSnapshotRef.current === snapshot) {
      didHydrateFromUrl.current = true
      return
    }

    lastUrlSnapshotRef.current = snapshot

    setActiveTab((prev) => (prev === nextStatus ? prev : nextStatus))
    setPage((prev) => (prev === nextPage ? prev : nextPage))
    didHydrateFromUrl.current = true
  }, [searchParams])

  const listQueryString = useMemo(() => buildIncidentsQuery(activeTab, page), [activeTab, page])

  const currentListHref = useMemo(() => {
    return listQueryString ? `${pathname}?${listQueryString}` : pathname
  }, [pathname, listQueryString])

  const cacheKey = useMemo(() => `gateguard:incidents:${currentListHref}`, [currentListHref])

  const syncUrl = useCallback(
    (nextState: IncidentsUrlState) => {
      const nextQuery = buildIncidentsQuery(nextState.status, nextState.page)
      const nextHref = nextQuery ? `${pathname}?${nextQuery}` : pathname
      const currentQuery = searchParams.toString()
      const currentHref = currentQuery ? `${pathname}?${currentQuery}` : pathname

      if (nextHref === currentHref) return

      router.replace(nextHref, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  useEffect(() => {
    const cached = readSessionCache<CachedIncidentList>(cacheKey)

    if (!cached?.payload) {
      restoredRequestKeyRef.current = ""
      return
    }

    setItems(cached.payload.items ?? [])
    setTotal(cached.payload.total ?? 0)

    if (cached.payload.summaryCounts) {
      setSummaryCounts(cached.payload.summaryCounts)
      setSummaryLoading(false)
    }

    setInitialLoading(false)
    setTableLoading(false)
    setError("")
    didInitialLoad.current = true
    restoredRequestKeyRef.current = cached.requestKey || ""
    lastFetchedRequestKeyRef.current = cached.requestKey || ""
  }, [cacheKey])

  useEffect(() => {
    let alive = true

    const cachedSummary = readSessionCache<Record<IncidentStatusTab, number>>(SUMMARY_CACHE_KEY)
    if (cachedSummary) {
      setSummaryCounts(cachedSummary)
      setSummaryLoading(false)
    }

    async function loadSummary() {
      try {
        if (!cachedSummary) {
          setSummaryLoading(true)
        }

        const [openRes, inProgressRes, closedRes] = await Promise.all([
          apiListIncidents({ status: "OPEN", limit: 1, page: 1 }),
          apiListIncidents({ status: "IN_PROGRESS", limit: 1, page: 1 }),
          apiListIncidents({ status: "CLOSED", limit: 1, page: 1 }),
        ])

        if (!alive) return

        const nextSummaryCounts: Record<IncidentStatusTab, number> = {
          OPEN: openRes.total ?? 0,
          IN_PROGRESS: inProgressRes.total ?? 0,
          CLOSED: closedRes.total ?? 0,
        }

        setSummaryCounts(nextSummaryCounts)
        summaryCountsRef.current = nextSummaryCounts
        writeSessionCache(SUMMARY_CACHE_KEY, nextSummaryCounts)
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

  const requestKey = useMemo(
    () => JSON.stringify({ status: activeTab, page, sort: "created_at", dir: "desc", limit: PAGE_SIZE }),
    [activeTab, page]
  )

  useEffect(() => {
    let alive = true

    async function load() {
      if (!didHydrateFromUrl.current) return

      try {
        if (restoredRequestKeyRef.current && restoredRequestKeyRef.current === requestKey) {
          restoredRequestKeyRef.current = ""
          lastFetchedRequestKeyRef.current = requestKey
          return
        }

        if (lastFetchedRequestKeyRef.current === requestKey) {
          return
        }

        if (didInitialLoad.current) {
          setTableLoading(true)
        } else {
          setInitialLoading(true)
        }

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
        didInitialLoad.current = true
        lastFetchedRequestKeyRef.current = requestKey

        const cached: IncidentListCache = {
          items: res.items ?? [],
          total: res.total ?? 0,
          summaryCounts: summaryCountsRef.current,
        }

        writeSessionCache<CachedIncidentList>(cacheKey, {
          payload: cached,
          requestKey,
        })
      } catch (e: any) {
        if (!alive) return
        setError(e?.message ?? "Failed to load incidents")
      } finally {
        if (!alive) return
        setInitialLoading(false)
        setTableLoading(false)
      }
    }

    load()

    return () => {
      alive = false
    }
  }, [activeTab, page, cacheKey, requestKey])

  function commitState(nextState: IncidentsUrlState) {
    setActiveTab(nextState.status)
    setPage(nextState.page)
    syncUrl(nextState)
  }

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
        status: "OPEN",
      },
      {
        label: "In Progress",
        value: summaryCounts.IN_PROGRESS,
        icon: Clock3,
        accentClass: getSummaryAccent("IN_PROGRESS"),
        subText: "Being reviewed or processed",
        status: "IN_PROGRESS",
      },
      {
        label: "Closed",
        value: summaryCounts.CLOSED,
        icon: CheckCircle2,
        accentClass: getSummaryAccent("CLOSED"),
        subText: "Resolved review events",
        status: "CLOSED",
      },
    ],
    [summaryCounts]
  )

  const pageStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const pageEnd = Math.min(page * PAGE_SIZE, total)

  async function handleExportCsv() {
    try {
      setExportLoading(true)
      setError("")

      const first = await apiListIncidents({
        status: activeTab,
        limit: EXPORT_BATCH_SIZE,
        page: 1,
        sort: "created_at",
        dir: "desc",
      })

      let allItems = [...(first.items ?? [])]
      const exportTotal = first.total ?? allItems.length

      for (let nextPage = 2; allItems.length < exportTotal; nextPage += 1) {
        const batch = await apiListIncidents({
          status: activeTab,
          limit: EXPORT_BATCH_SIZE,
          page: nextPage,
          sort: "created_at",
          dir: "desc",
        })

        if (!batch.items?.length) break
        allItems = allItems.concat(batch.items)
      }

      const csv = buildIncidentsCsv(allItems)
      const filename = `gateguard_incidents_${activeTab.toLowerCase()}_${formatLocalDateTimeForFile()}.csv`
      downloadCsvFile(filename, csv)
    } catch (e: any) {
      setError(e?.message || "Failed to export incidents CSV")
    } finally {
      setExportLoading(false)
    }
  }

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

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#111827]">Incidents (Review Queue)</h1>
          <p className="text-sm text-[#6B7280]">
            {initialLoading ? "Loading incidents..." : `${activeTab.replace("_", " ")} · ${total.toLocaleString()} total`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs transition-all duration-200"
            onClick={handleExportCsv}
            disabled={initialLoading || exportLoading || total === 0}
          >
            <Download className="mr-1 size-3.5" />
            {exportLoading ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

	  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {summaryCards.map((item) => {
          const isActive = activeTab === item.status

          return (
            <Card
              key={item.label}
              role="button"
              tabIndex={0}
              onClick={() =>
                commitState({
                  status: item.status,
                  page: 1,
                })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  commitState({
                    status: item.status,
                    page: 1,
                  })
                }
              }}
              className={cn(
                "relative overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200 cursor-pointer",
				"hover:-translate-y-0.5 hover:shadow-md",
                isActive
				  ? "border-[#BFDBFE] bg-[#F8FBFF] shadow-md"
				  : "border-[#E5E7EB] hover:border-[#D6E4FF]"
              )}
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

                  <ArrowRight
                    className={cn(
                      "size-4 transition-colors",
                      isActive ? "text-[#2563EB]" : "text-[#9CA3AF]"
                    )}
                  /> 
                </div>

                <div className="flex flex-col gap-1">
                  <span className={cn(
				    "text-2xl font-bold tracking-tight transition-colors",
					isActive ? "text-[#1E3A8A]" : "text-[#111827]"
				  )}
				>
                    {summaryLoading ? "…" : item.value.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-[#9CA3AF]">{item.subText}</span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          commitState({
            status: value as IncidentStatusTab,
            page: 1,
          })
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

        {initialLoading ? (
          <Card className="overflow-hidden border border-[#E5E7EB] bg-white shadow-sm">
            <CardContent className="p-6 text-sm text-[#6B7280]">Loading incidents...</CardContent>
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden border border-[#E5E7EB] bg-white shadow-sm">
              <CardContent className="relative p-0">
                {tableLoading && (
                  <>
                    <div className="absolute left-0 right-0 top-0 z-10 h-1 overflow-hidden bg-slate-100">
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500" />
                    </div>
                    <div className="pointer-events-none absolute inset-0 z-10 bg-white/40" />
                  </>
                )}

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
                    {!tableLoading && items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-[#6B7280]">
                          No incidents with status {activeTab.replace("_", " ")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      items.map((rev) => {
                        const incidentDetailHref = `/incidents/${rev.review_id}?returnTo=${encodeURIComponent(currentListHref)}`
                        const logDetailHref = `/logs/${rev.log_id}?returnTo=${encodeURIComponent(currentListHref)}`

                        return (
                          <TableRow
                            key={rev.review_id}
                            className={cn("text-xs transition-colors duration-150", getIncidentRowClass(rev))}
                          >
                            <TableCell className="font-mono text-[11px] text-[#6B7280]">{fmt(rev.created_at)}</TableCell>

                            <TableCell>
                              <Link href={logDetailHref} className="font-mono text-primary hover:underline">
                                {rev.log_id}
                              </Link>
                            </TableCell>

                            <TableCell>
                              <StatusChip value={rev.status} type="review" size="sm" />
                            </TableCell>

                            <TableCell className="text-[11px] text-[#6B7280]">{rev.reviewer_id ?? "—"}</TableCell>

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
                              <Link href={incidentDetailHref}>
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
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between border-t bg-white px-4 py-3">
              <div className="text-xs text-[#6B7280]">
                {total === 0 ? "No results" : `Showing ${pageStart}-${pageEnd} of ${total.toLocaleString()}`}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || tableLoading}
                  onClick={() =>
                    commitState({
                      status: activeTab,
                      page: Math.max(1, page - 1),
                    })
                  }
                >
                  Previous
                </Button>

                <span className="min-w-[88px] text-center text-xs text-[#6B7280]">
                  Page {page} / {totalPages}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || tableLoading}
                  onClick={() =>
                    commitState({
                      status: activeTab,
                      page: Math.min(totalPages, page + 1),
                    })
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Tabs>
    </div>
  )
}
