export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { findUserById } from "@/lib/auth-db"
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/session"

export async function GET() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE_NAME)?.value
  const payload = await verifySessionCookie(token)

  if (!payload) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const dbUser = await findUserById(Number(payload.sub))
  if (!dbUser || Number(dbUser.is_active) !== 1) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      twoFactorEnabled: Number(dbUser.two_factor_enabled) === 1,
    },
  })
}
