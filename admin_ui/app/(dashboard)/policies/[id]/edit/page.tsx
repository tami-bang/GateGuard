"use client"

import { use, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { ArrowLeft, Info } from "lucide-react"

import {
  apiGetPolicy,
  apiListPolicyRules,
  apiPatchPolicy,
  toBool,
  type Policy,
  type PolicyRule,
} from "@/lib/api-client"

interface RuleForm {
  id: string
  rule_type: string
  match_type: string
  pattern: string
  is_case_sensitive: boolean
  is_negated: boolean
  is_enabled: boolean
  rule_order?: number
}

const matchExamples: Record<string, string> = {
  EXACT: "e.g. malware-cdn.evil.net",
  PREFIX: "e.g. /api/v2/",
  CONTAINS: "e.g. phishing",
  REGEX: "e.g. .*\\.evil\\.(net|com)",
}

function normalizeRule(r: PolicyRule): RuleForm {
  return {
    id: String(r.rule_id),
    rule_type: String(r.rule_type),
    match_type: String(r.match_type),
    pattern: String(r.pattern ?? ""),
    is_case_sensitive: toBool(r.is_case_sensitive),
    is_negated: toBool(r.is_negated),
    is_enabled: r.is_enabled === null ? true : toBool(r.is_enabled),
    rule_order: typeof r.rule_order === "number" ? r.rule_order : undefined,
  }
}

export default function PolicyEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const policyId = useMemo(() => Number(id), [id])
  const router = useRouter()
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [existing, setExisting] = useState<Policy | null>(null)

  const [policy, setPolicy] = useState(() => ({
    policy_name: "",
    policy_type: "BLOCKLIST",
    action: "BLOCK",
    priority: 100,
    is_enabled: true as boolean,
    risk_level: "MEDIUM",
    category: "",
    block_status_code: 403,
    redirect_url: "",
    description: "",
  }))

  const [rules, setRules] = useState<RuleForm[]>([])

  useEffect(() => {
    let alive = true

    async function run() {
      if (!Number.isFinite(policyId) || policyId <= 0) {
        setError("Invalid policy id")
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const polResp = await apiGetPolicy(policyId)
        const pol = polResp?.policy ?? null
        if (!alive) return

        if (!pol) {
          setExisting(null)
          setError("Policy not found")
          return
        }

        setExisting(pol)

        setPolicy({
          policy_name: pol.policy_name ?? "",
          policy_type: String(pol.policy_type ?? "BLOCKLIST"),
          action: String(pol.action ?? "BLOCK"),
          priority: pol.priority ?? 100,
          is_enabled: toBool(pol.is_enabled),
          risk_level: String(pol.risk_level ?? "MEDIUM"),
          category: pol.category ?? "",
          block_status_code: pol.block_status_code ?? 403,
          redirect_url: pol.redirect_url ?? "",
          description: pol.description ?? "",
        })

        const rulesResp = await apiListPolicyRules(policyId)
        const items = Array.isArray(rulesResp?.items) ? rulesResp.items : []
        if (!alive) return

        setRules(items.map(normalizeRule))
      } catch (e: any) {
        if (!alive) return
        setError(e?.message ? String(e.message) : "Failed to load policy")
      } finally {
        if (!alive) return
        setLoading(false)
      }
    }

    run()

    return () => {
      alive = false
    }
  }, [policyId])

  async function saveChanges() {
    if (!existing) return

    const policyName = policy.policy_name.trim()
    if (!policyName) {
      setError("Policy name is required")
      return
    }

    if (!Number.isFinite(policy.priority)) {
      setError("Priority must be a valid number")
      return
    }

    if (!Number.isFinite(policy.block_status_code)) {
      setError("Block status code must be a valid number")
      return
    }

    setSaving(true)
    setError(null)

    try {
      await apiPatchPolicy(policyId, {
        policy_name: policyName,
        policy_type: policy.policy_type,
        action: policy.action,
        priority: policy.priority,
        is_enabled: policy.is_enabled ? 1 : 0,
        risk_level: policy.risk_level,
        category: policy.category.trim() || null,
        block_status_code: policy.block_status_code,
        redirect_url: policy.redirect_url.trim() || null,
        description: policy.description.trim() || null,
      })

      toast({
        title: "Policy updated",
        description: `Policy #${policyId} changes have been saved.`,
      })

      router.push(`/policies/${policyId}`)
      router.refresh()
    } catch (e: any) {
      const message = e?.message ? String(e.message) : "Save failed"
      setError(message)
      toast({
        title: "Update failed",
        description: message,
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (error && !existing) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">{error}</p>
        <Link href="/policies">
          <Button variant="outline" size="sm">
            Back to Policies
          </Button>
        </Link>
      </div>
    )
  }

  if (!existing) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">Policy not found</p>
        <Link href="/policies">
          <Button variant="outline" size="sm">
            Back to Policies
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/policies">Policies</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href={`/policies/${id}`}>{existing.policy_name}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Edit</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/policies/${id}`}>
            <Button variant="ghost" size="sm" className="h-8 px-2">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>

          <h1 className="text-xl font-semibold text-foreground">Edit Policy</h1>
          <Badge variant="outline" className="font-mono text-[11px]">
            {id}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Link href={`/policies/${id}`}>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Cancel
            </Button>
          </Link>

          <Button size="sm" className="h-8 text-xs" onClick={saveChanges} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Policy Settings</CardTitle>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-foreground">Policy Name</Label>
                  <Input
                    value={policy.policy_name}
                    onChange={(e) => setPolicy((p) => ({ ...p, policy_name: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-foreground">Category</Label>
                  <Input
                    value={policy.category}
                    onChange={(e) => setPolicy((p) => ({ ...p, category: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-foreground">Type</Label>
                  <Select
                    value={policy.policy_type}
                    onValueChange={(v) => setPolicy((p) => ({ ...p, policy_type: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BLOCKLIST">Blocklist</SelectItem>
                      <SelectItem value="ALLOWLIST">Allowlist</SelectItem>
                      <SelectItem value="MONITOR">Monitor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-foreground">Action</Label>
                  <Select
                    value={policy.action}
                    onValueChange={(v) => setPolicy((p) => ({ ...p, action: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BLOCK">Block</SelectItem>
                      <SelectItem value="ALLOW">Allow</SelectItem>
                      <SelectItem value="REDIRECT">Redirect</SelectItem>
                      <SelectItem value="REVIEW">Review</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-foreground">Priority</Label>
                  <Input
                    type="number"
                    value={policy.priority}
                    onChange={(e) =>
                      setPolicy((p) => ({
                        ...p,
                        priority: Number(e.target.value),
                      }))
                    }
                    className="h-8 text-sm"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-foreground">Risk Level</Label>
                  <Select
                    value={policy.risk_level}
                    onValueChange={(v) => setPolicy((p) => ({ ...p, risk_level: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CRITICAL">Critical</SelectItem>
                      <SelectItem value="HIGH">High</SelectItem>
                      <SelectItem value="MEDIUM">Medium</SelectItem>
                      <SelectItem value="LOW">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-foreground">Description</Label>
                <Textarea
                  value={policy.description}
                  onChange={(e) => setPolicy((p) => ({ ...p, description: e.target.value }))}
                  className="min-h-[60px] resize-none text-sm"
                />
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  checked={policy.is_enabled}
                  onCheckedChange={(v) => setPolicy((p) => ({ ...p, is_enabled: v }))}
                />
                <Label className="text-xs text-foreground">Policy Enabled</Label>
              </div>
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm font-semibold text-foreground">
                  Rules ({rules.length})
                </CardTitle>

                <Badge variant="outline" className="text-[10px]">
                  View Only
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Rule editing is currently view-only. Metadata changes are saved, but rule changes are not persisted yet.
              </div>

              {rules.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No rules found for this policy.
                </div>
              ) : (
                rules.map((rule, index) => (
                  <div key={rule.id} className="rounded-md border bg-muted/30 p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">Rule {index + 1}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {rule.rule_type}
                        </Badge>
                        {typeof rule.rule_order === "number" ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Order {rule.rule_order}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge variant={rule.is_enabled ? "default" : "secondary"} className="text-[10px]">
                          {rule.is_enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Rule Type</label>
                        <Input value={rule.rule_type} className="h-7 text-xs" disabled readOnly />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Match Type</label>
                        <Input value={rule.match_type} className="h-7 text-xs" disabled readOnly />
                      </div>

                      <div className="col-span-2 flex flex-col gap-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Pattern</label>
                        <div className="relative">
                          <Input
                            value={rule.pattern}
                            placeholder={matchExamples[rule.match_type] || "Enter pattern..."}
                            className="h-7 pr-6 font-mono text-xs"
                            disabled
                            readOnly
                          />
                          <Info className="absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-4">
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Switch checked={rule.is_case_sensitive} disabled className="scale-[0.6]" />
                        Case Sensitive
                      </label>

                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Switch checked={rule.is_negated} disabled className="scale-[0.6]" />
                        Negated
                      </label>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Block Response</CardTitle>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-foreground">Status Code</Label>
                <Input
                  type="number"
                  value={policy.block_status_code}
                  onChange={(e) =>
                    setPolicy((p) => ({
                      ...p,
                      block_status_code: Number(e.target.value),
                    }))
                  }
                  className="h-8 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  HTTP status code for blocked requests (e.g. 403, 451)
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-foreground">Redirect URL</Label>
                <Input
                  value={policy.redirect_url}
                  onChange={(e) => setPolicy((p) => ({ ...p, redirect_url: e.target.value }))}
                  placeholder="https://warning.gateguard.io/blocked"
                  className="h-8 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Only used when action is REDIRECT
                </p>
              </div>

              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                After saving, you will be returned to the policy detail page so you can verify the updated metadata and audit trail.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
