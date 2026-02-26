"use client"

import { use, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusChip } from "@/components/status-chip"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { ShieldAlert, FileText, Copy, Check, ArrowLeft, ExternalLink } from "lucide-react"
import { mockAccessLogs, mockAIAnalyses, mockReviewEvents } from "@/lib/mock-data"

export default function LogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [copied, setCopied] = useState(false)

  const log = useMemo(() => mockAccessLogs.find(l => l.log_id === id), [id])
  const aiAnalyses = useMemo(() => mockAIAnalyses.filter(a => a.log_id === id).sort((a, b) => b.analysis_seq - a.analysis_seq), [id])
  const latestAI = aiAnalyses[0] || null
  const relatedIncident = useMemo(() => mockReviewEvents.find(r => r.log_id === id), [id])

  if (!log) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">Log entry not found</p>
        <Link href="/logs"><Button variant="outline" size="sm">Back to Logs</Button></Link>
      </div>
    )
  }

  function copySlackMessage() {
    const msg = [
      `*GateGuard Alert*`,
      `Host: \`${log!.host}\``,
      `Path: \`${log!.path}\``,
      `Decision: ${log!.decision}`,
      latestAI ? `AI Score: ${latestAI.score.toFixed(2)}` : "",
      `Link: ${window.location.origin}/logs/${log!.log_id}`,
    ].filter(Boolean).join("\n")
    navigator.clipboard.writeText(msg)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink href="/logs">Logs</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{id}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/logs">
            <Button variant="ghost" size="sm" className="h-8 px-2">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Log Detail</h1>
            <p className="font-mono text-xs text-muted-foreground">{id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/incidents?create=${log.log_id}`}>
            <Button size="sm" className="h-8 gap-1.5 text-xs">
              <ShieldAlert className="size-3.5" /> Create Incident
            </Button>
          </Link>
          <Link href={`/policies/new?from_log=${log.log_id}`}>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <FileText className="size-3.5" /> Create Policy
            </Button>
          </Link>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={copySlackMessage}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy Slack Message"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Request Summary */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Request Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <DetailRow label="Host" value={log.host} mono />
              <DetailRow label="Path" value={log.path} mono />
              <DetailRow label="Method"><Badge variant="outline" className="text-[11px]">{log.method}</Badge></DetailRow>
              <DetailRow label="Timestamp" value={new Date(log.detect_timestamp).toLocaleString()} />
              <DetailRow label="Client IP" value={`${log.client_ip}:${log.client_port}`} mono />
              <DetailRow label="Server" value={`${log.server_ip}:${log.server_port}`} mono />
              <DetailRow label="Request ID" value={log.request_id} mono />
              <DetailRow label="URL Normalized" value={log.url_norm} mono />
              <div className="col-span-2">
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">User Agent</dt>
                <dd className="mt-0.5 text-xs font-mono text-foreground break-all">{log.user_agent}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Decision Summary */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Decision Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <DetailRow label="Decision"><StatusChip value={log.decision} /></DetailRow>
              <DetailRow label="Decision Stage"><StatusChip value={log.decision_stage} type="stage" /></DetailRow>
              <DetailRow label="Reason" value={log.reason} />
              <DetailRow label="Matched Policy">
                {log.policy_id ? (
                  <Link href={`/policies/${log.policy_id}`} className="text-primary hover:underline text-xs font-mono">{log.policy_id}</Link>
                ) : <span className="text-muted-foreground text-xs">N/A</span>}
              </DetailRow>
              <DetailRow label="Engine Latency" value={`${log.engine_latency_ms}ms`} mono />
            </dl>
          </CardContent>
        </Card>

        {/* AI Analysis - Latest */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">AI Analysis (Latest)</CardTitle>
          </CardHeader>
          <CardContent>
            {latestAI ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <DetailRow label="Score">
                  <span className={`font-mono font-semibold ${latestAI.score >= 0.7 ? "text-red-600" : latestAI.score >= 0.5 ? "text-amber-600" : "text-emerald-600"}`}>
                    {latestAI.score.toFixed(3)}
                  </span>
                </DetailRow>
                <DetailRow label="Label"><StatusChip value={latestAI.label} type="aiLabel" /></DetailRow>
                <DetailRow label="Latency" value={`${latestAI.latency_ms}ms`} mono />
                <DetailRow label="Model Version" value={latestAI.model_version} mono />
                <DetailRow label="Error Code" value={latestAI.error_code || "None"} />
                <DetailRow label="Analysis Seq" value={String(latestAI.analysis_seq)} />
                <div className="col-span-2">
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">AI Response</dt>
                  <dd className="rounded-md bg-muted p-3 text-xs text-foreground leading-relaxed">{latestAI.ai_response}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No AI analysis for this request</p>
            )}
          </CardContent>
        </Card>

        {/* Injection / Reply Status */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Injection / Reply Status</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <DetailRow label="Inject Attempted">
                <Badge variant={log.inject_attempted ? "destructive" : "secondary"} className="text-[11px]">
                  {log.inject_attempted ? "Yes" : "No"}
                </Badge>
              </DetailRow>
              <DetailRow label="Inject Sent">
                <Badge variant={log.inject_send ? "destructive" : "secondary"} className="text-[11px]">
                  {log.inject_send ? "Yes" : "No"}
                </Badge>
              </DetailRow>
              <DetailRow label="Inject Errno" value={log.inject_errno !== null ? `${log.inject_errno}` : "None"} mono />
              <DetailRow label="Inject Latency" value={log.inject_latency_ms !== null ? `${log.inject_latency_ms}ms` : "N/A"} mono />
              <DetailRow label="Inject Status Code">
                {log.inject_status_code ? (
                  <Badge variant="outline" className="font-mono text-[11px]">{log.inject_status_code}</Badge>
                ) : <span className="text-muted-foreground text-xs">N/A</span>}
              </DetailRow>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* AI Analysis History (if multiple) */}
      {aiAnalyses.length > 1 && (
        <Card className="border shadow-sm overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">AI Analysis History ({aiAnalyses.length} runs)</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-[11px]">Seq</TableHead>
                <TableHead className="text-[11px]">Analyzed At</TableHead>
                <TableHead className="text-[11px]">Score</TableHead>
                <TableHead className="text-[11px]">Label</TableHead>
                <TableHead className="text-[11px]">Latency</TableHead>
                <TableHead className="text-[11px]">Model</TableHead>
                <TableHead className="text-[11px]">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aiAnalyses.map(a => (
                <TableRow key={a.ai_analysis_id} className="text-xs">
                  <TableCell className="font-mono text-[11px]">{a.analysis_seq}</TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {new Date(a.analyzed_at).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </TableCell>
                  <TableCell>
                    <span className={`font-mono font-semibold ${a.score >= 0.7 ? "text-red-600" : a.score >= 0.5 ? "text-amber-600" : "text-emerald-600"}`}>
                      {a.score.toFixed(3)}
                    </span>
                  </TableCell>
                  <TableCell><StatusChip value={a.label} type="aiLabel" /></TableCell>
                  <TableCell className="font-mono text-[11px]">{a.latency_ms}ms</TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{a.model_version}</TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{a.error_code || "\u2014"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Related Incident */}
      {relatedIncident && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Related Incident</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <StatusChip value={relatedIncident.status} type="review" />
                <span className="text-xs text-foreground">{relatedIncident.review_id}</span>
                <span className="text-xs text-muted-foreground">Proposed: {relatedIncident.proposed_action}</span>
              </div>
              <Link href={`/incidents/${relatedIncident.review_id}`}>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                  View Incident <ExternalLink className="size-3" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function DetailRow({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</dt>
      <dd className={`mt-0.5 text-xs text-foreground ${mono ? "font-mono" : ""}`}>
        {children || value || ""}
      </dd>
    </div>
  )
}
