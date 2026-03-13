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
import { ArrowLeft, Edit, Trash2, Loader2, X } from "lucide-react"

import {
  apiDeletePolicy,
  apiGetPolicy,
  apiGetPolicyAudit,
  apiListPolicyAudits,
  apiListPolicyRules,
  toBool,
  type Policy,
  type PolicyAuditItem,
  type PolicyRule,
} from "@/lib/api-client"

const riskColors: Record<string, string> = {
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  LOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
}

const auditActionColors: Record<string, string> = {
  CREATE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UPDATE: "bg-blue-50 text-blue-700 border-blue-200",
  DELETE: "bg-red-50 text-red-700 border-red-200",
  RULE_CREATE: "bg-cyan-50 text-cyan-700 border-cyan-200",
  RULE_UPDATE: "bg-indigo-50 text-indigo-700 border-indigo-200",
  RULE_DELETE: "bg-rose-50 text-rose-700 border-rose-200",
}

function fmtDate(ts: string | null | undefined): string {
  if (!ts) return "N/A"
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString()
}

function parseSnapshot(value: string | null | undefined): any | null {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function extractComparableFields(audit: PolicyAuditItem): Array<{ field: string; before: any; after: any }> {
  const beforeObj = parseSnapshot(audit.before_snapshot)
  const afterObj = parseSnapshot(audit.after_snapshot)

  const beforePolicy = beforeObj?.policy ?? {}
  const afterPolicy = afterObj?.policy ?? {}

  const keys = Array.from(
    new Set([
      ...Object.keys(beforePolicy || {}),
      ...Object.keys(afterPolicy || {}),
    ])
  )

  return keys
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      field: key,
      before: beforePolicy?.[key] ?? null,
      after: afterPolicy?.[key] ?? null,
    }))
}

