import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/session"

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  const protectedPaths = [
    "/dashboard",
    "/logs",
    "/policies",
    "/incidents",
    "/ai-analysis",
    "/audit-log",
  ]

  const isProtected = protectedPaths.some(p => pathname === p || pathname.startsWith(p + "/"))
  if (!isProtected) return NextResponse.next()

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const payload = await verifySessionCookie(token)

  if (!payload) {
    const url = req.nextUrl.clone()
    url.pathname = "/"
    url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/logs/:path*",
    "/policies/:path*",
    "/incidents/:path*",
    "/ai-analysis/:path*",
    "/audit-log/:path*",
  ],
}
