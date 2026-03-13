export const runtime = "nodejs"

import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"

import { findUserByEmail, mapDbRoleToUiRole } from "@/lib/auth-db"
import {
  buildPendingTwoFactorCookie,
  buildSessionCookie,
  clearPendingTwoFactorCookie,
  PENDING_2FA_MAX_AGE_SEC,
  SESSION_MAX_AGE_SEC,
} from "@/lib/session"

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({} as any))

  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 })
  }

  const normalizedEmail = String(email).trim().toLowerCase()
  const plainPassword = String(password)

  const dbUser = await findUserByEmail(normalizedEmail)
  if (!dbUser || Number(dbUser.is_active) !== 1) {
    return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 })
  }

  const matched = await bcrypt.compare(plainPassword, dbUser.password_hash)
  if (!matched) {
    return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 })
  }

  const user = {
    id: String(dbUser.user_id),
    email: dbUser.email,
    name: dbUser.name,
    role: mapDbRoleToUiRole(dbUser.role),
  }

  const requires2fa =
    Number(dbUser.two_factor_enabled) === 1 &&
    !!dbUser.two_factor_secret

  if (requires2fa) {
    const pendingCookie = await buildPendingTwoFactorCookie(user, PENDING_2FA_MAX_AGE_SEC)

    const res = NextResponse.json({
      ok: true,
      requires_2fa: true,
      user,
    })

    res.cookies.set({
      name: pendingCookie.name,
      value: pendingCookie.value,
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: pendingCookie.maxAge,
    })

    return res
  }

  const cookie = await buildSessionCookie(user, SESSION_MAX_AGE_SEC)

  const res = NextResponse.json({ ok: true, user })
  res.cookies.set({
    name: cookie.name,
    value: cookie.value,
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: cookie.maxAge,
  })

  const clearPending = clearPendingTwoFactorCookie()
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