function AuditDetailModal({
  audit,
  onClose,
}: {
  audit: PolicyAuditItem
  onClose: () => void
}) {
  const rows = extractComparableFields(audit)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Audit Detail</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {audit.action} on {audit.policy_name ?? `Policy #${audit.policy_id}`}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <span
              className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${
                auditActionColors[audit.action] || "bg-muted text-foreground border-border"
              }`}
            >
              {audit.action}
            </span>
            <span className="text-muted-foreground">by {audit.changed_by ?? "N/A"}</span>
            <span className="text-muted-foreground">{fmtDate(audit.changed_at)}</span>
          </div>

          {audit.change_note ? (
            <div className="mb-4 rounded border bg-muted/30 px-3 py-2 text-sm text-foreground">
              {audit.change_note}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Field</th>
                  <th className="px-4 py-3 text-left font-medium">Before</th>
                  <th className="px-4 py-3 text-left font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                      No comparable policy fields
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const changed = JSON.stringify(row.before) !== JSON.stringify(row.after)
                    return (
                      <tr key={row.field} className="border-t align-top">
                        <td className="px-4 py-3 font-mono text-xs">{row.field}</td>
                        <td className="px-4 py-3 text-xs text-foreground break-all">
                          {row.before === null || row.before === undefined ? "—" : String(row.before)}
                        </td>
                        <td className={`px-4 py-3 text-xs break-all ${changed ? "text-red-600 font-semibold" : "text-foreground"}`}>
                          {row.after === null || row.after === undefined ? "—" : String(row.after)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Raw Before
              </p>
              <pre className="max-h-72 overflow-auto rounded border bg-red-50 p-3 text-xs text-foreground">
{audit.before_snapshot
  ? JSON.stringify(parseSnapshot(audit.before_snapshot), null, 2)
  : "{}"}
              </pre>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Raw After
              </p>
              <pre className="max-h-72 overflow-auto rounded border bg-emerald-50 p-3 text-xs text-foreground">
{audit.after_snapshot
  ? JSON.stringify(parseSnapshot(audit.after_snapshot), null, 2)
  : "{}"}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const policyId = Number(params?.id)

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [rules, setRules] = useState<PolicyRule[]>([])
  const [audits, setAudits] = useState<PolicyAuditItem[]>([])
  const [auditDetail, setAuditDetail] = useState<PolicyAuditItem | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [auditLoadingId, setAuditLoadingId] = useState<number | null>(null)

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

        const a = await apiListPolicyAudits({
          policy_id: policyId,
          limit: 50,
          offset: 0,
          sort: "changed_at",
          dir: "desc",
        }).catch(() => ({ items: [] as PolicyAuditItem[] }))

        if (!alive) return
        setAudits(a.items ?? [])
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

  async function handleOpenAudit(auditId: number) {
    if (auditLoadingId === auditId) return

    try {
      setAuditLoadingId(auditId)
      const data = await apiGetPolicyAudit(auditId)
      setAuditDetail(data)
      setAuditOpen(true)
    } catch (e: any) {
      window.alert(e?.message ?? "Failed to load audit detail")
    } finally {
      setAuditLoadingId(null)
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
          <Link href="/policies">
            <Button variant="outline" size="sm">Back to Policies</Button>
          </Link>
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
            <Button variant="ghost" size="sm" className="h-8 px-2">
              <ArrowLeft className="size-4" />
            </Button>
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
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Description</p>
                <p className="text-xs leading-relaxed text-foreground">{policy.description}</p>
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
                <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Block Status Code</dt>
                <dd className="mt-0.5 font-mono text-xs text-foreground">{policy.block_status_code ?? "N/A"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Redirect URL</dt>
                <dd className="mt-0.5 break-all font-mono text-xs text-foreground">{policy.redirect_url ?? "N/A"}</dd>
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
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No rules defined
                </TableCell>
              </TableRow>
            ) : (
              rules.map((rule) => (
                <TableRow key={rule.rule_id} className="text-xs">
                  <TableCell className="font-mono text-[11px]">{rule.rule_order}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[11px]">{rule.rule_type}</Badge></TableCell>
                  <TableCell><Badge variant="secondary" className="text-[11px]">{rule.match_type}</Badge></TableCell>
                  <TableCell className="max-w-[200px] truncate font-mono text-[11px] text-foreground">{rule.pattern}</TableCell>
                  <TableCell className="text-[11px]">{toBool(rule.is_case_sensitive) ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-[11px]">{toBool(rule.is_negated) ? "Yes" : "No"}</TableCell>
                  <TableCell><Switch checked={toBool(rule.is_enabled)} className="scale-75" /></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Card className="border shadow-sm overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">
            Audit History ({audits.length})
          </CardTitle>
        </CardHeader>

        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-[11px]">When</TableHead>
              <TableHead className="text-[11px]">Action</TableHead>
              <TableHead className="text-[11px]">Changed By</TableHead>
              <TableHead className="text-[11px]">Review ID</TableHead>
              <TableHead className="text-[11px]">Note</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {audits.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No audit history
                </TableCell>
              </TableRow>
            ) : (
              audits.map((audit) => (
                <TableRow key={audit.audit_id} className="text-xs">
                  <TableCell className="text-[11px] text-foreground">
                    {fmtDate(audit.changed_at)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                        auditActionColors[audit.action] || "bg-muted text-foreground border-border"
                      }`}
                    >
                      {audit.action}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-foreground">
                    {audit.changed_by ?? "N/A"}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-foreground">
                    {audit.source_review_id ?? "N/A"}
                  </TableCell>
                  <TableCell className="max-w-[420px] text-[11px]">
                    <button
                      className="max-w-[420px] truncate text-left text-blue-600 hover:underline disabled:opacity-50"
                      title={audit.change_note ?? ""}
                      onClick={() => handleOpenAudit(audit.audit_id)}
                      disabled={auditLoadingId === audit.audit_id}
                    >
                      {auditLoadingId === audit.audit_id
                        ? "Loading diff..."
                        : (audit.change_note ?? "View Diff")}
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {auditOpen && auditDetail ? (
        <AuditDetailModal
          audit={auditDetail}
          onClose={() => {
            setAuditOpen(false)
            setAuditDetail(null)
          }}
        />
      ) : null}
    </div>
  )
}
