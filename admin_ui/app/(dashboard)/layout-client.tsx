"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { AppHeader } from "@/components/app-header"
import { GateGuardSplash } from "@/components/gateguard-splash"
import { useAuth } from "@/lib/auth-context"

export default function DashboardLayoutClient({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, bootstrapped } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [showSplash, setShowSplash] = useState(false)

  const current = useMemo(() => {
    const qs = searchParams?.toString()
    return `${pathname}${qs ? `?${qs}` : ""}`
  }, [pathname, searchParams])

  useEffect(() => {
    if (!bootstrapped) return
    if (!isAuthenticated) {
      router.replace(`/?next=${encodeURIComponent(current)}`)
    }
  }, [bootstrapped, isAuthenticated, router, current])

  useEffect(() => {
    if (!bootstrapped || !isAuthenticated) return

    const splashSeen = sessionStorage.getItem("gg_dashboard_splash_seen")
    if (splashSeen === "1") return

    sessionStorage.setItem("gg_dashboard_splash_seen", "1")
    setShowSplash(true)
  }, [bootstrapped, isAuthenticated])

  if (!bootstrapped) {
    return <div className="min-h-screen bg-background" />
  }

  if (!isAuthenticated) {
    return <div className="min-h-screen bg-background" />
  }

  return (
    <>
      <GateGuardSplash
        visible={showSplash}
        durationMs={1200}
        onDone={() => setShowSplash(false)}
      />

      <div className="flex min-h-screen bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col pl-60 transition-all duration-200" id="main-content">
          <AppHeader />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </>
  )
}
