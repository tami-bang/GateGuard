"use client"

import { use, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { StatusChip } from "@/components/status-chip"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { ArrowLeft, UserCheck, Play, CheckCircle, FileText, ExternalLink } from "lucide-react"
import { mockReviewEvents, mockAccessLogs, mockAIAnalyses, mockPolicyAudits } from "@/lib/mock-data"

export default function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [note, setNote] = useState("")

  const incident = useMemo(() => mockReviewEvents.find(r => r.review_id === id), [id])
  const log = useMemo(() => incident ? mockAccessLogs.find(l => l.log_id === incident.log_id) : null, [incident])
  const aiAnalysis = useMemo(() => incident ? mockAIAnalyses.find(a => a.log_id === incident.log_id) : null, [incident])
  const relatedAudit = useMemo(() => incident?.generated_policy_id ? mockPolicyAudits.find(a => a.source_review_id === incident.review_id) : null, [incident])

  if (!incident) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">Incident not found</p>
        <Link href="/incidents"><Button variant="outline" size="sm">Back to Incidents</Button></Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink href="/incidents">Incidents</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{id}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/incidents">
            <Button variant="ghost" size="sm" className="h-8 px-2"><ArrowLeft className="size-4" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">Incident Detail</h1>
              <StatusChip value={incident.status} type="review" />
            </div>
            <p className="font-mono text-xs text-muted-foreground">{id}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column: info */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* Incident Summary */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Incident Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Created</dt>
                  <dd className="mt-0.5 text-xs text-foreground">{new Date(incident.created_at).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Host</dt>
                  <dd className="mt-0.5 text-xs font-mono text-foreground">{incident.host}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Path</dt>
                  <dd className="mt-0.5 text-xs font-mono text-foreground">{incident.path}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Decision</dt>
                  <dd className="mt-0.5"><StatusChip value={incident.decision} /></dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">AI Score</dt>
                  <dd className="mt-0.5 text-xs font-mono font-semibold text-red-600">{incident.ai_score?.toFixed(2) || "\u2014"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Proposed Action</dt>
                  <dd className="mt-0.5 text-xs font-medium text-foreground">{incident.proposed_action}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Reviewer</dt>
                  <dd className="mt-0.5 text-xs text-foreground">{incident.reviewer_name || "Unassigned"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Log ID</dt>
                  <dd className="mt-0.5">
                    <Link href={`/logs/${incident.log_id}`} className="text-xs font-mono text-primary hover:underline flex items-center gap-1">
                      {incident.log_id} <ExternalLink className="size-3" />
                    </Link>
                  </dd>
                </div>
                {incident.generated_policy_id && (
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Generated Policy</dt>
                    <dd className="mt-0.5">
                      <Link href={`/policies/${incident.generated_policy_id}`} className="text-xs font-mono text-primary hover:underline flex items-center gap-1">
                        {incident.generated_policy_id} <ExternalLink className="size-3" />
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
              {incident.note && (
                <div className="mt-4 rounded-md bg-muted p-3">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Note</p>
                  <p className="text-xs text-foreground">{incident.note}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Linked Log Summary */}
          {log && (
            <Card className="border shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-foreground">Linked Log Summary</CardTitle>
                  <Link href={`/logs/${log.log_id}`}>
                    <Badge variant="outline" className="cursor-pointer text-xs gap-1">View Full Log <ExternalLink className="size-3" /></Badge>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Method</dt>
                    <dd className="mt-0.5"><Badge variant="outline" className="text-[11px]">{log.method}</Badge></dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Stage</dt>
                    <dd className="mt-0.5"><StatusChip value={log.decision_stage} type="stage" /></dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Engine Latency</dt>
                    <dd className="mt-0.5 text-xs font-mono">{log.engine_latency_ms}ms</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Inject Status</dt>
                    <dd className="mt-0.5 text-xs font-mono">{log.inject_status_code || "N/A"}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          )}

          {/* Audit Trail */}
          {relatedAudit && (
            <Card className="border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground">Audit Trail</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border p-3 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px]">{relatedAudit.action}</Badge>
                    <span className="text-muted-foreground">{new Date(relatedAudit.changed_at).toLocaleString()}</span>
                  </div>
                  <p className="text-foreground">{relatedAudit.change_note}</p>
                  <Link href="/audit-log" className="mt-2 inline-flex items-center gap-1 text-primary hover:underline text-[11px]">
                    View in Audit Log <ExternalLink className="size-3" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: Actions */}
        <div className="flex flex-col gap-4">
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button size="sm" className="h-8 w-full justify-start gap-2 text-xs" variant="outline">
                <UserCheck className="size-3.5" /> Take Ownership
              </Button>
              <Button size="sm" className="h-8 w-full justify-start gap-2 text-xs" variant="outline">
                <Play className="size-3.5" /> Mark In Progress
              </Button>
              <Button size="sm" className="h-8 w-full justify-start gap-2 text-xs" variant="outline">
                <CheckCircle className="size-3.5" /> Close Incident
              </Button>
              <Link href={`/policies/new?from_incident=${incident.review_id}`} className="w-full">
                <Button size="sm" className="h-8 w-full justify-start gap-2 text-xs">
                  <FileText className="size-3.5" /> Generate Policy
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Add Note</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Textarea
                placeholder="Add investigation notes..."
                value={note}
                onChange={e => setNote(e.target.value)}
                className="min-h-[80px] text-xs resize-none"
              />
              <Button size="sm" className="h-8 text-xs" disabled={!note.trim()}>
                Save Note
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
