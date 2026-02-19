"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { StatusChip } from "@/components/status-chip"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Plus, X } from "lucide-react"
import { mockPolicies } from "@/lib/mock-data"

const riskColors: Record<string, string> = {
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  LOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
}

export default function PoliciesPage() {
  const [filters, setFilters] = useState({
    type: "all",
    action: "all",
    enabled: "all",
    riskLevel: "all",
  })

  const filtered = useMemo(() => {
    let policies = [...mockPolicies]
    if (filters.type !== "all") policies = policies.filter(p => p.policy_type === filters.type)
    if (filters.action !== "all") policies = policies.filter(p => p.action === filters.action)
    if (filters.enabled !== "all") policies = policies.filter(p => (filters.enabled === "true") === p.is_enabled)
    if (filters.riskLevel !== "all") policies = policies.filter(p => p.risk_level === filters.riskLevel)
    return policies.sort((a, b) => b.priority - a.priority)
  }, [filters])

  function clearFilters() {
    setFilters({ type: "all", action: "all", enabled: "all", riskLevel: "all" })
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Policies</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Policies</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} policies</p>
        </div>
        <Link href="/policies/new">
          <Button size="sm" className="h-8 gap-1.5 text-xs">
            <Plus className="size-3.5" /> New Policy
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card className="border shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Type</label>
            <Select value={filters.type} onValueChange={v => setFilters(f => ({ ...f, type: v }))}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ALLOWLIST">Allowlist</SelectItem>
                <SelectItem value="BLOCKLIST">Blocklist</SelectItem>
                <SelectItem value="MONITOR">Monitor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Action</label>
            <Select value={filters.action} onValueChange={v => setFilters(f => ({ ...f, action: v }))}>
              <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
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
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Enabled</label>
            <Select value={filters.enabled} onValueChange={v => setFilters(f => ({ ...f, enabled: v }))}>
              <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="true">Enabled</SelectItem>
                <SelectItem value="false">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Risk</label>
            <Select value={filters.riskLevel} onValueChange={v => setFilters(f => ({ ...f, riskLevel: v }))}>
              <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
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
            <X className="mr-1 size-3" /> Clear
          </Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border shadow-sm overflow-hidden">
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
            {filtered.map(p => (
              <TableRow key={p.policy_id} className="text-xs">
                <TableCell className="font-mono text-[11px] text-muted-foreground">{p.policy_id}</TableCell>
                <TableCell className="font-medium text-foreground max-w-[180px] truncate">{p.policy_name}</TableCell>
                <TableCell><StatusChip value={p.policy_type} type="policyType" /></TableCell>
                <TableCell><StatusChip value={p.action} /></TableCell>
                <TableCell className="font-mono text-[11px]">{p.priority}</TableCell>
                <TableCell>
                  <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold ${riskColors[p.risk_level] || ""}`}>
                    {p.risk_level}
                  </span>
                </TableCell>
                <TableCell className="text-[11px] text-muted-foreground">{p.category}</TableCell>
                <TableCell>
                  <Badge variant={p.is_enabled ? "default" : "secondary"} className={`text-[10px] ${p.is_enabled ? "bg-success text-white border-0" : ""}`}>
                    {p.is_enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {new Date(p.updated_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Link href={`/policies/${p.policy_id}`}>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-primary">View</Button>
                    </Link>
                    <Link href={`/policies/${p.policy_id}/edit`}>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground">Edit</Button>
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
