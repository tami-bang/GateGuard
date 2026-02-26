"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  ScrollText,
  ShieldAlert,
  FileText,
  Brain,
  ClipboardList,
  Shield,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import { useState } from "react"
import { mockReviewEvents } from "@/lib/mock-data"

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  page: string
  badge?: number
}

const openCount = mockReviewEvents.filter(r => r.status === "OPEN").length

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, page: "dashboard" },
  { label: "Logs", href: "/logs", icon: ScrollText, page: "logs" },
  { label: "Incidents", href: "/incidents", icon: ShieldAlert, page: "incidents", badge: openCount },
  { label: "Policies", href: "/policies", icon: FileText, page: "policies" },
  { label: "AI Analysis", href: "/ai-analysis", icon: Brain, page: "ai-analysis" },
  { label: "Audit Log", href: "/audit-log", icon: ClipboardList, page: "audit-log" },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { hasAccess } = useAuth()
  const [collapsed, setCollapsed] = useState(false)

  const visibleItems = navItems.filter(item => hasAccess(item.page))

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
      style={{ backgroundColor: "var(--sidebar-bg)", borderColor: "var(--sidebar-border)" }}
    >
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b px-4" style={{ borderColor: "var(--sidebar-border)" }}>
        <Shield className="size-6 shrink-0" style={{ color: "var(--sidebar-primary)" }} />
        {!collapsed && (
          <span className="text-base font-bold tracking-tight" style={{ color: "var(--sidebar-foreground)" }}>
            GateGuard
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-0.5">
          {visibleItems.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    collapsed && "justify-center px-2"
                  )}
                  style={{
                    color: isActive ? "var(--sidebar-primary-foreground)" : "var(--sidebar-muted)",
                    backgroundColor: isActive ? "var(--sidebar-primary)" : "transparent",
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = "var(--sidebar-accent)"
                      e.currentTarget.style.color = "var(--sidebar-accent-foreground)"
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = "transparent"
                      e.currentTarget.style.color = "var(--sidebar-muted)"
                    }
                  }}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="size-4 shrink-0" />
                  {!collapsed && (
                    <span className="flex-1">{item.label}</span>
                  )}
                  {!collapsed && item.badge !== undefined && item.badge > 0 && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                      {item.badge}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Collapse toggle */}
      <div className="border-t p-2" style={{ borderColor: "var(--sidebar-border)" }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-center rounded-md py-2 transition-colors"
          style={{ color: "var(--sidebar-muted)" }}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = "var(--sidebar-accent)"
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = "transparent"
          }}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>
    </aside>
  )
}
