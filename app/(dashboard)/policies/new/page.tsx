"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { ArrowLeft, Plus, Trash2, GripVertical, Info } from "lucide-react"

interface RuleForm {
  id: string
  rule_type: string
  match_type: string
  pattern: string
  is_case_sensitive: boolean
  is_negated: boolean
  is_enabled: boolean
}

const matchExamples: Record<string, string> = {
  EXACT: "e.g. malware-cdn.evil.net",
  PREFIX: "e.g. /api/v2/",
  CONTAINS: "e.g. phishing",
  REGEX: "e.g. .*\\.evil\\.(net|com)",
}

export default function PolicyEditorPage() {
  const [policy, setPolicy] = useState({
    policy_name: "",
    policy_type: "BLOCKLIST",
    action: "BLOCK",
    priority: 100,
    is_enabled: true,
    risk_level: "MEDIUM",
    category: "",
    block_status_code: 403,
    redirect_url: "",
    description: "",
  })

  const [rules, setRules] = useState<RuleForm[]>([
    { id: "new-1", rule_type: "HOST", match_type: "EXACT", pattern: "", is_case_sensitive: false, is_negated: false, is_enabled: true },
  ])

  function addRule() {
    setRules(r => [...r, { id: `new-${Date.now()}`, rule_type: "HOST", match_type: "EXACT", pattern: "", is_case_sensitive: false, is_negated: false, is_enabled: true }])
  }

  function removeRule(id: string) {
    setRules(r => r.filter(rule => rule.id !== id))
  }

  function updateRule(id: string, field: string, value: unknown) {
    setRules(r => r.map(rule => rule.id === id ? { ...rule, [field]: value } : rule))
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink href="/policies">Policies</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>New Policy</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/policies">
            <Button variant="ghost" size="sm" className="h-8 px-2"><ArrowLeft className="size-4" /></Button>
          </Link>
          <h1 className="text-xl font-semibold text-foreground">Create Policy</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/policies"><Button variant="outline" size="sm" className="h-8 text-xs">Cancel</Button></Link>
          <Button size="sm" className="h-8 text-xs">Save Policy</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Policy Settings */}
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
                    onChange={e => setPolicy(p => ({ ...p, policy_name: e.target.value }))}
                    placeholder="e.g. Block Malware Domains"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-foreground">Category</Label>
                  <Input
                    value={policy.category}
                    onChange={e => setPolicy(p => ({ ...p, category: e.target.value }))}
                    placeholder="e.g. Malware, Phishing"
                    className="h-8 text-sm"
                  />
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
                  <Input
                    type="number"
                    value={policy.priority}
                    onChange={e => setPolicy(p => ({ ...p, priority: Number(e.target.value) }))}
                    className="h-8 text-sm"
                  />
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
                <Textarea
                  value={policy.description}
                  onChange={e => setPolicy(p => ({ ...p, description: e.target.value }))}
                  placeholder="Describe the purpose of this policy..."
                  className="min-h-[60px] resize-none text-sm"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={policy.is_enabled} onCheckedChange={v => setPolicy(p => ({ ...p, is_enabled: v }))} />
                <Label className="text-xs text-foreground">Policy Enabled</Label>
              </div>
            </CardContent>
          </Card>

          {/* Rules */}
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
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar settings */}
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
                  onChange={e => setPolicy(p => ({ ...p, block_status_code: Number(e.target.value) }))}
                  className="h-8 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">HTTP status code for blocked requests (e.g. 403, 451)</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-foreground">Redirect URL</Label>
                <Input
                  value={policy.redirect_url}
                  onChange={e => setPolicy(p => ({ ...p, redirect_url: e.target.value }))}
                  placeholder="https://warning.gateguard.io/blocked"
                  className="h-8 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">Only used when action is REDIRECT</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Pattern Help</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 text-xs text-muted-foreground">
                <div>
                  <span className="font-semibold text-foreground">EXACT:</span> Full string match
                  <br /><code className="font-mono text-[11px]">malware-cdn.evil.net</code>
                </div>
                <div>
                  <span className="font-semibold text-foreground">PREFIX:</span> Starts with
                  <br /><code className="font-mono text-[11px]">/api/v2/</code>
                </div>
                <div>
                  <span className="font-semibold text-foreground">CONTAINS:</span> Substring match
                  <br /><code className="font-mono text-[11px]">phishing</code>
                </div>
                <div>
                  <span className="font-semibold text-foreground">REGEX:</span> Regular expression
                  <br /><code className="font-mono text-[11px]">{'.*\\.evil\\.(net|com)'}</code>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
