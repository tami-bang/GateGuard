"use client"

import { useMemo } from "react"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusChip } from "@/components/status-chip"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { mockReviewEvents } from "@/lib/mock-data"

export default function IncidentsPage() {
  const grouped = useMemo(() => ({
    OPEN: mockReviewEvents.filter(r => r.status === "OPEN"),
    IN_PROGRESS: mockReviewEvents.filter(r => r.status === "IN_PROGRESS"),
    CLOSED: mockReviewEvents.filter(r => r.status === "CLOSED"),
  }), [])

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Incidents</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-xl font-semibold text-foreground">Incidents (Review Queue)</h1>
        <p className="text-sm text-muted-foreground">{mockReviewEvents.length} total incidents</p>
      </div>

      <Tabs defaultValue="OPEN">
        <TabsList>
          <TabsTrigger value="OPEN" className="gap-1.5 text-xs">
            Open <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{grouped.OPEN.length}</span>
          </TabsTrigger>
          <TabsTrigger value="IN_PROGRESS" className="gap-1.5 text-xs">
            In Progress <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">{grouped.IN_PROGRESS.length}</span>
          </TabsTrigger>
          <TabsTrigger value="CLOSED" className="gap-1.5 text-xs">
            Closed <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{grouped.CLOSED.length}</span>
          </TabsTrigger>
        </TabsList>

        {(["OPEN", "IN_PROGRESS", "CLOSED"] as const).map(status => (
          <TabsContent key={status} value={status}>
            <Card className="border shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-[11px]">Created</TableHead>
                    <TableHead className="text-[11px]">Host</TableHead>
                    <TableHead className="text-[11px]">Path</TableHead>
                    <TableHead className="text-[11px]">Decision</TableHead>
                    <TableHead className="text-[11px]">AI Score</TableHead>
                    <TableHead className="text-[11px]">Status</TableHead>
                    <TableHead className="text-[11px]">Reviewer</TableHead>
                    <TableHead className="text-[11px]">Proposed</TableHead>
                    <TableHead className="text-[11px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped[status].length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                        No incidents with status {status.replace("_", " ")}
                      </TableCell>
                    </TableRow>
                  ) : grouped[status].map(rev => (
                    <TableRow key={rev.review_id} className="text-xs">
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {new Date(rev.created_at).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="font-medium text-foreground max-w-[140px] truncate">{rev.host}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[100px] truncate">{rev.path}</TableCell>
                      <TableCell><StatusChip value={rev.decision} /></TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {rev.ai_score !== null ? (
                          <span className={rev.ai_score >= 0.7 ? "text-red-600 font-semibold" : "text-amber-600"}>{rev.ai_score.toFixed(2)}</span>
                        ) : "\u2014"}
                      </TableCell>
                      <TableCell><StatusChip value={rev.status} type="review" /></TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">{rev.reviewer_name || "\u2014"}</TableCell>
                      <TableCell className="text-[11px] font-medium">{rev.proposed_action}</TableCell>
                      <TableCell>
                        <Link href={`/incidents/${rev.review_id}`}>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-primary">Detail</Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
