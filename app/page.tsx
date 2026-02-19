"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Shield } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

import { useAuth } from "@/lib/auth-context"
import { mockUsers } from "@/lib/mock-data"

type Mode = "login" | "forgot" | "reset"

export default function LoginPage() {
  const router = useRouter()
  const { login, isAuthenticated } = useAuth()

  const [mode, setMode] = useState<Mode>("login")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const [error, setError] = useState("") // 서버/인증 실패 등 "폼 전체" 에러
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({}) // 필드별 에러

  // 이미 인증되어 있으면 대시보드로
  useEffect(() => {
    if (isAuthenticated) router.replace("/dashboard")
  }, [isAuthenticated, router])

  // --- validation helpers ---
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

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
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

    const success = login(email.trim(), password)
    if (success) {
      router.replace("/dashboard") // push 대신 replace
    } else {
      setError("Invalid credentials. Try one of the demo accounts below.")
    }
  }

  function handleQuickLogin(userEmail: string) {
    setError("")
    setFieldErrors({})
    login(userEmail, "demo")
    router.replace("/dashboard")
  }

  // 이미 로그인 상태면 깜빡임 방지
  if (isAuthenticated) return null

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
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
            {/* LOGIN */}
            {mode === "login" && (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {/* Email */}
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
                  />
                  {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
                </div>

                {/* Password */}
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
                  />
                  {fieldErrors.password && <p className="text-xs text-destructive">{fieldErrors.password}</p>}
                </div>

                {/* Global error */}
                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button type="submit" className="h-9 w-full">
                  Log in
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
                >
                  Create an account
                </Button>
              </form>
            )}

            {/* FORGOT */}
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

            {/* RESET */}
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

            {/* Demo Accounts */}
            {mode === "login" && (
              <div className="mt-6 border-t pt-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Demo Accounts
                </p>
                <div className="flex flex-col gap-2">
                  {mockUsers.slice(0, 3).map(u => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => handleQuickLogin(u.email)}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
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