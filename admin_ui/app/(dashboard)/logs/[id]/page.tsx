import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusChip } from "@/components/status-chip"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { ShieldAlert, FileText, ArrowLeft, ExternalLink } from "lucide-react"

import { apiGetLogDetail, type AIAnalysisItem } from "@/lib/api-client"

type LogDetailPageProps = { params: { id: string } }

export default async function LogDetailPage({ params }: LogDetailPageProps) {
  const logId = Number(params.id)
  if (!Number.isFinite(logId)) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">Invalid log id</p>
        <Link href="/logs">
          <Button variant="outline" size="sm">
            Back to Logs
          </Button>
        </Link>
      </div>
    )
  }

  // 통합본 패턴 (요구한 그대로)
  let data: Awaited<ReturnType<typeof apiGetLogDetail>> | null = null
  try {
    data = await apiGetLogDetail(logId)
  } catch {
    data = null
  }

  const log = data?.log ?? null
  const analyses: AIAnalysisItem[] = data?.analyses ?? []

  const aiAnalyses = [...analyses].sort((a, b) => (b.analysis_seq ?? 0) - (a.analysis_seq ?? 0))
  const latestAI = aiAnalyses[0] ?? null

  if (!log) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">Log entry not found</p>
        <Link href="/logs">
          <Button variant="outline" size="sm">
            Back to Logs
          </Button>
        </Link>
      </div>
    )
  }

  const injectAttempted = Number(log.inject_attempted ?? 0) > 0
  const injectSent = Number(log.inject_send ?? 0) > 0

  const clientAddr =
    log.client_ip && log.client_port ? `${log.client_ip}:${log.client_port}` : log.client_ip || "N/A"
  const serverAddr =
    log.server_ip && log.server_port ? `${log.server_ip}:${log.server_port}` : log.server_ip || "N/A"

  // View API 버튼에서 127.0.0.1 뜨는 문제 방지 (VM 기준 fallback)
  const apiBase = (process.env.NEXT_PUBLIC_FASTAPI_BASE_URL || "http://192.168.1.24:8000").replace(/\/+$/, "")

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/logs">Logs</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{String(logId)}</BreadcrumbPage>
          </BreadcrumbItem>
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
            <p className="font-mono text-xs text-muted-foreground">{String(log.request_id || logId)}</p>
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

          <a href={`${apiBase}/v1/logs/${log.log_id}`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              View API <ExternalLink className="size-3.5" />
            </Button>
          </a>
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
              <DetailRow label="Host" value={log.host || "N/A"} mono />
              <DetailRow label="Path" value={log.path || "N/A"} mono />
              <DetailRow label="Method">
                <Badge variant="outline" className="text-[11px]">
                  {log.method || "N/A"}
                </Badge>
              </DetailRow>
              <DetailRow
                label="Timestamp"
                value={log.detect_timestamp ? new Date(log.detect_timestamp).toLocaleString() : "N/A"}
              />
              <DetailRow label="Client" value={clientAddr} mono />
              <DetailRow label="Server" value={serverAddr} mono />
              <DetailRow label="Request ID" value={log.request_id || "N/A"} mono />
              <DetailRow label="URL Normalized" value={log.url_norm || "N/A"} mono />
              <div className="col-span-2">
                <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">User Agent</dt>
                <dd className="mt-0.5 text-xs font-mono text-foreground break-all">{log.user_agent || "N/A"}</dd>
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
              <DetailRow label="Decision">
                <StatusChip value={String(log.decision || "ERROR")} />
              </DetailRow>
              <DetailRow label="Decision Stage">
                <StatusChip value={String(log.decision_stage || "FAIL_STAGE")} type="stage" />
              </DetailRow>

              <DetailRow label="Reason">
                <StatusChip value={String(log.reason || "")} type="reason" />
              </DetailRow>

              <DetailRow label="Matched Policy">
                {log.policy_id ? (
                  <Link href={`/policies/${log.policy_id}`} className="text-primary hover:underline text-xs font-mono">
                    {String(log.policy_id)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground text-xs">N/A</span>
                )}
              </DetailRow>
              <DetailRow
                label="Engine Latency"
                value={
                  log.engine_latency_ms !== null && log.engine_latency_ms !== undefined
                    ? `${log.engine_latency_ms}ms`
                    : "N/A"
                }
                mono
              />
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
                  <span className="font-mono font-semibold">
                    {latestAI.score === null || latestAI.score === undefined ? "N/A" : Number(latestAI.score).toFixed(3)}
                  </span>
                </DetailRow>
                <DetailRow label="Label">
                  <StatusChip value={String(latestAI.label || "UNKNOWN")} type="aiLabel" />
                </DetailRow>
                <DetailRow
                  label="Latency"
                  value={latestAI.latency_ms !== null && latestAI.latency_ms !== undefined ? `${latestAI.latency_ms}ms` : "N/A"}
                  mono
                />
                <DetailRow label="Model Version" value={latestAI.model_version || "N/A"} mono />
                <DetailRow label="Error Code" value={latestAI.error_code || "None"} />
                <DetailRow label="Analysis Seq" value={String(latestAI.analysis_seq ?? 0)} />
                <div className="col-span-2">
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">AI Response</dt>
                  <dd className="rounded-md bg-muted p-3 text-xs text-foreground leading-relaxed break-all">
                    {latestAI.ai_response || "N/A"}
                  </dd>
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
                <Badge variant={injectAttempted ? "destructive" : "secondary"} className="text-[11px]">
                  {injectAttempted ? "Yes" : "No"}
                </Badge>
              </DetailRow>

              <DetailRow label="Inject Sent">
                <Badge variant={injectSent ? "destructive" : "secondary"} className="text-[11px]">
                  {injectSent ? "Yes" : "No"}
                </Badge>
              </DetailRow>

              <DetailRow
                label="Inject Errno"
                value={log.inject_errno !== null && log.inject_errno !== undefined ? String(log.inject_errno) : "None"}
                mono
              />

              <DetailRow
                label="Inject Latency"
                value={log.inject_latency_ms !== null && log.inject_latency_ms !== undefined ? `${log.inject_latency_ms}ms` : "N/A"}
                mono
              />

              <DetailRow label="Inject Status Code">
                {log.inject_status_code ? (
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {String(log.inject_status_code)}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">N/A</span>
                )}
              </DetailRow>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* AI Analysis History */}
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
              {aiAnalyses.map((a) => (
                <TableRow
                  key={`${a.analysis_seq}-${a.analyzed_at ?? ""}`}
                  className="text-xs"
                >
                  <TableCell className="font-mono text-[11px]">{a.analysis_seq}</TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {a.analyzed_at ? new Date(a.analyzed_at).toLocaleString() : "N/A"}
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {a.score === null || a.score === undefined ? "N/A" : Number(a.score).toFixed(3)}
                  </TableCell>
                  <TableCell>
                    <StatusChip value={String(a.label || "UNKNOWN")} type="aiLabel" />
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {a.latency_ms !== null && a.latency_ms !== undefined ? `${a.latency_ms}ms` : "N/A"}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{a.model_version || "N/A"}</TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{a.error_code || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
  children,
}: {
  label: string
  value?: string
  mono?: boolean
  children?: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</dt>
      <dd className={`mt-0.5 ${mono ? "font-mono text-xs" : "text-sm"} text-foreground break-all`}>
        {children ?? value ?? "N/A"}
      </dd>
    </div>
  )
}
