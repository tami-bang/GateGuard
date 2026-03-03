"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Shield } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

import { useAuth } from "@/lib/auth-context"
import { mockUsers } from "@/lib/mock-data"

type Mode = "login" | "forgot" | "reset"

function safeDecodeRepeated(v: string, maxRounds: number): string {
  let cur = v
  for (let i = 0; i < maxRounds; i++) {
    try {
      const dec = decodeURIComponent(cur)
      if (dec === cur) break
      cur = dec
    } catch {
      break
    }
  }
  return cur
}

function sanitizeNext(nextRaw: string | null): { raw: string | null; decoded: string | null; path: string | null } {
  if (!nextRaw) return { raw: null, decoded: null, path: null }

  // next가 "%2Fpolicies%2F8" 혹은 "%252Fpolicies%252F8"(이중 인코딩)로 올 수 있어 반복 디코딩
  const decoded = safeDecodeRepeated(nextRaw, 3).trim()

  // 오픈 리다이렉트 방지: 같은 사이트 내 상대경로만 허용
  if (!decoded.startsWith("/")) return { raw: nextRaw, decoded, path: null }
  if (decoded.startsWith("//")) return { raw: nextRaw, decoded, path: null }
  if (decoded.includes("\\")) return { raw: nextRaw, decoded, path: null }

  return { raw: nextRaw, decoded, path: decoded }
}

