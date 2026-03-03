"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"

import {
  apiCreateIncident,
  apiCreatePolicyFromIncident,
  apiGetIncidentByLog,
  apiPatchIncident,
  type ReviewEvent,
  type ReviewStatus,
} from "@/lib/api-client"

function statusBadgeVariant(status: string): "secondary" | "default" | "destructive" {
  if (status === "OPEN") return "destructive"
  if (status === "IN_PROGRESS") return "default"
  return "secondary"
}

export function IncidentActionPanel({ logId }: { logId: number }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [incident, setIncident] = useState<ReviewEvent | null>(null)

  const reviewId = incident?.review_id ?? null
  const status = (incident?.status ?? "NONE") as ReviewStatus
  const generatedPolicyId = incident?.generated_policy_id ?? null

  const canCreatePolicy = useMemo(() => {
    if (!incident) return false
    if (incident.status !== "OPEN" && incident.status !== "IN_PROGRESS") return false
    if (incident.generated_policy_id) return false
    return true
  }, [incident])

  async function refresh() {
    try {
      const res = await apiGetIncidentByLog(logId)
      setIncident(res.review_event ?? null)
    } catch (e: any) {
      // by-log에서 null 반환이 아니라 에러가 날 수도 있으니 UI는 조용히 처리
      setIncident(null)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logId])

  async function onCreateIncident() {
    setLoading(true)
    try {
      const res = await apiCreateIncident({
        log_id: logId,
        proposed_action: "CREATE_POLICY",
        note: "Created from Log Detail",
      })
      setIncident(res.review_event)
      toast({ title: "Incident created", description: `review_id=${res.review_event.review_id}` })
    } catch (e: any) {
      toast({ title: "Create failed", description: String(e?.message ?? e) })
    } finally {
      setLoading(false)
    }
  }

  async function onSetStatus(next: ReviewStatus) {
    if (!reviewId) return
    setLoading(true)
    try {
      const res = await apiPatchIncident(reviewId, { status: next })
      setIncident(res.review_event)
      toast({ title: "Status updated", description: `status=${res.review_event.status}` })
    } catch (e: any) {
      toast({ title: "Update failed", description: String(e?.message ?? e) })
    } finally {
      setLoading(false)
    }
  }

  async function onCreatePolicy() {
    if (!reviewId) return
    setLoading(true)
    try {
      const res = await apiCreatePolicyFromIncident(reviewId, {})
      setIncident(res.review_event)
      toast({ title: "Policy created", description: `policy_id=${res.policy_id}` })
    } catch (e: any) {
      toast({ title: "Create policy failed", description: String(e?.message ?? e) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 items-end">
      <div className="flex items-center gap-2">
        <Badge variant={statusBadgeVariant(String(status))} className="text-[11px]">
          {incident ? `INCIDENT ${incident.status}` : "INCIDENT NONE"}
        </Badge>

        {incident && (
          <Link href={`/incidents/${incident.review_id}`} className="text-xs text-primary hover:underline">
            Open Incident
          </Link>
        )}

        {generatedPolicyId && (
          <Link href={`/policies/${generatedPolicyId}`} className="text-xs text-primary hover:underline">
            Policy #{generatedPolicyId}
          </Link>
        )}
      </div>

      <div className="flex items-center gap-2">
        {!incident ? (
          <Button size="sm" className="h-8 text-xs" onClick={onCreateIncident} disabled={loading}>
            Create Incident
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => onSetStatus("IN_PROGRESS")}
              disabled={loading || incident.status !== "OPEN"}
            >
              Set In Progress
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={onCreatePolicy}
              disabled={loading || !canCreatePolicy}
            >
              Create Policy
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => onSetStatus("CLOSED")}
              disabled={loading || incident.status === "CLOSED"}
            >
              Close
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
