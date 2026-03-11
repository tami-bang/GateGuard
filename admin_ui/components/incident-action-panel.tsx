"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { StatusChip } from "@/components/status-chip"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"

import {
  apiCreateIncident,
  apiCreatePolicyFromIncident,
  apiGetIncidentByLog,
  apiPatchIncident,
  type ReviewEvent,
  type ReviewStatus,
} from "@/lib/api-client"

import { FilePlus2, FolderPlus, ArrowUpRight, CheckCircle2, Clock3 } from "lucide-react"

/*
패널 상단 상태 영역 스타일
*/
function getPanelTone(status: string): string {
  const v = String(status || "").toUpperCase()

  if (v === "OPEN") {
    return "border-amber-200 bg-amber-50/50"
  }

  if (v === "IN_PROGRESS") {
    return "border-blue-200 bg-blue-50/50"
  }

  if (v === "CLOSED") {
    return "border-slate-200 bg-slate-50"
  }

  return "border-slate-200 bg-slate-50"
}

export function IncidentActionPanel({ logId }: { logId: number }) {
  const { toast } = useToast()

  const [loading, setLoading] = useState(false)
  const [incident, setIncident] = useState<ReviewEvent | null>(null)

  const reviewId = incident?.review_id ?? null
  const status = (incident?.status ?? "NONE") as ReviewStatus
  const generatedPolicyId = incident?.generated_policy_id ?? null

  /*
  정책 생성 가능 여부
  - incident 존재
  - OPEN 또는 IN_PROGRESS
  - 아직 정책 미생성
  */
  const canCreatePolicy = useMemo(() => {
    if (!incident) return false
    if (incident.status !== "OPEN" && incident.status !== "IN_PROGRESS") return false
    if (incident.generated_policy_id) return false
    return true
  }, [incident])

  /*
  incident 상태 새로고침
  */
  async function refresh() {
    try {
      const res = await apiGetIncidentByLog(logId)
      setIncident(res.review_event ?? null)
    } catch {
      // by-log 조회가 실패해도 상세 화면 자체는 계속 볼 수 있게 조용히 처리
      setIncident(null)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logId])

  /*
  incident 생성
  */
  async function onCreateIncident() {
    setLoading(true)
    try {
      const res = await apiCreateIncident({
        log_id: logId,
        proposed_action: "CREATE_POLICY",
        note: "Created from Log Detail",
      })

      setIncident(res.review_event)

      toast({
        title: "Incident created",
        description: `review_id=${res.review_event.review_id}`,
      })
    } catch (e: any) {
      toast({
        title: "Create failed",
        description: String(e?.message ?? e),
      })
    } finally {
      setLoading(false)
    }
  }

  /*
  incident 상태 변경
  */
  async function onSetStatus(next: ReviewStatus) {
    if (!reviewId) return

    setLoading(true)
    try {
      const res = await apiPatchIncident(reviewId, { status: next })
      setIncident(res.review_event)

      toast({
        title: "Status updated",
        description: `status=${res.review_event.status}`,
      })
    } catch (e: any) {
      toast({
        title: "Update failed",
        description: String(e?.message ?? e),
      })
    } finally {
      setLoading(false)
    }
  }

  /*
  정책 생성
  */
  async function onCreatePolicy() {
    if (!reviewId) return

    setLoading(true)
    try {
      const res = await apiCreatePolicyFromIncident(reviewId, {})
      setIncident(res.review_event)

      toast({
        title: "Policy created",
        description: `policy_id=${res.policy_id}`,
      })
    } catch (e: any) {
      toast({
        title: "Create policy failed",
        description: String(e?.message ?? e),
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 상태 영역 */}
      <div
        className={cn(
          "flex flex-col gap-3 rounded-xl border px-4 py-3 transition-colors",
          getPanelTone(String(status))
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {incident ? (
              <>
                <StatusChip value={incident.status} type="review" size="sm" />

                {incident.proposed_action ? (
                  <span className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                    {String(incident.proposed_action).replace(/_/g, " ")}
                  </span>
                ) : null}

                {generatedPolicyId ? (
                  <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                    POLICY LINKED
                  </span>
                ) : null}
              </>
            ) : (
              <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                INCIDENT NONE
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            {incident ? (
              <Link
                href={`/incidents/${incident.review_id}`}
                className="inline-flex items-center gap-1 text-[#1E3A8A] transition-colors hover:text-[#2563EB] hover:underline"
              >
                <ArrowUpRight className="size-3.5" />
                Open Incident
              </Link>
            ) : null}

            {generatedPolicyId ? (
              <Link
                href={`/policies/${generatedPolicyId}`}
                className="inline-flex items-center gap-1 text-[#1E3A8A] transition-colors hover:text-[#2563EB] hover:underline"
              >
                <ArrowUpRight className="size-3.5" />
                Policy #{generatedPolicyId}
              </Link>
            ) : null}
          </div>
        </div>

        {/* 상태 설명 */}
        <div className="text-xs text-[#6B7280]">
          {!incident
            ? "No review event exists for this log yet."
            : incident.status === "OPEN"
            ? "This incident is waiting for analyst action."
            : incident.status === "IN_PROGRESS"
            ? "This incident is currently under review."
            : "This incident has been closed."}
        </div>
      </div>

      {/* 액션 버튼 영역 */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!incident ? (
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onCreateIncident}
            disabled={loading}
          >
            <FilePlus2 className="size-3.5" />
            Create Incident
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => onSetStatus("IN_PROGRESS")}
              disabled={loading || incident.status !== "OPEN"}
            >
              <Clock3 className="size-3.5" />
              Set In Progress
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={onCreatePolicy}
              disabled={loading || !canCreatePolicy}
            >
              <FolderPlus className="size-3.5" />
              Create Policy
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => onSetStatus("CLOSED")}
              disabled={loading || incident.status === "CLOSED"}
            >
              <CheckCircle2 className="size-3.5" />
              Close
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
