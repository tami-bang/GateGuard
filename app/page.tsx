"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { useAuth } from "@/lib/auth-context"
import { mockUsers } from "@/lib/mock-data"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [mode, setMode] = useState<"login" | "forgot" | "reset">("login")
  const { login, isAuthenticated } = useAuth()
  const router = useRouter()

  if (isAuthenticated) {
    router.push("/dashboard")
    return null
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (!email) {
      setError("Email is required")
      return
    }
    const success = login(email, password)
    if (success) {
      router.push("/dashboard")
    } else {
      setError("Invalid credentials. Try one of the demo accounts below.")
    }
  }

  function handleQuickLogin(userEmail: string) {
    login(userEmail, "demo")
    router.push("/dashboard")
  }

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
            <h2 className="text-lg font-semibold text-foreground">
              {mode === "login" && "Sign in to your account"}
              {mode === "forgot" && "Reset your password"}
              {mode === "reset" && "Create new password"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === "login" && "Enter your credentials to access the admin portal"}
              {mode === "forgot" && "Enter your email to receive a reset link"}
              {mode === "reset" && "Enter your new password below"}
            </p>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {mode === "login" && (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email" className="text-sm font-medium text-foreground">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@gateguard.io"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-medium text-foreground">Password</Label>
                    <button
                      type="button"
                      onClick={() => setMode("forgot")}
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
                    onChange={e => setPassword(e.target.value)}
                    className="h-9"
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="h-9 w-full">
                  Sign in
                </Button>
              </form>
            )}

            {mode === "forgot" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reset-email" className="text-sm font-medium text-foreground">Email</Label>
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
                  Back to sign in
                </button>
              </div>
            )}

            {mode === "reset" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-pass" className="text-sm font-medium text-foreground">New Password</Label>
                  <Input id="new-pass" type="password" className="h-9" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm-pass" className="text-sm font-medium text-foreground">Confirm Password</Label>
                  <Input id="confirm-pass" type="password" className="h-9" />
                </div>
                <Button className="h-9 w-full" onClick={() => setMode("login")}>
                  Reset password
                </Button>
              </div>
            )}

            {/* Quick login hints */}
            {mode === "login" && (
              <div className="mt-6 border-t pt-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Demo Accounts</p>
                <div className="flex flex-col gap-2">
                  {mockUsers.slice(0, 3).map(u => (
                    <button
                      key={u.id}
                      onClick={() => handleQuickLogin(u.email)}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <div>
                        <span className="font-medium text-foreground">{u.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{u.email}</span>
                      </div>
                      <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        u.role === "Admin" ? "bg-primary text-primary-foreground" :
                        u.role === "Operator" ? "bg-success text-white" :
                        "bg-warning text-white"
                      }`}>
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
