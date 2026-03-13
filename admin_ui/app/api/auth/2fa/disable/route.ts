export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verify } from "otplib"

import { disableTwoFactor, findUserById } from "@/lib/auth-db"
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/session"

export async function POST(req: Request) {
  const { token } = await req.json().catch(() => ({} as any))
  const otp = String(token || "").replace(/\s+/g, "")

  const jar = await cookies()
  const sessionToken = jar.get(SESSION_COOKIE_NAME)?.value
  const session = await verifySessionCookie(sessionToken)

  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 })
  }

  const dbUser = await findUserById(Number(session.sub))
  if (!dbUser || Number(dbUser.is_active) !== 1) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 })
  }

  if (Number(dbUser.two_factor_enabled) === 1) {
    if (!dbUser.two_factor_secret || !otp) {
      return NextResponse.json({ ok: false, error: "MISSING_TOKEN" }, { status: 400 })
    }

  const valid = verify({
    token: otp,
    secret: dbUser.two_factor_secret,
  })
    if (!valid) {
      return NextResponse.json({ ok: false, error: "INVALID_OTP" }, { status: 401 })
    }
  }

  await disableTwoFactor(dbUser.user_id)

  return NextResponse.json({ ok: true })
}
