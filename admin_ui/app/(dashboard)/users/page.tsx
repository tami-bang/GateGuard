"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

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
import { Search, X } from "lucide-react"

import { apiListUsers, type UserItem, toBool } from "@/lib/api-client"

const PAGE_SIZE = 10
const CACHE_TTL_MS = 45_000

type FiltersState = {
  q: string
  role: string
  isActive: string
  is2faEnabled: string
}

type UsersUrlState = {
  filters: FiltersState
  page: number
}

type SessionCacheEnvelope<T> = {
  savedAt: number
  data: T
}

type UsersCachePayload = {
  response: {
    items: UserItem[]
    total: number
  }
  requestKey: string
}

const INITIAL_FILTERS: FiltersState = {
  q: "",
  role: "all",
  isActive: "all",
  is2faEnabled: "all",
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

function normalizeRole(value: string | null): string {
  if (!value) return "all"
  return ["Admin", "Operator", "Engineer"].includes(value) ? value : "all"
}

function normalizeBoolFilter(value: string | null): string {
  if (!value) return "all"
  return value === "true" || value === "false" ? value : "all"
}

function normalizeText(value: string | null): string {
  return value?.trim() ?? ""
}

function isSameFilters(a: FiltersState, b: FiltersState): boolean {
  return (
    a.q === b.q &&
    a.role === b.role &&
    a.isActive === b.isActive &&
    a.is2faEnabled === b.is2faEnabled
  )
}

function buildUsersQuery(params: UsersUrlState): string {
  const qs = new URLSearchParams()

  if (params.filters.q.trim()) qs.set("q", params.filters.q.trim())
  if (params.filters.role !== "all") qs.set("role", params.filters.role)
  if (params.filters.isActive !== "all") qs.set("is_active", params.filters.isActive)
  if (params.filters.is2faEnabled !== "all") qs.set("is_2fa_enabled", params.filters.is2faEnabled)
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

function formatDateTime(v: string | null | undefined): string {
  if (!v) return "—"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function UsersPage() {
  return (
    <Suspense fallback={<UsersPageSkeleton />}>
      <UsersPageInner />
    </Suspense>
  )
}

function UsersPageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Users</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-6 text-sm text-muted-foreground">Fetching users...</CardContent>
      </Card>
    </div>
  )
}

function UsersPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [filters, setFilters] = useState<FiltersState>(INITIAL_FILTERS)
  const [page, setPage] = useState(1)

  const [items, setItems] = useState<UserItem[]>([])
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
      q: normalizeText(searchParams.get("q")),
      role: normalizeRole(searchParams.get("role")),
      isActive: normalizeBoolFilter(searchParams.get("is_active")),
      is2faEnabled: normalizeBoolFilter(searchParams.get("is_2fa_enabled")),
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

  const debouncedQ = useDebounced(filters.q.trim(), 300)
  const offset = (page - 1) * PAGE_SIZE

  const listQueryString = useMemo(() => {
    return buildUsersQuery({
      filters,
      page,
    })
  }, [filters, page])

  const currentListHref = useMemo(() => {
    return listQueryString ? `${pathname}?${listQueryString}` : pathname
  }, [pathname, listQueryString])

  const cacheKey = useMemo(() => `gateguard:users:${currentListHref}`, [currentListHref])

  const syncUrl = useCallback(
    (nextState: UsersUrlState) => {
      const nextQuery = buildUsersQuery(nextState)
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
      q: debouncedQ || undefined,
      role: filters.role !== "all" ? filters.role : undefined,
      is_active: filters.isActive !== "all" ? (filters.isActive === "true" ? 1 : 0) : undefined,
      is_2fa_enabled: filters.is2faEnabled !== "all" ? (filters.is2faEnabled === "true" ? 1 : 0) : undefined,
      sort: "created_at",
      dir: "desc",
    })
  }, [offset, debouncedQ, filters.role, filters.isActive, filters.is2faEnabled])

  useEffect(() => {
    const cached = readSessionCache<UsersCachePayload>(cacheKey)

    if (!cached?.response) {
      restoredRequestKeyRef.current = ""
      return
    }

    setItems(Array.isArray(cached.response.items) ? cached.response.items : [])
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

    async function loadUsers() {
      if (!didHydrateFromUrl.current) return
      if (debouncedQ !== filters.q.trim()) return

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

        const res = await apiListUsers({
          limit: PAGE_SIZE,
          offset,
          q: debouncedQ || undefined,
          role: filters.role !== "all" ? filters.role : undefined,
          is_active: filters.isActive !== "all" ? (filters.isActive === "true" ? 1 : 0) : undefined,
          is_2fa_enabled: filters.is2faEnabled !== "all" ? (filters.is2faEnabled === "true" ? 1 : 0) : undefined,
          sort: "created_at",
          dir: "desc",
        })

        if (cancelled) return

        const nextItems = Array.isArray(res.items) ? res.items : []
        const nextTotal = typeof res.total === "number" ? res.total : 0

        setItems(nextItems)
        setTotal(nextTotal)
        didInitialLoad.current = true
        lastFetchedRequestKeyRef.current = requestKey

        writeSessionCache<UsersCachePayload>(cacheKey, {
          response: {
            items: nextItems,
            total: nextTotal,
          },
          requestKey,
        })
      } catch (err) {
        if (cancelled) return
        setItems([])
        setTotal(0)
        setError(err instanceof Error ? err.message : "Failed to load users")
      } finally {
        if (cancelled) return
        setInitialLoading(false)
        setTableLoading(false)
      }
    }

    loadUsers()

    return () => {
      cancelled = true
    }
  }, [offset, cacheKey, requestKey, filters.q, debouncedQ, filters.role, filters.isActive, filters.is2faEnabled])

  const activeFilterCount =
    (filters.q.trim() ? 1 : 0) +
    (filters.role !== "all" ? 1 : 0) +
    (filters.isActive !== "all" ? 1 : 0) +
    (filters.is2faEnabled !== "all" ? 1 : 0)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + items.length, total)

  function commitState(nextState: UsersUrlState) {
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
            <BreadcrumbPage>Users</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Users</h1>
          <p className="text-sm text-muted-foreground">
            {initialLoading ? "Loading users..." : `${total.toLocaleString()} total users`}
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
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Name / username / email"
                value={filters.q}
                onChange={(e) => updateFilter("q", e.target.value)}
                className="h-8 w-[220px] pl-7 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Role
            </label>
            <Select value={filters.role} onValueChange={(v) => updateFilter("role", v)}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="Admin">Admin</SelectItem>
                <SelectItem value="Operator">Operator</SelectItem>
                <SelectItem value="Engineer">Engineer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Active
            </label>
            <Select value={filters.isActive} onValueChange={(v) => updateFilter("isActive", v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              2FA
            </label>
            <Select value={filters.is2faEnabled} onValueChange={(v) => updateFilter("is2faEnabled", v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="true">Enabled</SelectItem>
                <SelectItem value="false">Disabled</SelectItem>
              </SelectContent>
            </Select>
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
                <TableHead className="text-[11px]">ID</TableHead>
                <TableHead className="text-[11px]">Name</TableHead>
                <TableHead className="text-[11px]">Username</TableHead>
                <TableHead className="text-[11px]">Email</TableHead>
                <TableHead className="text-[11px]">Role</TableHead>
                <TableHead className="text-[11px]">Status</TableHead>
                <TableHead className="text-[11px]">2FA</TableHead>
                <TableHead className="text-[11px]">Created</TableHead>
                <TableHead className="text-[11px]">Last Login</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {initialLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                items.map((user) => (
                  <TableRow key={user.id} className="text-xs">
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{user.id}</TableCell>
                    <TableCell className="font-medium text-foreground">{user.name}</TableCell>
                    <TableCell className="font-mono text-[11px]">{user.username}</TableCell>
                    <TableCell className="text-[11px]">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={toBool(user.is_active) ? "default" : "secondary"}
                        className={`text-[10px] ${toBool(user.is_active) ? "bg-success text-white border-0" : ""}`}
                      >
                        {toBool(user.is_active) ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={toBool(user.is_2fa_enabled) ? "default" : "secondary"}
                        className={`text-[10px] ${toBool(user.is_2fa_enabled) ? "bg-[#2563EB] text-white border-0" : ""}`}
                      >
                        {toBool(user.is_2fa_enabled) ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {formatDateTime(user.created_at)}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {formatDateTime(user.last_login_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between border-t bg-white px-4 py-3">
          <div className="text-xs text-muted-foreground">
            {total === 0 ? "No results" : `Showing ${pageStart}-${pageEnd} of ${total.toLocaleString()}`}
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
    </div>
  )
}
