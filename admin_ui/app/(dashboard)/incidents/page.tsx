"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusChip } from "@/components/status-chip"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

import {
  apiListIncidents,
  type ReviewEvent,
} from "@/lib/api-client"

type IncidentStatusTab = "OPEN" | "IN_PROGRESS" | "CLOSED"

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

export default function IncidentsPage() {
  const [items, setItems] = useState<ReviewEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let alive = true

    async function load() {
      try {
        setLoading(true)
        setError("")

        const res = await apiListIncidents({ limit: 200, page: 1 })

        if (!alive) return
        setItems(res.items ?? [])
      } catch (e: any) {
        if (!alive) return
        setError(e?.message ?? "Failed to load incidents")
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

  const grouped = useMemo(
    () => ({
      OPEN: items.filter((r) => r.status === "OPEN"),
      IN_PROGRESS: items.filter((r) => r.status === "IN_PROGRESS"),
      CLOSED: items.filter((r) => r.status === "CLOSED"),
    }),
    [items]
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
            <BreadcrumbPage>Incidents</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-xl font-semibold text-foreground">
          Incidents (Review Queue)
        </h1>
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading incidents..." : `${items.length} total incidents`}
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Tabs defaultValue="OPEN">
        <TabsList>
          <TabsTrigger value="OPEN" className="gap-1.5 text-xs">
            Open{" "}
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              {grouped.OPEN.length}
            </span>
          </TabsTrigger>

          <TabsTrigger value="IN_PROGRESS" className="gap-1.5 text-xs">
            In Progress{" "}
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
              {grouped.IN_PROGRESS.length}
            </span>
          </TabsTrigger>

          <TabsTrigger value="CLOSED" className="gap-1.5 text-xs">
            Closed{" "}
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
              {grouped.CLOSED.length}
            </span>
          </TabsTrigger>
        </TabsList>

        {(["OPEN", "IN_PROGRESS", "CLOSED"] as const).map((status: IncidentStatusTab) => (
          <TabsContent key={status} value={status}>
            <Card className="border shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-[11px]">Created</TableHead>
                    <TableHead className="text-[11px]">Log ID</TableHead>
                    <TableHead className="text-[11px]">Status</TableHead>
                    <TableHead className="text-[11px]">Reviewer</TableHead>
                    <TableHead className="text-[11px]">Proposed</TableHead>
                    <TableHead className="text-[11px]">Generated Policy</TableHead>
                    <TableHead className="text-[11px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                        Loading incidents...
                      </TableCell>
                    </TableRow>
                  ) : grouped[status].length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                        No incidents with status {status.replace("_", " ")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    grouped[status].map((rev) => (
                      <TableRow key={rev.review_id} className="text-xs">
                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                          {fmt(rev.created_at)}
                        </TableCell>

                        <TableCell>
                          <Link
                            href={`/logs/${rev.log_id}`}
                            className="font-mono text-primary hover:underline"
                          >
                            {rev.log_id}
                          </Link>
                        </TableCell>

                        <TableCell>
                          <StatusChip value={rev.status} type="review" />
                        </TableCell>

                        <TableCell className="text-[11px] text-muted-foreground">
                          {rev.reviewer_id ?? "—"}
                        </TableCell>

                        <TableCell className="text-[11px] font-medium">
                          {rev.proposed_action ?? "—"}
                        </TableCell>

                        <TableCell className="text-[11px]">
                          {rev.generated_policy_id ? (
                            <Link
                              href={`/policies/${rev.generated_policy_id}`}
                              className="font-mono text-primary hover:underline"
                            >
                              {rev.generated_policy_id}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>

                        <TableCell>
                          <Link href={`/incidents/${rev.review_id}`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs text-primary"
                            >
                              Detail
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
