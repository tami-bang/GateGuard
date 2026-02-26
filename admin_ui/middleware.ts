import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 보호할 구간: dashboard 그룹의 실제 URL들
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

  // 예시: auth-context가 localStorage 기반이라면 미들웨어에서는 못 읽음.
  // 그래서 "쿠키" 기반으로만 보호가 가능함.
  // (쿠키로 바꾸기 전까지는 layout 방식 유지 권장)

  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/logs/:path*", "/policies/:path*", "/incidents/:path*", "/ai-analysis/:path*", "/audit-log/:path*"],
}