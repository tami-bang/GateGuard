"use client"

import { use, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { ArrowLeft, Plus, Trash2, GripVertical, Info } from "lucide-react"

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

  const [rules, setRules] = useState<RuleForm[]>([
    { id: "new-1", rule_type: "HOST", match_type: "EXACT", pattern: "", is_case_sensitive: false, is_negated: false, is_enabled: true },
  ])

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
          risk_level: (pol.risk_level ?? "MEDIUM") as any,
          category: pol.category ?? "",
          block_status_code: pol.block_status_code ?? 403,
          redirect_url: pol.redirect_url ?? "",
          description: pol.description ?? "",
        })

        const rulesResp = await apiListPolicyRules(policyId)
        const items = Array.isArray(rulesResp?.items) ? rulesResp.items : []
        if (!alive) return

        const normalized = items.map(normalizeRule)
        setRules(
          normalized.length > 0
            ? normalized
            : [{ id: "new-1", rule_type: "HOST", match_type: "EXACT", pattern: "", is_case_sensitive: false, is_negated: false, is_enabled: true }]
        )
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

  function addRule() {
    setRules(r => [...r, { id: `new-${Date.now()}`, rule_type: "HOST", match_type: "EXACT", pattern: "", is_case_sensitive: false, is_negated: false, is_enabled: true }])
  }

  function removeRule(ruleId: string) {
    setRules(r => r.filter(rule => rule.id !== ruleId))
  }

  function updateRule(ruleId: string, field: string, value: unknown) {
    setRules(r => r.map(rule => (rule.id === ruleId ? { ...rule, [field]: value } : rule)))
  }

  async function saveChanges() {
    if (!existing) return
    setSaving(true)
    setError(null)
    try {
      await apiPatchPolicy(policyId, {
        policy_name: policy.policy_name,
        policy_type: policy.policy_type,
        action: policy.action,
        priority: policy.priority,
        is_enabled: policy.is_enabled ? 1 : 0,
        risk_level: policy.risk_level,
        category: policy.category,
        block_status_code: policy.block_status_code,
        redirect_url: policy.redirect_url,
        description: policy.description,
      })

      // rules 저장은 현재 FastAPI에 업데이트 API가 없음.
      // (GET rules만 있고, PUT/PATCH rules 엔드포인트 없음)
      // 그래서 현재는 "정책 메타만 저장"이 정상 동작 범위.

      const polResp = await apiGetPolicy(policyId)
      setExisting(polResp?.policy ?? existing)
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    )
  }

  if (error && !existing) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">{error}</p>
        <Link href="/policies"><Button variant="outline" size="sm">Back to Policies</Button></Link>
      </div>
    )
  }

  if (!existing) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">Policy not found</p>
        <Link href="/policies"><Button variant="outline" size="sm">Back to Policies</Button></Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink href="/policies">Policies</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink href={`/policies/${id}`}>{existing.policy_name}</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Edit</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/policies/${id}`}>
            <Button variant="ghost" size="sm" className="h-8 px-2"><ArrowLeft className="size-4" /></Button>
          </Link>
          <h1 className="text-xl font-semibold text-foreground">Edit Policy</h1>
          <Badge variant="outline" className="font-mono text-[11px]">{id}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/policies/${id}`}><Button variant="outline" size="sm" className="h-8 text-xs">Cancel</Button></Link>
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
                  <Input value={policy.policy_name} onChange={e => setPolicy(p => ({ ...p, policy_name: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-foreground">Category</Label>
                  <Input value={policy.category} onChange={e => setPolicy(p => ({ ...p, category: e.target.value }))} className="h-8 text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-foreground">Type</Label>
                  <Select value={policy.policy_type} onValueChange={v => setPolicy(p => ({ ...p, policy_type: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BLOCKLIST">Blocklist</SelectItem>
                      <SelectItem value="ALLOWLIST">Allowlist</SelectItem>
                      <SelectItem value="MONITOR">Monitor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-foreground">Action</Label>
                  <Select value={policy.action} onValueChange={v => setPolicy(p => ({ ...p, action: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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
                  <Input type="number" value={policy.priority} onChange={e => setPolicy(p => ({ ...p, priority: Number(e.target.value) }))} className="h-8 text-sm" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-foreground">Risk Level</Label>
                  <Select value={policy.risk_level} onValueChange={v => setPolicy(p => ({ ...p, risk_level: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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
                <Textarea value={policy.description} onChange={e => setPolicy(p => ({ ...p, description: e.target.value }))} className="min-h-[60px] resize-none text-sm" />
              </div>

              <div className="flex items-center gap-3">
                <Switch checked={policy.is_enabled} onCheckedChange={v => setPolicy(p => ({ ...p, is_enabled: v }))} />
                <Label className="text-xs text-foreground">Policy Enabled</Label>
              </div>
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-foreground">Rules ({rules.length})</CardTitle>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={addRule}>
                  <Plus className="size-3" /> Add Rule
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {rules.map((rule, index) => (
                <div key={rule.id} className="rounded-md border p-3 bg-muted/30">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <GripVertical className="size-4 text-muted-foreground" />
                      <span className="text-xs font-semibold text-foreground">Rule {index + 1}</span>
                      <Badge variant="outline" className="text-[10px]">{rule.rule_type}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={rule.is_enabled} onCheckedChange={v => updateRule(rule.id, "is_enabled", v)} className="scale-75" />
                      <Button variant="ghost" size="sm" className="h-6 px-1 text-muted-foreground hover:text-destructive" onClick={() => removeRule(rule.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-muted-foreground">Rule Type</label>
                      <Select value={rule.rule_type} onValueChange={v => updateRule(rule.id, "rule_type", v)}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="HOST">Host</SelectItem>
                          <SelectItem value="PATH">Path</SelectItem>
                          <SelectItem value="URL">URL</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-muted-foreground">Match Type</label>
                      <Select value={rule.match_type} onValueChange={v => updateRule(rule.id, "match_type", v)}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EXACT">Exact</SelectItem>
                          <SelectItem value="PREFIX">Prefix</SelectItem>
                          <SelectItem value="CONTAINS">Contains</SelectItem>
                          <SelectItem value="REGEX">Regex</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="col-span-2 flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-muted-foreground">Pattern</label>
                      <div className="relative">
                        <Input
                          value={rule.pattern}
                          onChange={e => updateRule(rule.id, "pattern", e.target.value)}
                          placeholder={matchExamples[rule.match_type] || "Enter pattern..."}
                          className="h-7 text-xs font-mono pr-6"
                        />
                        <Info className="absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Switch checked={rule.is_case_sensitive} onCheckedChange={v => updateRule(rule.id, "is_case_sensitive", v)} className="scale-[0.6]" />
                      Case Sensitive
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Switch checked={rule.is_negated} onCheckedChange={v => updateRule(rule.id, "is_negated", v)} className="scale-[0.6]" />
                      Negated
                    </label>
                  </div>

                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Rules save is not wired yet (no FastAPI endpoint for updating policy_rule).
                  </div>
                </div>
              ))}
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
                <Input type="number" value={policy.block_status_code} onChange={e => setPolicy(p => ({ ...p, block_status_code: Number(e.target.value) }))} className="h-8 text-sm" />
                <p className="text-[11px] text-muted-foreground">HTTP status code for blocked requests (e.g. 403, 451)</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-foreground">Redirect URL</Label>
                <Input value={policy.redirect_url} onChange={e => setPolicy(p => ({ ...p, redirect_url: e.target.value }))} placeholder="https://warning.gateguard.io/blocked" className="h-8 text-sm" />
                <p className="text-[11px] text-muted-foreground">Only used when action is REDIRECT</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
