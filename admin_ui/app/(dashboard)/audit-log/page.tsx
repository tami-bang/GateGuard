"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { ExternalLink } from "lucide-react"
import { mockPolicyAudits } from "@/lib/mock-data"
import type { PolicyAudit } from "@/lib/mock-data"

const actionColors: Record<string, string> = {
  CREATE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UPDATE: "bg-blue-50 text-blue-700 border-blue-200",
  DELETE: "bg-red-50 text-red-700 border-red-200",
}

export default function AuditLogPage() {
  const [selectedAudit, setSelectedAudit] = useState<PolicyAudit | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Audit Log</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-xl font-semibold text-foreground">Audit Log</h1>
        <p className="text-sm text-muted-foreground">Policy change history</p>
      </div>

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
            {mockPolicyAudits.map(audit => (
              <TableRow key={audit.audit_id} className="text-xs">
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {new Date(audit.changed_at).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold ${actionColors[audit.action] || ""}`}>
                    {audit.action}
                  </span>
                </TableCell>
                <TableCell>
                  <Link href={`/policies/${audit.policy_id}`} className="text-primary hover:underline font-mono text-[11px] flex items-center gap-1">
                    {audit.policy_name} <ExternalLink className="size-3" />
                  </Link>
                </TableCell>
                <TableCell className="text-[11px] text-foreground">{audit.changed_by}</TableCell>
                <TableCell>
                  {audit.source_review_id ? (
                    <Link href={`/incidents/${audit.source_review_id}`} className="text-primary hover:underline font-mono text-[11px]">
                      {audit.source_review_id}
                    </Link>
                  ) : <span className="text-muted-foreground">{"\u2014"}</span>}
                </TableCell>
                <TableCell className="max-w-[250px] truncate text-[11px] text-muted-foreground">{audit.change_note}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-primary" onClick={() => setSelectedAudit(audit)}>
                    View Diff
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Detail Drawer */}
      <Sheet open={!!selectedAudit} onOpenChange={() => setSelectedAudit(null)}>
        <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-foreground">Audit Detail</SheetTitle>
            <SheetDescription>
              {selectedAudit && `${selectedAudit.action} on ${selectedAudit.policy_name}`}
            </SheetDescription>
          </SheetHeader>
          {selectedAudit && (
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold ${actionColors[selectedAudit.action] || ""}`}>
                    {selectedAudit.action}
                  </span>
                  <span className="text-xs text-muted-foreground">by {selectedAudit.changed_by}</span>
                </div>
                <p className="text-xs text-muted-foreground">{new Date(selectedAudit.changed_at).toLocaleString()}</p>
                <p className="text-xs text-foreground">{selectedAudit.change_note}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Before</h4>
                  <pre className="rounded-md bg-red-50 border border-red-200 p-3 text-[11px] font-mono text-foreground overflow-auto max-h-[300px]">
                    {selectedAudit.before_snapshot ? JSON.stringify(selectedAudit.before_snapshot, null, 2) : "null (new record)"}
                  </pre>
                </div>
                <div>
                  <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">After</h4>
                  <pre className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-[11px] font-mono text-foreground overflow-auto max-h-[300px]">
                    {selectedAudit.after_snapshot ? JSON.stringify(selectedAudit.after_snapshot, null, 2) : "null (deleted)"}
                  </pre>
                </div>
              </div>

              {selectedAudit.source_review_id && (
                <div className="rounded-md border p-3">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Source Incident</p>
                  <Link href={`/incidents/${selectedAudit.source_review_id}`} className="text-xs text-primary hover:underline flex items-center gap-1">
                    {selectedAudit.source_review_id} <ExternalLink className="size-3" />
                  </Link>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
