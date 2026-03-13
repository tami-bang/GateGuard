export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verify } from "otplib"

import { enableTwoFactor, findUserById } from "@/lib/auth-db"
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/session"

export async function POST(req: Request) {
  const { token } = await req.json().catch(() => ({} as any))
  const otp = String(token || "").replace(/\s+/g, "")

  if (!otp) {
    return NextResponse.json({ ok: false, error: "MISSING_TOKEN" }, { status: 400 })
  }

  const jar = await cookies()
  const sessionToken = jar.get(SESSION_COOKIE_NAME)?.value
  const session = await verifySessionCookie(sessionToken)

  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 })
  }

  const dbUser = await findUserById(Number(session.sub))
  if (!dbUser || Number(dbUser.is_active) !== 1 || !dbUser.two_factor_secret) {
    return NextResponse.json({ ok: false, error: "2FA_SETUP_REQUIRED" }, { status: 400 })
  }

  const valid = verify({
    token: otp,
    secret: dbUser.two_factor_secret,
  })

  if (!valid) {
    return NextResponse.json({ ok: false, error: "INVALID_OTP" }, { status: 401 })
  }

  await enableTwoFactor(dbUser.user_id)

  return NextResponse.json({ ok: true })
}
