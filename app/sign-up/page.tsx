"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Shield } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

import { useAuth } from "@/lib/auth-context"

type FieldErrors = {
  firstName?: string
  lastName?: string
  email?: string
  password?: string
  confirm?: string
}

type Touched = {
  firstName?: boolean
  lastName?: boolean
  email?: boolean
  password?: boolean
  confirm?: boolean
}

export default function SignUpPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuth()

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")

  const [emailLocal, setEmailLocal] = useState("")
  const emailDomain = "@gateguard.io"
  const email = useMemo(() => {
    return emailLocal ? `${emailLocal}${emailDomain}` : ""
  }, [emailLocal, emailDomain])

  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")

  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Touched>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isAuthenticated) router.replace("/dashboard")
  }, [isAuthenticated, router])

  // --- validators ---
  function validateFirstName(v: string) {
    const s = v.trim()
    if (!s) return "First name is required"
    if (s.length < 2) return "First name must be at least 2 characters"
    if (s.length > 50) return "First name must be less than 50 characters"
    if (!/^[A-Za-z]+$/.test(s)) return "First name must contain only English letters"
    return ""
  }

  function validateLastName(v: string) {
    const s = v.trim()
    if (!s) return "Last name is required"
    if (s.length < 2) return "Last name must be at least 2 characters"
    if (s.length > 50) return "Last name must be less than 50 characters"
    if (!/^[A-Za-z]+$/.test(s)) return "Last name must contain only English letters"
    return ""
  }

  // local part만 검증 (뒤에 @gateguard.io는 고정)
  function validateEmailLocal(v: string) {
    const s = v.trim()

    if (!s) return "Email is required"
    if (s.length < 3) return "Email must be at least 3 characters"
    if (s.length > 64) return "Email must be less than 64 characters"

    // 영문/숫자/._- 허용
    const regex = /^[a-zA-Z0-9._-]+$/
    if (!regex.test(s)) return "Only letters, numbers, dot, underscore and dash allowed"

    // 점으로 시작/끝 금지 + 연속 점 금지
    if (s.startsWith(".") || s.endsWith(".")) return "Invalid email format"
    if (s.includes("..")) return "Invalid email format"

    return ""
  }

  // 기존 로그인 정책과 동일: 8자 + 영문/숫자 포함
  function validatePassword(v: string) {
    if (!v) return "Password is required"
    if (v.length < 8) return "Password must be at least 8 characters"
    if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return "Password must include letters and numbers"
    return ""
  }

  function validateConfirm(pw: string, c: string) {
    if (!c) return "Confirm password is required"
    if (pw !== c) return "Passwords do not match"
    return ""
  }

  function validateAll(
    next?: Partial<{
      firstName: string
      lastName: string
      emailLocal: string
      password: string
      confirm: string
    }>
  ) {
    const fn = next?.firstName ?? firstName
    const ln = next?.lastName ?? lastName
    const el = next?.emailLocal ?? emailLocal
    const pw = next?.password ?? password
    const cf = next?.confirm ?? confirm

    const firstErr = validateFirstName(fn)
    const lastErr = validateLastName(ln)
    const emailErr = validateEmailLocal(el)
    const passErr = validatePassword(pw)
    const confErr = validateConfirm(pw, cf)

    const errs: FieldErrors = {
      firstName: firstErr || undefined,
      lastName: lastErr || undefined,
      email: emailErr || undefined,
      password: passErr || undefined,
      confirm: confErr || undefined,
    }
    return errs
  }

  function setSingleError<K extends keyof FieldErrors>(key: K, message: string) {
    setFieldErrors(prev => ({ ...prev, [key]: message || undefined }))
  }

  function handleBlur<K extends keyof Touched>(key: K) {
    setTouched(prev => ({ ...prev, [key]: true }))

    if (key === "firstName") setSingleError("firstName", validateFirstName(firstName))
    if (key === "lastName") setSingleError("lastName", validateLastName(lastName))
    if (key === "email") setSingleError("email", validateEmailLocal(emailLocal))

    if (key === "password") {
      const passErr = validatePassword(password)
      setSingleError("password", passErr)

      if (confirm || touched.confirm) setSingleError("confirm", validateConfirm(password, confirm))
    }

    if (key === "confirm") setSingleError("confirm", validateConfirm(password, confirm))
  }

  function handleChangeFirstName(v: string) {
    setFirstName(v)
    if (touched.firstName) setSingleError("firstName", validateFirstName(v))
  }

  function handleChangeLastName(v: string) {
    setLastName(v)
    if (touched.lastName) setSingleError("lastName", validateLastName(v))
  }

  function handleChangeEmailLocal(v: string) {
    setEmailLocal(v)
    if (touched.email) setSingleError("email", validateEmailLocal(v))
  }

  function handleChangePassword(v: string) {
    setPassword(v)
    if (touched.password) setSingleError("password", validatePassword(v))
    if (confirm || touched.confirm) setSingleError("confirm", validateConfirm(v, confirm))
  }

  function handleChangeConfirm(v: string) {
    setConfirm(v)
    if (touched.confirm) setSingleError("confirm", validateConfirm(password, v))
  }

  const canSubmit = useMemo(() => {
    const filled = firstName.trim() && lastName.trim() && emailLocal.trim() && password && confirm
    const noFieldError =
      !fieldErrors.firstName &&
      !fieldErrors.lastName &&
      !fieldErrors.email &&
      !fieldErrors.password &&
      !fieldErrors.confirm

    return Boolean(filled && noFieldError && !submitting)
  }, [firstName, lastName, emailLocal, password, confirm, fieldErrors, submitting])

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    setTouched({ firstName: true, lastName: true, email: true, password: true, confirm: true })

    const errs = validateAll()
    setFieldErrors(errs)

    const hasError = Object.values(errs).some(Boolean)
    if (hasError) return

    try {
      setSubmitting(true)

      // 예시:
      // const res = await fetch("/api/auth/sign-up", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({
      //     firstName: firstName.trim(),
      //     lastName: lastName.trim(),
      //     email, // 항상 @gateguard.io 포함
      //     password,
      //   }),
      // })
      // if (!res.ok) throw new Error("Sign up failed")

      await new Promise(r => setTimeout(r, 600))
      router.replace("/")
    } catch {
      setError("Sign up failed. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

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
            <h2 className="text-lg font-semibold text-foreground">Create an account</h2>
            <p className="text-sm text-muted-foreground">Sign up to access GateGuard SOC</p>
          </CardHeader>

          <CardContent className="px-6 pb-6">
            <form onSubmit={handleSignUp} className="flex flex-col gap-4" noValidate>
              {/* First Name */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="firstName" className="text-sm font-medium text-foreground">
                  First Name
                </Label>
                <Input
                  id="firstName"
                  placeholder="Sarah"
                  value={firstName}
                  onChange={e => handleChangeFirstName(e.target.value)}
                  onBlur={() => handleBlur("firstName")}
                  className={`h-9 ${
                    touched.firstName && fieldErrors.firstName ? "border-destructive focus-visible:ring-destructive" : ""
                  }`}
                  aria-invalid={!!(touched.firstName && fieldErrors.firstName)}
                />
                {touched.firstName && fieldErrors.firstName && (
                  <p className="text-xs text-destructive">{fieldErrors.firstName}</p>
                )}
              </div>

              {/* Last Name */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lastName" className="text-sm font-medium text-foreground">
                  Last Name
                </Label>
                <Input
                  id="lastName"
                  placeholder="Chen"
                  value={lastName}
                  onChange={e => handleChangeLastName(e.target.value)}
                  onBlur={() => handleBlur("lastName")}
                  className={`h-9 ${
                    touched.lastName && fieldErrors.lastName ? "border-destructive focus-visible:ring-destructive" : ""
                  }`}
                  aria-invalid={!!(touched.lastName && fieldErrors.lastName)}
                />
                {touched.lastName && fieldErrors.lastName && (
                  <p className="text-xs text-destructive">{fieldErrors.lastName}</p>
                )}
              </div>

              {/* Email (local + fixed domain) */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emailLocal" className="text-sm font-medium text-foreground">
                  Email
                </Label>

                <div className="flex">
                  <Input
                    id="emailLocal"
                    placeholder="sarah.chen"
                    value={emailLocal}
                    onChange={e => handleChangeEmailLocal(e.target.value)}
                    onBlur={() => handleBlur("email")}
                    className={`h-9 rounded-r-none ${
                      touched.email && fieldErrors.email ? "border-destructive focus-visible:ring-destructive" : ""
                    }`}
                    aria-invalid={!!(touched.email && fieldErrors.email)}
                  />

                  <div className="flex items-center px-3 border border-l-0 rounded-r-md bg-muted text-sm text-muted-foreground">
                    {emailDomain}
                  </div>
                </div>

                {touched.email && fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
              </div>

              {/* Password */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="At least 8 chars, letters + numbers"
                  value={password}
                  onChange={e => handleChangePassword(e.target.value)}
                  onBlur={() => handleBlur("password")}
                  className={`h-9 ${
                    touched.password && fieldErrors.password ? "border-destructive focus-visible:ring-destructive" : ""
                  }`}
                  aria-invalid={!!(touched.password && fieldErrors.password)}
                />
                {touched.password && fieldErrors.password && (
                  <p className="text-xs text-destructive">{fieldErrors.password}</p>
                )}
              </div>

              {/* Confirm */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm" className="text-sm font-medium text-foreground">
                  Confirm Password
                </Label>
                <Input
                  id="confirm"
                  type="password"
                  placeholder="Re-enter password"
                  value={confirm}
                  onChange={e => handleChangeConfirm(e.target.value)}
                  onBlur={() => handleBlur("confirm")}
                  className={`h-9 ${
                    touched.confirm && fieldErrors.confirm ? "border-destructive focus-visible:ring-destructive" : ""
                  }`}
                  aria-invalid={!!(touched.confirm && fieldErrors.confirm)}
                />
                {touched.confirm && fieldErrors.confirm && (
                  <p className="text-xs text-destructive">{fieldErrors.confirm}</p>
                )}
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" className="h-9 w-full" disabled={!canSubmit}>
                {submitting ? "Creating..." : "Create account"}
              </Button>

              <button
                type="button"
                onClick={() => router.replace("/")}
                className="text-sm text-primary hover:underline text-center"
              >
                Back to login
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}