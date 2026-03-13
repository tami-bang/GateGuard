export const runtime = "nodejs"

import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"

import { findUserByEmail, mapDbRoleToUiRole } from "@/lib/auth-db"
import { buildSessionCookie, SESSION_MAX_AGE_SEC } from "@/lib/session"

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

  return res
}
