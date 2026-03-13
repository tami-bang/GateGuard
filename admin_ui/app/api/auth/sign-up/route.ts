export const runtime = "nodejs"

import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"

import { findUserByEmail, insertUserAccount, mapDbRoleToUiRole } from "@/lib/auth-db"
import { buildSessionCookie, SESSION_MAX_AGE_SEC } from "@/lib/session"

function isValidEmail(email: string): boolean {
  return /^[A-Za-z0-9._-]+@gateguard\.io$/.test(email)
}

function isValidPassword(password: string): boolean {
  if (password.length < 8) return false
  if (!/[A-Za-z]/.test(password)) return false
  if (!/[0-9]/.test(password)) return false
  return true
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any))

  const firstName = String(body.firstName || "").trim()
  const lastName = String(body.lastName || "").trim()
  const email = String(body.email || "").trim().toLowerCase()
  const password = String(body.password || "")

  if (!firstName || !lastName || !email || !password) {
    return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 })
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "INVALID_EMAIL" }, { status: 400 })
  }

  if (!isValidPassword(password)) {
    return NextResponse.json({ ok: false, error: "INVALID_PASSWORD" }, { status: 400 })
  }

  const existing = await findUserByEmail(email)
  if (existing) {
    return NextResponse.json({ ok: false, error: "EMAIL_ALREADY_EXISTS" }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const fullName = `${firstName} ${lastName}`

  const userId = await insertUserAccount({
    email,
    passwordHash,
    name: fullName,
    role: "OPERATOR",
  })

  const user = {
    id: String(userId),
    email,
    name: fullName,
    role: mapDbRoleToUiRole("OPERATOR"),
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
