"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { type User, type UserRole } from "./mock-data"

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  bootstrapped: boolean
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  hasAccess: (page: string) => boolean
}

const allPages = ["dashboard", "logs", "incidents", "policies", "ai-analysis", "audit-log"]
const roleAccessMap: Record<UserRole, string[]> = {
  Admin: allPages,
  Operator: ["dashboard", "logs", "incidents", "policies", "audit-log"],
  Engineer: ["dashboard", "logs", "incidents", "ai-analysis", "audit-log"],
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/auth/me", { method: "GET", cache: "no-store" })
        if (!res.ok) {
          if (!cancelled) setUser(null)
          return
        }
        const data = await res.json()
        if (!cancelled) setUser(data.user ?? null)
      } finally {
        if (!cancelled) setBootstrapped(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) return false
    const data = await res.json()
    setUser(data.user ?? null)
    return true
  }, [])

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
    setUser(null)
  }, [])

  const hasAccess = useCallback(
    (page: string) => {
      if (!user) return false
      return roleAccessMap[user.role].includes(page)
    },
    [user]
  )

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, bootstrapped, login, logout, hasAccess }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider")
  return context
}
