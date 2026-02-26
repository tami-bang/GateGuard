export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { mockUsers } from "@/lib/mock-data"
import { buildSessionCookie, SESSION_MAX_AGE_SEC } from "@/lib/session"

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({} as any))
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 })
  }

  const e = String(email).trim()
  const found = mockUsers.find(u => u.email === e)
  const user = found || (e.includes("@") ? mockUsers[0] : null)
  if (!user) {
    return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 })
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
