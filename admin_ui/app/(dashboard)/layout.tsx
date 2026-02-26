import { Suspense } from "react"
import DashboardLayoutClient from "./layout-client"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <DashboardLayoutClient>{children}</DashboardLayoutClient>
    </Suspense>
  )
}