export default function LoginClient() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const nextInfo = useMemo(() => {
    const raw = searchParams.get("next")
    return sanitizeNext(raw)
  }, [searchParams])

  const nextPath = nextInfo.path

  const { login, isAuthenticated, bootstrapped } = useAuth()

  const [mode, setMode] = useState<Mode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  function gotoAfterLogin() {
    const target = nextPath ?? "/dashboard"

    // 1) SPA 라우팅 시도
    router.replace(target)

    // 2) 미들웨어/세션/프록시 환경에서 SPA replace가 먹통이거나 다시 튕기는 케이스 대비:
    //    300ms 후에도 경로가 안 바뀌면 하드 네비게이션으로 강제 이동
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        try {
          if (window.location.pathname !== target) {
            window.location.assign(target)
          }
        } catch {
          // ignore
        }
      }, 300)
    }
  }

  /**
   * 이미 로그인 상태라면 "/"에서만 redirect 수행
   */
  useEffect(() => {
    if (!bootstrapped) return
    if (!isAuthenticated) return
    if (typeof window === "undefined") return

    if (window.location.pathname === "/") {
      gotoAfterLogin()
    }
  }, [bootstrapped, isAuthenticated, nextPath]) // router는 내부에서만 사용

  function validateEmail(value: string) {
    const v = value.trim()
    if (!v) return "Email is required"
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(v)) return "Invalid email format"
    return ""
  }

  function validatePassword(value: string) {
    const v = value
    if (!v) return "Password is required"
    if (v.length < 8) return "Password must be at least 8 characters"
    if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return "Password must include letters and numbers"
    return ""
  }

  const titleText = useMemo(() => {
    if (mode === "login") return "Security Operations Center"
    if (mode === "forgot") return "Password Reset"
    return "Set New Password"
  }, [mode])

  const descText = useMemo(() => {
    if (mode === "login") return "Authenticate to continue to GateGuard SOC Dashboard"
    if (mode === "forgot") return "Enter your email to receive a reset link"
    return "Enter your new password below"
  }, [mode])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return

    setError("")
    setFieldErrors({})

    const emailErr = validateEmail(email)
    const passErr = validatePassword(password)

    if (emailErr || passErr) {
      setFieldErrors({
        email: emailErr || undefined,
        password: passErr || undefined,
      })
      return
    }

    try {
      setSubmitting(true)
      const success = await login(email.trim(), password)

      if (success) {
        gotoAfterLogin()
      } else {
        setError("Invalid credentials. Try one of the demo accounts below.")
      }
    } catch {
      setError("Login failed. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleQuickLogin(userEmail: string) {
    if (submitting) return
    setError("")
    setFieldErrors({})

    try {
      setSubmitting(true)
      await login(userEmail, "demo")
      gotoAfterLogin()
    } catch {
      setError("Login failed. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!bootstrapped) return null
  if (isAuthenticated) return null

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <Shield className="size-8 text-primary" />
            <span className="text-2xl font-bold text-foreground tracking-tight">GateGuard</span>
          </div>
          <p className="text-sm text-muted-foreground">Security Operations Center</p>
        </div>

        <Card className="border shadow-sm">
          <CardHeader className="pb-4 pt-6 px-6">
            <h2 className="text-lg font-semibold text-foreground">{titleText}</h2>
            <p className="text-sm text-muted-foreground">{descText}</p>
          </CardHeader>

          <CardContent className="px-6 pb-6">
            {/* 디버그: 원인 확정용(원인 잡히면 지워도 됨) */}
            <div className="mb-3 rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
              <div className="font-mono">next.raw: {nextInfo.raw ?? "null"}</div>
              <div className="font-mono">next.decoded: {nextInfo.decoded ?? "null"}</div>
              <div className="font-mono">next.path: {nextPath ?? "null"}</div>
            </div>

            {mode === "login" && (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email" className="text-sm font-medium text-foreground">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@gateguard.io"
                    value={email}
                    onChange={e => {
                      setEmail(e.target.value)
                      if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: undefined }))
                    }}
                    className={`h-9 ${fieldErrors.email ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    aria-invalid={!!fieldErrors.email}
                    disabled={submitting}
                  />
                  {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-medium text-foreground">
                      Password
                    </Label>
                    <button
                      type="button"
                      onClick={() => {
                        setError("")
                        setFieldErrors({})
                        setMode("forgot")
                      }}
                      className="text-xs text-primary hover:underline"
                      disabled={submitting}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={e => {
                      setPassword(e.target.value)
                      if (fieldErrors.password) setFieldErrors(prev => ({ ...prev, password: undefined }))
                    }}
                    className={`h-9 ${fieldErrors.password ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    aria-invalid={!!fieldErrors.password}
                    disabled={submitting}
                  />
                  {fieldErrors.password && <p className="text-xs text-destructive">{fieldErrors.password}</p>}
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button type="submit" className="h-9 w-full" disabled={submitting}>
                  {submitting ? "Logging in..." : "Log in"}
                </Button>

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex-1 h-px bg-border" />
                  OR
                  <div className="flex-1 h-px bg-border" />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full"
                  onClick={() => router.replace("/sign-up")}
                  disabled={submitting}
                >
                  Create an account
                </Button>
              </form>
            )}

            {mode === "forgot" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reset-email" className="text-sm font-medium text-foreground">
                    Email
                  </Label>
                  <Input id="reset-email" type="email" placeholder="you@gateguard.io" className="h-9" />
                </div>

                <Button className="h-9 w-full" onClick={() => setMode("reset")}>
                  Send reset link
                </Button>

                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="text-sm text-primary hover:underline text-center"
                >
                  Back to login
                </button>
              </div>
            )}

            {mode === "reset" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-pass" className="text-sm font-medium text-foreground">
                    New Password
                  </Label>
                  <Input id="new-pass" type="password" className="h-9" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm-pass" className="text-sm font-medium text-foreground">
                    Confirm Password
                  </Label>
                  <Input id="confirm-pass" type="password" className="h-9" />
                </div>

                <Button className="h-9 w-full" onClick={() => setMode("login")}>
                  Reset password
                </Button>
              </div>
            )}

            {mode === "login" && (
              <div className="mt-6 border-t pt-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Demo Accounts</p>
                <div className="flex flex-col gap-2">
                  {mockUsers.slice(0, 3).map(u => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => handleQuickLogin(u.email)}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                      disabled={submitting}
                    >
                      <div>
                        <span className="font-medium text-foreground">{u.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{u.email}</span>
                      </div>
                      <span
                        className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          u.role === "Admin"
                            ? "bg-primary text-primary-foreground"
                            : u.role === "Operator"
                              ? "bg-success text-white"
                              : "bg-warning text-white"
                        }`}
                      >
                        {u.role}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
