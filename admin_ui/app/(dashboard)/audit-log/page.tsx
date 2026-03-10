"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
import { ExternalLink } from "lucide-react"

import {
  apiListPolicyAudits,
  type PolicyAuditItem,
} from "@/lib/api-client"

const actionColors: Record<string, string> = {
  CREATE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UPDATE: "bg-blue-50 text-blue-700 border-blue-200",
  DELETE: "bg-red-50 text-red-700 border-red-200",
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

export default function AuditLogPage() {
  const [items, setItems] = useState<PolicyAuditItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedAudit, setSelectedAudit] = useState<PolicyAuditItem | null>(null)

  useEffect(() => {
    let alive = true

    async function load() {
      try {
        setLoading(true)
        setError("")

        const res = await apiListPolicyAudits({
          limit: 200,
          offset: 0,
          sort: "changed_at",
          dir: "desc",
        })

        if (!alive) return
        setItems(res.items ?? [])
      } catch (e: any) {
        if (!alive) return
        setError(e?.message ?? "Failed to load audit logs")
      } finally {
        if (!alive) return
        setLoading(false)
      }
    }

    load()

    return () => {
      alive = false
    }
  }, [])

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
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading policy audit history..." : "Policy change history"}
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Card className="border shadow-sm overflow-hidden">
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
            {loading ? (
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
              items.map((audit) => (
                <TableRow key={audit.audit_id} className="text-xs">
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {fmt(audit.changed_at)}
                  </TableCell>

                  <TableCell>
                    <span
                      className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                        actionColors[audit.action] || ""
                      }`}
                    >
                      {audit.action}
                    </span>
                  </TableCell>

                  <TableCell>
                    <Link
                      href={`/policies/${audit.policy_id}`}
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
                        href={`/incidents/${audit.source_review_id}`}
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
              ))
            )}
          </TableBody>
        </Table>
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
                      actionColors[selectedAudit.action] || ""
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
                    href={`/incidents/${selectedAudit.source_review_id}`}
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
