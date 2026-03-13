"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusChip } from "@/components/status-chip"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { ArrowLeft, Edit, Trash2, Loader2 } from "lucide-react"

import {
  apiDeletePolicy,
  apiGetPolicy,
  apiListPolicyRules,
  toBool,
  type Policy,
  type PolicyRule,
} from "@/lib/api-client"

const riskColors: Record<string, string> = {
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  LOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
}

function fmtDate(ts: string | null | undefined): string {
  if (!ts) return "N/A"
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString()
}

export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const policyId = Number(params?.id)

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [rules, setRules] = useState<PolicyRule[]>([])
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let alive = true
    async function run() {
      if (!Number.isFinite(policyId)) {
        setErr("Invalid policy id")
        setLoading(false)
        return
      }
      setLoading(true)
      setErr(null)
      try {
        const p = await apiGetPolicy(policyId)
        if (!alive) return
        setPolicy(p.policy ?? null)

        const r = await apiListPolicyRules(policyId).catch(() => ({ items: [] as PolicyRule[] }))
        if (!alive) return
        setRules((r.items ?? []).slice().sort((a, b) => (a.rule_order ?? 0) - (b.rule_order ?? 0)))
      } catch (e: any) {
        if (!alive) return
        setErr(e?.message ?? "Failed to load policy")
      } finally {
        if (!alive) return
        setLoading(false)
      }
    }
    run()
    return () => {
      alive = false
    }
  }, [policyId])

  const enabled = useMemo(() => (policy ? toBool(policy.is_enabled) : false), [policy])

  async function handleDelete() {
    if (!policy) return
    if (deleting) return

    const ok = window.confirm(
      `정책 "${policy.policy_name}" 을(를) 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`
    )
    if (!ok) return

    try {
      setDeleting(true)
      setErr(null)

      await apiDeletePolicy(policy.policy_id)

      window.alert("정책이 삭제되었습니다.")
      router.push("/policies")
      router.refresh()
    } catch (e: any) {
      window.alert(e?.message ?? "정책 삭제에 실패했습니다.")
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading policy...
      </div>
    )
  }

  if (err || !policy) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">{err ?? "Policy not found"}</p>
        <div className="flex gap-2">
          <Link href="/policies"><Button variant="outline" size="sm">Back to Policies</Button></Link>
          <Button variant="outline" size="sm" onClick={() => router.refresh()}>Refresh</Button>
        </div>
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
              <Badge
                variant={enabled ? "default" : "secondary"}
                className={`text-[10px] ${enabled ? "bg-success text-white border-0" : ""}`}
              >
                {enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <p className="font-mono text-xs text-muted-foreground">{policy.policy_id}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href={`/policies/${policy.policy_id}/edit`}>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Edit className="size-3.5" /> Edit
            </Button>
          </Link>
    	  <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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
                <dd className="mt-0.5 text-xs font-mono font-semibold text-foreground">{policy.priority ?? "N/A"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Risk Level</dt>
                <dd className="mt-0.5">
                  <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold ${riskColors[policy.risk_level ?? ""] || ""}`}>
                    {policy.risk_level ?? "N/A"}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Category</dt>
                <dd className="mt-0.5 text-xs text-foreground">{policy.category ?? "N/A"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Created By</dt>
                <dd className="mt-0.5 text-xs text-foreground">{policy.created_by}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Created</dt>
                <dd className="mt-0.5 text-xs text-foreground">{fmtDate(policy.created_at)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Last Updated</dt>
                <dd className="mt-0.5 text-xs text-foreground">
                  {fmtDate(policy.updated_at)} {policy.updated_by ? `by ${policy.updated_by}` : ""}
                </dd>
              </div>
            </dl>

            {policy.description ? (
              <div className="mt-4">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                <p className="text-xs text-foreground leading-relaxed">{policy.description}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Block Response Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-y-3 text-sm">
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Block Status Code</dt>
                <dd className="mt-0.5 text-xs font-mono text-foreground">{policy.block_status_code ?? "N/A"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Redirect URL</dt>
                <dd className="mt-0.5 text-xs font-mono text-foreground break-all">{policy.redirect_url ?? "N/A"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

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
                <TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">
                  No rules defined
                </TableCell>
              </TableRow>
            ) : (
              rules.map(rule => (
                <TableRow key={rule.rule_id} className="text-xs">
                  <TableCell className="font-mono text-[11px]">{rule.rule_order}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[11px]">{rule.rule_type}</Badge></TableCell>
                  <TableCell><Badge variant="secondary" className="text-[11px]">{rule.match_type}</Badge></TableCell>
                  <TableCell className="font-mono text-[11px] text-foreground max-w-[200px] truncate">{rule.pattern}</TableCell>
                  <TableCell className="text-[11px]">{toBool(rule.is_case_sensitive) ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-[11px]">{toBool(rule.is_negated) ? "Yes" : "No"}</TableCell>
                  <TableCell><Switch checked={toBool(rule.is_enabled)} className="scale-75" /></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
