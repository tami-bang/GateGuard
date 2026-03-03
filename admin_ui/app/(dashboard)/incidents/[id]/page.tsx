"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { StatusChip } from "@/components/status-chip"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react"

import {
  apiGetIncident,
  apiPatchIncident,
  type IncidentDetailResponse,
  type ReviewStatus,
} from "@/lib/api-client"

function fmt(ts: string | null | undefined): string {
  if (!ts) return "N/A"
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString()
}

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const reviewId = Number(params?.id)

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [data, setData] = useState<IncidentDetailResponse | null>(null)

  const [note, setNote] = useState("")
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    let alive = true
    async function run() {
      if (!Number.isFinite(reviewId)) {
        setErr("Invalid incident id")
        setLoading(false)
        return
      }
      setLoading(true)
      setErr(null)
      try {
        const d = await apiGetIncident(reviewId)
        if (!alive) return
        setData(d)
        setNote(d?.review_event?.note ?? "")
      } catch (e: any) {
        if (!alive) return
        setErr(e?.message ?? "Failed to load incident")
      } finally {
        if (!alive) return
        setLoading(false)
      }
    }
    run()
    return () => {
      alive = false
    }
  }, [reviewId])

  const review = data?.review_event ?? null
  const log = data?.log ?? null

  const status: ReviewStatus | null = review?.status ?? null
  const generatedPolicyId = review?.generated_policy_id ?? null

  const canSetInProgress = status === "OPEN"
  const canClose = status === "OPEN" || status === "IN_PROGRESS"

  async function patchStatus(next: ReviewStatus) {
    if (!review) return
    setErr(null)
    try {
      await apiPatchIncident(review.review_id, { status: next })
      const refreshed = await apiGetIncident(review.review_id)
      setData(refreshed)
      setNote(refreshed.review_event.note ?? "")
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update incident")
    }
  }

  async function saveNote() {
    if (!review) return
    setSavingNote(true)
    setErr(null)
    try {
      await apiPatchIncident(review.review_id, { note })
      const refreshed = await apiGetIncident(review.review_id)
      setData(refreshed)
      setNote(refreshed.review_event.note ?? "")
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save note")
    } finally {
      setSavingNote(false)
    }
  }

  const headerRight = useMemo(() => {
    if (!review) return null
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[11px]">
          Incident #{review.review_id}
        </Badge>

        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => patchStatus("IN_PROGRESS")}
          disabled={!canSetInProgress}
        >
          Set In Progress
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => patchStatus("CLOSED")}
          disabled={!canClose}
        >
          Close
        </Button>

        {generatedPolicyId ? (
          <Link href={`/policies/${generatedPolicyId}`}>
            <Button size="sm" className="h-8 text-xs">
              Policy #{generatedPolicyId} <ExternalLink className="ml-1 size-3" />
            </Button>
          </Link>
        ) : null}
      </div>
    )
  }, [review, canSetInProgress, canClose, generatedPolicyId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading incident...
      </div>
    )
  }

  if (err || !review) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">{err ?? "Incident not found"}</p>
        <div className="flex gap-2">
          <Link href="/incidents">
            <Button variant="outline" size="sm">Back to Incidents</Button>
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
          <BreadcrumbItem><BreadcrumbLink href="/incidents">Incidents</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{review.review_id}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/incidents">
            <Button variant="ghost" size="sm" className="h-8 px-2">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">Incident Detail</h1>
              <StatusChip value={review.status} type="review" />
            </div>
            <p className="font-mono text-xs text-muted-foreground">{review.review_id}</p>
          </div>
        </div>
        {headerRight}
      </div>

      {err ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {err}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Incident Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Created</dt>
                  <dd className="mt-0.5 text-xs text-foreground">{fmt(review.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Reviewed At</dt>
                  <dd className="mt-0.5 text-xs text-foreground">{fmt(review.reviewed_at)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Proposed Action</dt>
                  <dd className="mt-0.5 text-xs font-medium text-foreground">{review.proposed_action ?? "N/A"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Reviewer</dt>
                  <dd className="mt-0.5 text-xs text-foreground">{review.reviewer_id ?? "Unassigned"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Log ID</dt>
                  <dd className="mt-0.5">
                    <Link
                      href={`/logs/${review.log_id}`}
                      className="text-xs font-mono text-primary hover:underline inline-flex items-center gap-1"
                    >
                      {review.log_id} <ExternalLink className="size-3" />
                    </Link>
                  </dd>
                </div>
                {review.generated_policy_id ? (
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Generated Policy</dt>
                    <dd className="mt-0.5">
                      <Link
                        href={`/policies/${review.generated_policy_id}`}
                        className="text-xs font-mono text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {review.generated_policy_id} <ExternalLink className="size-3" />
                      </Link>
                    </dd>
                  </div>
                ) : null}
              </dl>

              {review.note ? (
                <div className="mt-4 rounded-md bg-muted p-3">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Note</p>
                  <p className="text-xs text-foreground">{review.note}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Linked Log Summary</CardTitle>
            </CardHeader>
            <CardContent>
              {log ? (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Host</dt>
                    <dd className="mt-0.5 text-xs font-mono text-foreground">{log.host ?? "N/A"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Path</dt>
                    <dd className="mt-0.5 text-xs font-mono text-foreground">{log.path ?? "N/A"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Decision</dt>
                    <dd className="mt-0.5"><StatusChip value={log.decision} /></dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Stage</dt>
                    <dd className="mt-0.5"><StatusChip value={log.decision_stage} type="stage" /></dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">No linked log payload from backend</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
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
              <Button size="sm" className="h-8 text-xs" disabled={savingNote || !note.trim()} onClick={saveNote}>
                {savingNote ? "Saving..." : "Save Note"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
