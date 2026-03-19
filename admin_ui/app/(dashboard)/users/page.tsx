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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Plus, Search, X, Pencil, ShieldCheck, ShieldOff } from "lucide-react"

import {
  apiCreateUser,
  apiListUsers,
  apiPatchUser,
  apiToggleUser2FA,
  type CreateUserRequest,
  type PatchUserRequest,
  type UserItem,
  toBool,
} from "@/lib/api-client"

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

type UserFormMode = "create" | "edit"

type UserFormState = {
  username: string
  name: string
  email: string
  role: string
  password: string
  is_active: string
}

const INITIAL_FILTERS: FiltersState = {
  q: "",
  role: "all",
  isActive: "all",
  is2faEnabled: "all",
}

const INITIAL_FORM: UserFormState = {
  username: "",
  name: "",
  email: "",
  role: "OPERATOR",
  password: "",
  is_active: "true",
}

const ROLE_OPTIONS = ["ADMIN", "OPERATOR", "ENGINEER"] as const

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
  const upper = value.trim().toUpperCase()
  return ROLE_OPTIONS.includes(upper as (typeof ROLE_OPTIONS)[number]) ? upper : "all"
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

function getUserRowKey(user: UserItem, index: number): string {
  return String(user.id ?? user.email ?? user.username ?? `row-${index}`)
}

function getDisplayName(user: UserItem): string {
  return user.name?.trim() || "—"
}

function getDisplayUsername(user: UserItem): string {
  return user.username?.trim() || "—"
}

function getDisplayId(user: UserItem): string {
  if (user.id === null || user.id === undefined) return "—"
  return String(user.id)
}

