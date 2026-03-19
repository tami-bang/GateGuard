"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { StatusChip } from "@/components/status-chip"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

import { Plus, X } from "lucide-react"

import { apiListPolicies, type Policy, toBool } from "@/lib/api-client"

const PAGE_SIZE = 10
const CACHE_TTL_MS = 45_000

const riskColors: Record<string, string> = {
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  LOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
}

type FiltersState = {
  type: string
  action: string
  enabled: string
  riskLevel: string
}

type PoliciesUrlState = {
  filters: FiltersState
  page: number
}

type SessionCacheEnvelope<T> = {
  savedAt: number
  data: T
}

type PoliciesCachePayload = {
  response: {
    items: Policy[]
    total: number
  }
  requestKey: string
}

const INITIAL_FILTERS: FiltersState = {
  type: "all",
  action: "all",
  enabled: "all",
  riskLevel: "all",
}

function formatDate(v: string | null): string {
  if (!v) return "-"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" })
}

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

function normalizePage(value: string | null): number {
  if (!value) return 1
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
}

function normalizeType(value: string | null): string {
  if (!value) return "all"
  return ["ALLOWLIST", "BLOCKLIST", "MONITOR"].includes(value) ? value : "all"
}

function normalizeAction(value: string | null): string {
  if (!value) return "all"
  return ["ALLOW", "BLOCK", "REDIRECT", "REVIEW"].includes(value) ? value : "all"
}

function normalizeEnabled(value: string | null): string {
  if (!value) return "all"
  return value === "true" || value === "false" ? value : "all"
}

function normalizeRiskLevel(value: string | null): string {
  if (!value) return "all"
  return ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(value) ? value : "all"
}

function isSameFilters(a: FiltersState, b: FiltersState): boolean {
  return (
    a.type === b.type &&
    a.action === b.action &&
    a.enabled === b.enabled &&
    a.riskLevel === b.riskLevel
  )
}

function buildPoliciesQuery(params: PoliciesUrlState): string {
  const qs = new URLSearchParams()

  if (params.filters.type !== "all") qs.set("type", params.filters.type)
  if (params.filters.action !== "all") qs.set("action", params.filters.action)
  if (params.filters.enabled !== "all") qs.set("enabled", params.filters.enabled)
  if (params.filters.riskLevel !== "all") qs.set("risk_level", params.filters.riskLevel)
  if (params.page > 1) qs.set("page", String(params.page))

  return qs.toString()
}

export default function PoliciesPage() {
  return (
    <Suspense fallback={<PoliciesPageSkeleton />}>
      <PoliciesPageInner />
    </Suspense>
  )
}

function PoliciesPageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Policies</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-xl font-semibold text-foreground">Policies</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-6 text-sm text-muted-foreground">Fetching policies...</CardContent>
      </Card>
    </div>
  )
}

function PoliciesPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [filters, setFilters] = useState<FiltersState>(INITIAL_FILTERS)
  const [page, setPage] = useState(1)

  const [policies, setPolicies] = useState<Policy[]>([])
  const [total, setTotal] = useState(0)

  const [initialLoading, setInitialLoading] = useState(true)
  const [tableLoading, setTableLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const didHydrateFromUrl = useRef(false)
  const didInitialLoad = useRef(false)
  const restoredRequestKeyRef = useRef("")
  const lastFetchedRequestKeyRef = useRef("")
  const lastUrlSnapshotRef = useRef("")

  useEffect(() => {
    const nextFilters: FiltersState = {
      type: normalizeType(searchParams.get("type")),
      action: normalizeAction(searchParams.get("action")),
      enabled: normalizeEnabled(searchParams.get("enabled")),
      riskLevel: normalizeRiskLevel(searchParams.get("risk_level")),
    }

    const nextPage = normalizePage(searchParams.get("page"))

    const snapshot = JSON.stringify({
      filters: nextFilters,
      page: nextPage,
    })

    if (lastUrlSnapshotRef.current === snapshot) {
      didHydrateFromUrl.current = true
      return
    }

    lastUrlSnapshotRef.current = snapshot

    setFilters((prev) => (isSameFilters(prev, nextFilters) ? prev : nextFilters))
    setPage((prev) => (prev === nextPage ? prev : nextPage))
    didHydrateFromUrl.current = true
  }, [searchParams])

  const offset = (page - 1) * PAGE_SIZE

  const listQueryString = useMemo(() => {
    return buildPoliciesQuery({
      filters,
      page,
    })
  }, [filters, page])

  const currentListHref = useMemo(() => {
    return listQueryString ? `${pathname}?${listQueryString}` : pathname
  }, [pathname, listQueryString])

  const cacheKey = useMemo(() => `gateguard:policies:${currentListHref}`, [currentListHref])

  const syncUrl = useCallback(
    (nextState: PoliciesUrlState) => {
      const nextQuery = buildPoliciesQuery(nextState)
      const nextHref = nextQuery ? `${pathname}?${nextQuery}` : pathname
      const currentQuery = searchParams.toString()
      const currentHref = currentQuery ? `${pathname}?${currentQuery}` : pathname

      if (nextHref === currentHref) return
      router.replace(nextHref, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const requestKey = useMemo(() => {
    return JSON.stringify({
      limit: PAGE_SIZE,
      offset,
      sort: "created_at",
      dir: "desc",
    })
  }, [offset])

  useEffect(() => {
    const cached = readSessionCache<PoliciesCachePayload>(cacheKey)

    if (!cached?.response) {
      restoredRequestKeyRef.current = ""
      return
    }

    setPolicies(Array.isArray(cached.response.items) ? cached.response.items : [])
    setTotal(typeof cached.response.total === "number" ? cached.response.total : 0)
    setInitialLoading(false)
    setTableLoading(false)
    setError(null)
    didInitialLoad.current = true
    restoredRequestKeyRef.current = cached.requestKey || ""
    lastFetchedRequestKeyRef.current = cached.requestKey || ""
  }, [cacheKey])

  useEffect(() => {
    let cancelled = false

    async function loadPolicies() {
      if (!didHydrateFromUrl.current) return

      if (restoredRequestKeyRef.current && restoredRequestKeyRef.current === requestKey) {
        restoredRequestKeyRef.current = ""
        lastFetchedRequestKeyRef.current = requestKey
        return
      }

      if (lastFetchedRequestKeyRef.current === requestKey) {
        return
      }

      try {
        if (didInitialLoad.current) {
          setTableLoading(true)
        } else {
          setInitialLoading(true)
        }

        setError(null)

        const res = await apiListPolicies({
          limit: PAGE_SIZE,
          offset,
          sort: "created_at",
          dir: "desc",
        })

        if (cancelled) return

        const nextItems = Array.isArray(res.items) ? res.items : []
        const nextTotal = typeof res.total === "number" ? res.total : 0

        setPolicies(nextItems)
        setTotal(nextTotal)
        didInitialLoad.current = true
        lastFetchedRequestKeyRef.current = requestKey

        writeSessionCache<PoliciesCachePayload>(cacheKey, {
          response: {
            items: nextItems,
            total: nextTotal,
          },
          requestKey,
        })
      } catch (err) {
        if (cancelled) return
        setPolicies([])
        setTotal(0)
        setError(err instanceof Error ? err.message : "Failed to load policies")
      } finally {
        if (cancelled) return
        setInitialLoading(false)
        setTableLoading(false)
      }
    }

    loadPolicies()

    return () => {
      cancelled = true
    }
  }, [offset, cacheKey, requestKey])

  const filtered = useMemo(() => {
    let rows = [...policies]

    if (filters.type !== "all") {
      rows = rows.filter((p) => p.policy_type === filters.type)
    }

    if (filters.action !== "all") {
      rows = rows.filter((p) => p.action === filters.action)
    }

    if (filters.enabled !== "all") {
      const wantEnabled = filters.enabled === "true"
      rows = rows.filter((p) => toBool(p.is_enabled) === wantEnabled)
    }

    if (filters.riskLevel !== "all") {
      rows = rows.filter((p) => (p.risk_level ?? "") === filters.riskLevel)
    }

    return rows.sort((a, b) => {
      const ap = a.priority ?? 0
      const bp = b.priority ?? 0
      return bp - ap
    })
  }, [policies, filters])

  const activeFilterCount =
    (filters.type !== "all" ? 1 : 0) +
    (filters.action !== "all" ? 1 : 0) +
    (filters.enabled !== "all" ? 1 : 0) +
    (filters.riskLevel !== "all" ? 1 : 0)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + policies.length, total)

  function commitState(nextState: PoliciesUrlState) {
    setFilters(nextState.filters)
    setPage(nextState.page)
    syncUrl(nextState)
  }

  function clearFilters() {
    commitState({
      filters: INITIAL_FILTERS,
      page: 1,
    })
  }

  function updateFilter(key: keyof FiltersState, value: string) {
    const nextFilters = {
      ...filters,
      [key]: value,
    }

    commitState({
      filters: nextFilters,
      page: 1,
    })
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
            <BreadcrumbPage>Policies</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Policies</h1>
          <p className="text-sm text-muted-foreground">
            {initialLoading ? "Loading..." : `${total.toLocaleString()} total policies`}
          </p>
        </div>

        <Link href="/policies/new">
          <Button size="sm" className="h-8 gap-1.5 text-xs">
            <Plus className="size-3.5" />
            New Policy
          </Button>
        </Link>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Type
            </label>
            <Select value={filters.type} onValueChange={(v) => updateFilter("type", v)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ALLOWLIST">Allowlist</SelectItem>
                <SelectItem value="BLOCKLIST">Blocklist</SelectItem>
                <SelectItem value="MONITOR">Monitor</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Action
            </label>
            <Select value={filters.action} onValueChange={(v) => updateFilter("action", v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ALLOW">Allow</SelectItem>
                <SelectItem value="BLOCK">Block</SelectItem>
                <SelectItem value="REDIRECT">Redirect</SelectItem>
                <SelectItem value="REVIEW">Review</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Enabled
            </label>
            <Select value={filters.enabled} onValueChange={(v) => updateFilter("enabled", v)}>
              <SelectTrigger className="h-8 w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="true">Enabled</SelectItem>
                <SelectItem value="false">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Risk
            </label>
            <Select value={filters.riskLevel} onValueChange={(v) => updateFilter("riskLevel", v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="text-xs text-muted-foreground">
              {activeFilterCount > 0 ? `${activeFilterCount} filter(s)` : "No filters"}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={clearFilters}
              disabled={activeFilterCount === 0 && page === 1}
            >
              <X className="mr-1 size-3" />
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border shadow-sm overflow-hidden">
        {error ? (
          <div className="p-4 text-sm text-red-600">{error}</div>
        ) : (
          <>
            <div className="relative">
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
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-[11px]">ID</TableHead>
                    <TableHead className="text-[11px]">Name</TableHead>
                    <TableHead className="text-[11px]">Type</TableHead>
                    <TableHead className="text-[11px]">Action</TableHead>
                    <TableHead className="text-[11px]">Priority</TableHead>
                    <TableHead className="text-[11px]">Risk</TableHead>
                    <TableHead className="text-[11px]">Category</TableHead>
                    <TableHead className="text-[11px]">Status</TableHead>
                    <TableHead className="text-[11px]">Updated</TableHead>
                    <TableHead className="text-[11px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {!tableLoading && filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="py-8 text-center text-xs text-muted-foreground">
                        No policies found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((p) => {
                      const detailHref = `/policies/${p.policy_id}?returnTo=${encodeURIComponent(currentListHref)}`
                      const editHref = `/policies/${p.policy_id}/edit?returnTo=${encodeURIComponent(currentListHref)}`

                      return (
                        <TableRow key={p.policy_id} className="text-xs">
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {p.policy_id}
                          </TableCell>

                          <TableCell className="max-w-[220px] truncate font-medium text-foreground">
                            {p.policy_name}
                          </TableCell>

                          <TableCell>
                            <StatusChip value={p.policy_type} type="policyType" />
                          </TableCell>

                          <TableCell>
                            <StatusChip value={p.action} />
                          </TableCell>

                          <TableCell className="font-mono text-[11px]">
                            {p.priority ?? "-"}
                          </TableCell>

                          <TableCell>
                            {p.risk_level ? (
                              <span
                                className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                                  riskColors[p.risk_level] || ""
                                }`}
                              >
                                {p.risk_level}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">-</span>
                            )}
                          </TableCell>

                          <TableCell className="text-[11px] text-muted-foreground">
                            {p.category || "-"}
                          </TableCell>

                          <TableCell>
                            <Badge
                              variant={toBool(p.is_enabled) ? "default" : "secondary"}
                              className={`text-[10px] ${toBool(p.is_enabled) ? "bg-success text-white border-0" : ""}`}
                            >
                              {toBool(p.is_enabled) ? "Enabled" : "Disabled"}
                            </Badge>
                          </TableCell>

                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {formatDate(p.updated_at)}
                          </TableCell>

                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Link href={detailHref}>
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-primary">
                                  View
                                </Button>
                              </Link>

                              <Link href={editHref}>
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground">
                                  Edit
                                </Button>
                              </Link>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between border-t bg-white px-4 py-3">
              <div className="text-xs text-muted-foreground">
                {total === 0
                  ? "No results"
                  : `Showing ${pageStart}-${pageEnd} of ${total.toLocaleString()}`}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || tableLoading}
                  onClick={() =>
                    commitState({
                      filters,
                      page: Math.max(1, page - 1),
                    })
                  }
                >
                  Previous
                </Button>

                <span className="min-w-[88px] text-center text-xs text-muted-foreground">
                  Page {page} / {totalPages}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || tableLoading}
                  onClick={() =>
                    commitState({
                      filters,
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
      </Card>
    </div>
  )
}
