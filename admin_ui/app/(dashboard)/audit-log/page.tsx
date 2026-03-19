"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ExternalLink, Filter, Search, X } from "lucide-react"

import {
  apiListPolicyAudits,
  type PolicyAuditItem,
} from "@/lib/api-client"

const PAGE_SIZE = 10
const CACHE_TTL_MS = 45_000

const actionColors: Record<string, string> = {
  CREATE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UPDATE: "bg-blue-50 text-blue-700 border-blue-200",
  DELETE: "bg-red-50 text-red-700 border-red-200",
  RULE_CREATE: "bg-cyan-50 text-cyan-700 border-cyan-200",
  RULE_UPDATE: "bg-indigo-50 text-indigo-700 border-indigo-200",
  RULE_DELETE: "bg-rose-50 text-rose-700 border-rose-200",
}

type FiltersState = {
  action: string
  policyId: string
  reviewId: string
}

type AuditUrlState = {
  filters: FiltersState
  page: number
}

type SessionCacheEnvelope<T> = {
  savedAt: number
  data: T
}

type AuditCachePayload = {
  response: {
    items: PolicyAuditItem[]
    total: number
  }
  requestKey: string
}

const INITIAL_FILTERS: FiltersState = {
  action: "all",
  policyId: "",
  reviewId: "",
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

function parseSnapshot(raw: string | null | undefined): Record<string, any> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") return parsed
    return { value: parsed }
  } catch {
    return { value: raw }
  }
}

function getPolicyObject(snapshot: Record<string, any> | null): Record<string, any> | null {
  if (!snapshot) return null
  if (snapshot.policy && typeof snapshot.policy === "object") return snapshot.policy
  return snapshot
}

function stringifyValue(value: any): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

type DiffRow = {
  key: string
  beforeValue: any
  afterValue: any
  changed: boolean
}

function buildDiffRows(beforeObj: Record<string, any> | null, afterObj: Record<string, any> | null): DiffRow[] {
  const beforePolicy = getPolicyObject(beforeObj) ?? {}
  const afterPolicy = getPolicyObject(afterObj) ?? {}

  const keys = Array.from(new Set([...Object.keys(beforePolicy), ...Object.keys(afterPolicy)]))

  return keys
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const beforeValue = beforePolicy[key]
      const afterValue = afterPolicy[key]
      return {
        key,
        beforeValue,
        afterValue,
        changed: JSON.stringify(beforeValue) !== JSON.stringify(afterValue),
      }
    })
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

function normalizeAction(value: string | null): string {
  if (!value) return "all"
  return ["CREATE", "UPDATE", "DELETE", "RULE_CREATE", "RULE_UPDATE", "RULE_DELETE"].includes(value) ? value : "all"
}

function normalizeText(value: string | null): string {
  return value?.trim() ?? ""
}

function toNumberOrUndefined(value: string): number | undefined {
  const s = value.trim()
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function isSameFilters(a: FiltersState, b: FiltersState): boolean {
  return (
    a.action === b.action &&
    a.policyId === b.policyId &&
    a.reviewId === b.reviewId
  )
}

function buildAuditQuery(params: AuditUrlState): string {
  const qs = new URLSearchParams()

  if (params.filters.action !== "all") qs.set("action", params.filters.action)
  if (params.filters.policyId.trim()) qs.set("policy_id", params.filters.policyId.trim())
  if (params.filters.reviewId.trim()) qs.set("source_review_id", params.filters.reviewId.trim())
  if (params.page > 1) qs.set("page", String(params.page))

  return qs.toString()
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])

  return v
}

export default function AuditLogPage() {
  return (
    <Suspense fallback={<AuditLogPageSkeleton />}>
      <AuditLogPageInner />
    </Suspense>
  )
}

function AuditLogPageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Audit Log</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-xl font-semibold text-foreground">Audit Log</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-6 text-sm text-muted-foreground">Fetching audit logs...</CardContent>
      </Card>
    </div>
  )
}

function AuditLogPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [filters, setFilters] = useState<FiltersState>(INITIAL_FILTERS)
  const [page, setPage] = useState(1)

  const [items, setItems] = useState<PolicyAuditItem[]>([])
  const [total, setTotal] = useState(0)

  const [initialLoading, setInitialLoading] = useState(true)
  const [tableLoading, setTableLoading] = useState(false)
  const [error, setError] = useState("")
  const [selectedAudit, setSelectedAudit] = useState<PolicyAuditItem | null>(null)

  const didHydrateFromUrl = useRef(false)
  const didInitialLoad = useRef(false)
  const restoredRequestKeyRef = useRef("")
  const lastFetchedRequestKeyRef = useRef("")
  const lastUrlSnapshotRef = useRef("")

  useEffect(() => {
    const nextFilters: FiltersState = {
      action: normalizeAction(searchParams.get("action")),
      policyId: normalizeText(searchParams.get("policy_id")),
      reviewId: normalizeText(searchParams.get("source_review_id")),
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

  const policyIdDebounced = useDebounced(filters.policyId.trim(), 300)
  const reviewIdDebounced = useDebounced(filters.reviewId.trim(), 300)

  const listQueryString = useMemo(() => {
    return buildAuditQuery({
      filters,
      page,
    })
  }, [filters, page])

  const currentListHref = useMemo(() => {
    return listQueryString ? `${pathname}?${listQueryString}` : pathname
  }, [pathname, listQueryString])

  const cacheKey = useMemo(() => `gateguard:audit-log:${currentListHref}`, [currentListHref])

  const syncUrl = useCallback(
    (nextState: AuditUrlState) => {
      const nextQuery = buildAuditQuery(nextState)
      const nextHref = nextQuery ? `${pathname}?${nextQuery}` : pathname
      const currentQuery = searchParams.toString()
      const currentHref = currentQuery ? `${pathname}?${currentQuery}` : pathname

      if (nextHref === currentHref) return
      router.replace(nextHref, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  useEffect(() => {
    const cached = readSessionCache<AuditCachePayload>(cacheKey)

    if (!cached?.response) {
      restoredRequestKeyRef.current = ""
      return
    }

    setItems(Array.isArray(cached.response.items) ? cached.response.items : [])
    setTotal(typeof cached.response.total === "number" ? cached.response.total : 0)
    setInitialLoading(false)
    setTableLoading(false)
    setError("")
    didInitialLoad.current = true
    restoredRequestKeyRef.current = cached.requestKey || ""
    lastFetchedRequestKeyRef.current = cached.requestKey || ""
  }, [cacheKey])

  const debounceSettled =
    policyIdDebounced === filters.policyId.trim() &&
    reviewIdDebounced === filters.reviewId.trim()

  const offset = (page - 1) * PAGE_SIZE

  const apiParams = useMemo(() => {
    return {
      limit: PAGE_SIZE,
      offset,
      policy_id: toNumberOrUndefined(policyIdDebounced),
      action: filters.action !== "all" ? filters.action : undefined,
      source_review_id: toNumberOrUndefined(reviewIdDebounced),
      sort: "changed_at",
      dir: "desc",
    }
  }, [offset, filters.action, policyIdDebounced, reviewIdDebounced])

  const requestKey = useMemo(() => JSON.stringify(apiParams), [apiParams])

  useEffect(() => {
    let alive = true

    async function load() {
      if (!didHydrateFromUrl.current) return
      if (!debounceSettled) return

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

        setError("")

        const res = await apiListPolicyAudits(apiParams)

        if (!alive) return

        const nextItems = res.items ?? []
        const nextTotal = res.total ?? 0

        setItems(nextItems)
        setTotal(nextTotal)
        didInitialLoad.current = true
        lastFetchedRequestKeyRef.current = requestKey

        writeSessionCache<AuditCachePayload>(cacheKey, {
          response: {
            items: nextItems,
            total: nextTotal,
          },
          requestKey,
        })
      } catch (e: any) {
        if (!alive) return
        setError(e?.message ?? "Failed to load audit logs")
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
  }, [apiParams, cacheKey, debounceSettled, requestKey])

  const selectedBefore = useMemo(
    () => parseSnapshot(selectedAudit?.before_snapshot),
    [selectedAudit]
  )

  const selectedAfter = useMemo(
    () => parseSnapshot(selectedAudit?.after_snapshot),
    [selectedAudit]
  )

  const diffRows = useMemo(
    () => buildDiffRows(selectedBefore, selectedAfter),
    [selectedBefore, selectedAfter]
  )

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const pageEnd = Math.min(page * PAGE_SIZE, total)

  const activeFilterCount =
    (filters.action !== "all" ? 1 : 0) +
    (filters.policyId.trim() ? 1 : 0) +
    (filters.reviewId.trim() ? 1 : 0)

  function commitState(nextState: AuditUrlState) {
    setFilters(nextState.filters)
    setPage(nextState.page)
    syncUrl(nextState)
  }

  function updateFilter<K extends keyof FiltersState>(key: K, value: FiltersState[K]) {
    const nextFilters = {
      ...filters,
      [key]: value,
    }

    commitState({
      filters: nextFilters,
      page: 1,
    })
  }

  function clearFilters() {
    commitState({
      filters: INITIAL_FILTERS,
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
            <BreadcrumbPage>Audit Log</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            {initialLoading ? "Loading policy audit history..." : `${total.toLocaleString()} total audit records`}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={clearFilters}
          disabled={activeFilterCount === 0 && page === 1}
        >
          <X className="mr-1 size-3.5" />
          Reset
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Card className="border shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Filter className="size-3.5" />
            Filters
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Action
            </label>
            <Select value={filters.action} onValueChange={(v) => updateFilter("action", v)}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="CREATE">Create</SelectItem>
                <SelectItem value="UPDATE">Update</SelectItem>
                <SelectItem value="DELETE">Delete</SelectItem>
                <SelectItem value="RULE_CREATE">Rule Create</SelectItem>
                <SelectItem value="RULE_UPDATE">Rule Update</SelectItem>
                <SelectItem value="RULE_DELETE">Rule Delete</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Policy ID
            </label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="number"
                placeholder="Policy ID"
                value={filters.policyId}
                onChange={(e) => updateFilter("policyId", e.target.value)}
                className="h-8 w-[150px] pl-7 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Source Review ID
            </label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="number"
                placeholder="Incident ID"
                value={filters.reviewId}
                onChange={(e) => updateFilter("reviewId", e.target.value)}
                className="h-8 w-[170px] pl-7 text-xs"
              />
            </div>
          </div>

          <div className="ml-auto text-xs text-muted-foreground">
            {activeFilterCount > 0 ? `${activeFilterCount} filter(s)` : "No filters"}
          </div>
        </CardContent>
      </Card>

      <Card className="border shadow-sm overflow-hidden">
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
                <TableHead className="text-[11px]">Changed At</TableHead>
                <TableHead className="text-[11px]">Action</TableHead>
                <TableHead className="text-[11px]">Policy</TableHead>
                <TableHead className="text-[11px]">Changed By</TableHead>
                <TableHead className="text-[11px]">Source Review</TableHead>
                <TableHead className="text-[11px]">Note</TableHead>
                <TableHead className="text-[11px]">Detail</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {initialLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    Loading audit logs...
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    No audit records found
                  </TableCell>
                </TableRow>
              ) : (
                items.map((audit) => {
                  const policyHref = `/policies/${audit.policy_id}?returnTo=${encodeURIComponent(currentListHref)}`
                  const incidentHref = audit.source_review_id
                    ? `/incidents/${audit.source_review_id}?returnTo=${encodeURIComponent(currentListHref)}`
                    : ""

                  return (
                    <TableRow key={audit.audit_id} className="text-xs">
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {fmt(audit.changed_at)}
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[11px] font-semibold ${
                            actionColors[audit.action] || "bg-muted text-foreground border-border"
                          }`}
                        >
                          {audit.action}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <Link
                          href={policyHref}
                          className="text-primary hover:underline font-mono text-[11px] inline-flex items-center gap-1"
                        >
                          {audit.policy_name ?? `Policy #${audit.policy_id}`}
                          <ExternalLink className="size-3" />
                        </Link>
                      </TableCell>

                      <TableCell className="text-[11px] text-foreground">
                        {audit.changed_by ?? "—"}
                      </TableCell>

                      <TableCell>
                        {audit.source_review_id ? (
                          <Link
                            href={incidentHref}
                            className="text-primary hover:underline font-mono text-[11px]"
                          >
                            {audit.source_review_id}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell className="max-w-[250px] truncate text-[11px] text-muted-foreground">
                        {audit.change_note ?? "—"}
                      </TableCell>

                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-primary"
                          onClick={() => setSelectedAudit(audit)}
                        >
                          View Diff
                        </Button>
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
      </Card>

      <Sheet open={!!selectedAudit} onOpenChange={() => setSelectedAudit(null)}>
        <SheetContent className="w-[760px] overflow-y-auto sm:max-w-[760px]">
          <SheetHeader>
            <SheetTitle className="text-foreground">Audit Detail</SheetTitle>
            <SheetDescription>
              {selectedAudit
                ? `${selectedAudit.action} on ${selectedAudit.policy_name ?? `Policy #${selectedAudit.policy_id}`}`
                : ""}
            </SheetDescription>
          </SheetHeader>

          {selectedAudit ? (
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                      actionColors[selectedAudit.action] || "bg-muted text-foreground border-border"
                    }`}
                  >
                    {selectedAudit.action}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    by {selectedAudit.changed_by ?? "—"}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground">
                  {fmt(selectedAudit.changed_at)}
                </p>

                <p className="text-xs text-foreground">
                  {selectedAudit.change_note ?? "—"}
                </p>
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-[11px]">Field</TableHead>
                      <TableHead className="text-[11px]">Before</TableHead>
                      <TableHead className="text-[11px]">After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diffRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                          No comparable fields found
                        </TableCell>
                      </TableRow>
                    ) : (
                      diffRows.map((row) => (
                        <TableRow key={row.key} className="align-top">
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {row.key}
                          </TableCell>
                          <TableCell className="font-mono text-[11px]">
                            <span className={row.changed ? "text-muted-foreground" : "text-foreground"}>
                              {stringifyValue(row.beforeValue)}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-[11px]">
                            <span className={row.changed ? "font-semibold text-red-600" : "text-foreground"}>
                              {stringifyValue(row.afterValue)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Raw Before
                  </h4>
                  <pre className="max-h-[240px] overflow-auto rounded-md border border-red-200 bg-red-50 p-3 text-[11px] font-mono text-foreground">
                    {selectedBefore !== null ? JSON.stringify(selectedBefore, null, 2) : "null (new record)"}
                  </pre>
                </div>

                <div>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Raw After
                  </h4>
                  <pre className="max-h-[240px] overflow-auto rounded-md border border-emerald-200 bg-emerald-50 p-3 text-[11px] font-mono text-foreground">
                    {selectedAfter !== null ? JSON.stringify(selectedAfter, null, 2) : "null (deleted)"}
                  </pre>
                </div>
              </div>

              {selectedAudit.source_review_id ? (
                <div className="rounded-md border p-3">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Source Incident
                  </p>
                  <Link
                    href={`/incidents/${selectedAudit.source_review_id}?returnTo=${encodeURIComponent(currentListHref)}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {selectedAudit.source_review_id}
                    <ExternalLink className="size-3" />
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
