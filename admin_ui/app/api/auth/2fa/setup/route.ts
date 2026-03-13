export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import QRCode from "qrcode"
import { generateSecret, generateURI } from "otplib"

import { findUserById, saveTwoFactorSecret } from "@/lib/auth-db"
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/session"

export async function POST() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE_NAME)?.value
  const session = await verifySessionCookie(token)

  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 })
  }

  const dbUser = await findUserById(Number(session.sub))
  if (!dbUser || Number(dbUser.is_active) !== 1) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 })
  }

  const secret = generateSecret()
  const otpauthUrl = generateURI({
    issuer: "GateGuard",
    label: dbUser.email,
    secret,
  })
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl)

  await saveTwoFactorSecret(dbUser.user_id, secret)

  return NextResponse.json({
    ok: true,
    secret,
    otpauthUrl,
    qrDataUrl,
  })
}
