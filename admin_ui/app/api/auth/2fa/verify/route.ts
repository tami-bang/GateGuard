export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verify } from "otplib"

import { findUserById } from "@/lib/auth-db"
import {
  buildSessionCookie,
  clearPendingTwoFactorCookie,
  PENDING_2FA_COOKIE_NAME_EXPORT,
  SESSION_MAX_AGE_SEC,
  verifyPendingTwoFactorCookie,
} from "@/lib/session"

export async function POST(req: Request) {
  const { token } = await req.json().catch(() => ({} as any))
  const otp = String(token || "").replace(/\s+/g, "")

  if (!otp) {
    return NextResponse.json({ ok: false, error: "MISSING_TOKEN" }, { status: 400 })
  }

  const jar = await cookies()
  const pendingToken = jar.get(PENDING_2FA_COOKIE_NAME_EXPORT)?.value
  const pending = await verifyPendingTwoFactorCookie(pendingToken)

  if (!pending) {
    return NextResponse.json({ ok: false, error: "PENDING_2FA_REQUIRED" }, { status: 401 })
  }

  const dbUser = await findUserById(Number(pending.sub))
  if (
    !dbUser ||
    Number(dbUser.is_active) !== 1 ||
    Number(dbUser.two_factor_enabled) !== 1 ||
    !dbUser.two_factor_secret
  ) {
    return NextResponse.json({ ok: false, error: "2FA_NOT_ENABLED" }, { status: 401 })
  }

  const valid = verify({
    token: otp,
    secret: dbUser.two_factor_secret,
  })

  if (!valid) {
    return NextResponse.json({ ok: false, error: "INVALID_OTP" }, { status: 401 })
  }

  const user = {
    id: String(dbUser.user_id),
    email: dbUser.email,
    name: dbUser.name,
    role: pending.role as "Admin" | "Operator" | "Engineer",
  }

  const sessionCookie = await buildSessionCookie(user, SESSION_MAX_AGE_SEC)
  const clearPending = clearPendingTwoFactorCookie()

  const res = NextResponse.json({ ok: true, user })

  res.cookies.set({
    name: sessionCookie.name,
    value: sessionCookie.value,
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: sessionCookie.maxAge,
  })

  res.cookies.set({
    name: clearPending.name,
    value: clearPending.value,
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: clearPending.maxAge,
  })

  return res
}