function buildFormFromUser(user: UserItem): UserFormState {
  return {
    username: user.username?.trim() || "",
    name: user.name?.trim() || "",
    email: user.email?.trim() || "",
    role: user.role?.trim() || "OPERATOR",
    password: "",
    is_active: toBool(user.is_active) ? "true" : "false",
  }
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

  const [dialogOpen, setDialogOpen] = useState(false)
  const [formMode, setFormMode] = useState<UserFormMode>("create")
  const [editingUser, setEditingUser] = useState<UserItem | null>(null)
  const [form, setForm] = useState<UserFormState>(INITIAL_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionUserId, setActionUserId] = useState<number | null>(null)

  const didHydrateFromUrl = useRef(false)
  const didInitialLoad = useRef(false)
  const restoredRequestKeyRef = useRef("")
  const lastFetchedRequestKeyRef = useRef("")
  const lastUrlSnapshotRef = useRef("")
  const [reloadTick, setReloadTick] = useState(0)

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
      reloadTick,
    })
  }, [offset, debouncedQ, filters.role, filters.isActive, filters.is2faEnabled, reloadTick])

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

  function invalidateCurrentListCache() {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(cacheKey)
    }
    restoredRequestKeyRef.current = ""
    lastFetchedRequestKeyRef.current = ""
    setReloadTick((prev) => prev + 1)
  }

  function openCreateDialog() {
    setFormMode("create")
    setEditingUser(null)
    setForm(INITIAL_FORM)
    setFormError(null)
    setDialogOpen(true)
  }

  function openEditDialog(user: UserItem) {
    setFormMode("edit")
    setEditingUser(user)
    setForm(buildFormFromUser(user))
    setFormError(null)
    setDialogOpen(true)
  }

  function updateForm<K extends keyof UserFormState>(key: K, value: UserFormState[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  async function handleSubmitUser() {
    setFormError(null)

    const username = form.username.trim()
    const name = form.name.trim()
    const email = form.email.trim()
    const role = form.role.trim().toUpperCase()
    const password = form.password

    if (!username) {
      setFormError("Username is required")
      return
    }

    if (!name) {
      setFormError("Name is required")
      return
    }

    if (!email) {
      setFormError("Email is required")
      return
    }

    if (!ROLE_OPTIONS.includes(role as (typeof ROLE_OPTIONS)[number])) {
      setFormError("Role must be ADMIN, OPERATOR, or ENGINEER")
      return
    }

    if (formMode === "create" && !password.trim()) {
      setFormError("Password is required for new user")
      return
    }

    try {
      setSubmitting(true)

      if (formMode === "create") {
        const payload: CreateUserRequest = {
          username,
          name,
          email,
          role,
          password,
          is_active: form.is_active === "true" ? 1 : 0,
          is_2fa_enabled: 0,
        }

        await apiCreateUser(payload)
      } else {
        if (!editingUser?.id) {
          setFormError("Editable user id not found")
          return
        }

        const payload: PatchUserRequest = {
          username,
          name,
          email,
          role,
          is_active: form.is_active === "true" ? 1 : 0,
        }

        if (password.trim()) {
          payload.password = password
        }

        await apiPatchUser(editingUser.id, payload)
      }

      setDialogOpen(false)
      invalidateCurrentListCache()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save user")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggle2FA(user: UserItem) {
    if (!user.id) {
      alert("User id not found")
      return
    }

    const nextEnabled = toBool(user.is_2fa_enabled) ? 0 : 1
    const ok = window.confirm(
      nextEnabled === 1
        ? `Enable 2FA for ${user.username || user.email || user.name}?`
        : `Disable 2FA for ${user.username || user.email || user.name}?`
    )

    if (!ok) return

    try {
      setActionUserId(user.id)
      await apiToggleUser2FA(user.id, { enabled: nextEnabled })
      invalidateCurrentListCache()
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to toggle 2FA")
    } finally {
      setActionUserId(null)
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

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" className="h-8 text-xs" onClick={openCreateDialog}>
            <Plus className="mr-1 size-3.5" />
            New User
          </Button>

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
                <SelectItem value="ADMIN">ADMIN</SelectItem>
                <SelectItem value="OPERATOR">OPERATOR</SelectItem>
                <SelectItem value="ENGINEER">ENGINEER</SelectItem>
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

      <Card className="overflow-hidden border shadow-sm">
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
                <TableHead className="text-[11px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {initialLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                items.map((user, index) => (
                  <TableRow key={getUserRowKey(user, index)} className="text-xs">
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {getDisplayId(user)}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">{getDisplayName(user)}</TableCell>
                    <TableCell className="font-mono text-[11px]">{getDisplayUsername(user)}</TableCell>
                    <TableCell className="text-[11px]">{user.email ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {user.role ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={toBool(user.is_active) ? "default" : "secondary"}
                        className={`text-[10px] ${toBool(user.is_active) ? "border-0 bg-success text-white" : ""}`}
                      >
                        {toBool(user.is_active) ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={toBool(user.is_2fa_enabled) ? "default" : "secondary"}
                        className={`text-[10px] ${toBool(user.is_2fa_enabled) ? "border-0 bg-[#2563EB] text-white" : ""}`}
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
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => openEditDialog(user)}
                          disabled={!user.id}
                        >
                          <Pencil className="mr-1 size-3" />
                          Edit
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => handleToggle2FA(user)}
                          disabled={!user.id || actionUserId === user.id}
                        >
                          {toBool(user.is_2fa_enabled) ? (
                            <>
                              <ShieldOff className="mr-1 size-3" />
                              Disable 2FA
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="mr-1 size-3" />
                              Enable 2FA
                            </>
                          )}
                        </Button>
                      </div>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{formMode === "create" ? "Create User" : "Edit User"}</DialogTitle>
            <DialogDescription>
              {formMode === "create"
                ? "Create a new GateGuard admin user."
                : "Update user profile, role, active status, and optional password."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {formError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {formError}
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="user-username">Username</Label>
              <Input
                id="user-username"
                value={form.username}
                onChange={(e) => updateForm("username", e.target.value)}
                placeholder="operator01"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="user-name">Name</Label>
              <Input
                id="user-name"
                value={form.name}
                onChange={(e) => updateForm("name", e.target.value)}
                placeholder="GateGuard Operator"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={form.email}
                onChange={(e) => updateForm("email", e.target.value)}
                placeholder="operator@gateguard.local"
              />
            </div>

            <div className="grid gap-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => updateForm("role", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">ADMIN</SelectItem>
                  <SelectItem value="OPERATOR">OPERATOR</SelectItem>
                  <SelectItem value="ENGINEER">ENGINEER</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={form.is_active} onValueChange={(v) => updateForm("is_active", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="user-password">
                {formMode === "create" ? "Password" : "Password (leave blank to keep current)"}
              </Label>
              <Input
                id="user-password"
                type="password"
                value={form.password}
                onChange={(e) => updateForm("password", e.target.value)}
                placeholder={formMode === "create" ? "Enter password" : "Optional"}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSubmitUser} disabled={submitting}>
              {submitting ? "Saving..." : formMode === "create" ? "Create User" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
