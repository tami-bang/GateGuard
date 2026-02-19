"use client"

import { use, useMemo } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusChip } from "@/components/status-chip"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { ArrowLeft, Edit, Trash2 } from "lucide-react"
import { mockPolicies, mockPolicyRules } from "@/lib/mock-data"

const riskColors: Record<string, string> = {
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  LOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
}

export default function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const policy = useMemo(() => mockPolicies.find(p => p.policy_id === id), [id])
  const rules = useMemo(() => mockPolicyRules.filter(r => r.policy_id === id).sort((a, b) => a.rule_order - b.rule_order), [id])

  if (!policy) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">Policy not found</p>
        <Link href="/policies"><Button variant="outline" size="sm">Back to Policies</Button></Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink href="/policies">Policies</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{policy.policy_name}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/policies">
            <Button variant="ghost" size="sm" className="h-8 px-2"><ArrowLeft className="size-4" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">{policy.policy_name}</h1>
              <Badge variant={policy.is_enabled ? "default" : "secondary"} className={`text-[10px] ${policy.is_enabled ? "bg-success text-white border-0" : ""}`}>
                {policy.is_enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <p className="font-mono text-xs text-muted-foreground">{policy.policy_id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/policies/${id}/edit`}>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Edit className="size-3.5" /> Edit
            </Button>
          </Link>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive">
            <Trash2 className="size-3.5" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Policy Metadata */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Policy Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Type</dt>
                <dd className="mt-0.5"><StatusChip value={policy.policy_type} type="policyType" /></dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Action</dt>
                <dd className="mt-0.5"><StatusChip value={policy.action} /></dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Priority</dt>
                <dd className="mt-0.5 text-xs font-mono font-semibold text-foreground">{policy.priority}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Risk Level</dt>
                <dd className="mt-0.5">
                  <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold ${riskColors[policy.risk_level] || ""}`}>
                    {policy.risk_level}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Category</dt>
                <dd className="mt-0.5 text-xs text-foreground">{policy.category}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Created By</dt>
                <dd className="mt-0.5 text-xs text-foreground">{policy.created_by}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Created</dt>
                <dd className="mt-0.5 text-xs text-foreground">{new Date(policy.created_at).toLocaleDateString()}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Last Updated</dt>
                <dd className="mt-0.5 text-xs text-foreground">{new Date(policy.updated_at).toLocaleDateString()} by {policy.updated_by}</dd>
              </div>
            </dl>
            {policy.description && (
              <div className="mt-4">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                <p className="text-xs text-foreground leading-relaxed">{policy.description}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Block Response Config */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Block Response Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-y-3 text-sm">
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Block Status Code</dt>
                <dd className="mt-0.5 text-xs font-mono text-foreground">{policy.block_status_code || "N/A"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Redirect URL</dt>
                <dd className="mt-0.5 text-xs font-mono text-foreground break-all">{policy.redirect_url || "N/A"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Rules */}
      <Card className="border shadow-sm overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Policy Rules ({rules.length})</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-[11px]">Order</TableHead>
              <TableHead className="text-[11px]">Rule Type</TableHead>
              <TableHead className="text-[11px]">Match Type</TableHead>
              <TableHead className="text-[11px]">Pattern</TableHead>
              <TableHead className="text-[11px]">Case Sensitive</TableHead>
              <TableHead className="text-[11px]">Negated</TableHead>
              <TableHead className="text-[11px]">Enabled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">No rules defined</TableCell>
              </TableRow>
            ) : rules.map(rule => (
              <TableRow key={rule.rule_id} className="text-xs">
                <TableCell className="font-mono text-[11px]">{rule.rule_order}</TableCell>
                <TableCell><Badge variant="outline" className="text-[11px]">{rule.rule_type}</Badge></TableCell>
                <TableCell><Badge variant="secondary" className="text-[11px]">{rule.match_type}</Badge></TableCell>
                <TableCell className="font-mono text-[11px] text-foreground max-w-[200px] truncate">{rule.pattern}</TableCell>
                <TableCell className="text-[11px]">{rule.is_case_sensitive ? "Yes" : "No"}</TableCell>
                <TableCell className="text-[11px]">{rule.is_negated ? "Yes" : "No"}</TableCell>
                <TableCell><Switch checked={rule.is_enabled} className="scale-75" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
