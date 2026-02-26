export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { clearSessionCookie } from "@/lib/session"

export async function POST() {
  const cookie = clearSessionCookie()
  const res = NextResponse.json({ ok: true })
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
