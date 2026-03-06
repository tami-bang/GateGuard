"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { StatusChip } from "@/components/status-chip"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Plus, X } from "lucide-react"
import { apiListPolicies, type Policy, toBool } from "@/lib/api-client"

const riskColors: Record<string, string> = {
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  LOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
}

function formatDate(v: string | null): string {
  if (!v) return "-"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" })
}

export default function PoliciesPage() {
  const [filters, setFilters] = useState({
    type: "all",
    action: "all",
    enabled: "all",
    riskLevel: "all",
  })

  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadPolicies() {
      try {
        setLoading(true)
        setError(null)

        const res = await apiListPolicies({
          limit: 100,
          offset: 0,
          sort: "created_at",
          dir: "desc",
        })

        if (!cancelled) {
          setPolicies(Array.isArray(res.items) ? res.items : [])
        }
      } catch (err) {
        if (!cancelled) {
          setPolicies([])
          setError(err instanceof Error ? err.message : "Failed to load policies")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadPolicies()

    return () => {
      cancelled = true
    }
  }, [])

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

  function clearFilters() {
    setFilters({
      type: "all",
      action: "all",
      enabled: "all",
      riskLevel: "all",
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
            {loading ? "Loading..." : `${filtered.length} policies`}
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
            <Select value={filters.type} onValueChange={(v) => setFilters((f) => ({ ...f, type: v }))}>
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
            <Select value={filters.action} onValueChange={(v) => setFilters((f) => ({ ...f, action: v }))}>
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
            <Select value={filters.enabled} onValueChange={(v) => setFilters((f) => ({ ...f, enabled: v }))}>
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
            <Select
              value={filters.riskLevel}
              onValueChange={(v) => setFilters((f) => ({ ...f, riskLevel: v }))}
            >
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

          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={clearFilters}>
            <X className="mr-1 size-3" />
            Clear
          </Button>
        </CardContent>
      </Card>

      <Card className="border shadow-sm overflow-hidden">
        {error ? (
          <div className="p-4 text-sm text-red-600">{error}</div>
        ) : (
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
              {!loading && filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-xs text-muted-foreground">
                    No policies found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => (
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
                        <Link href={`/policies/${p.policy_id}`}>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-primary">
                            View
                          </Button>
                        </Link>

                        <Link href={`/policies/${p.policy_id}/edit`}>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground">
                            Edit
                          </Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
