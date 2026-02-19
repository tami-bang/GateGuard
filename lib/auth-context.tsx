"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { type User, type UserRole, mockUsers } from "./mock-data"

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  login: (email: string, password: string) => boolean
  logout: () => void
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

  const login = useCallback((email: string, _password: string) => {
    const found = mockUsers.find(u => u.email === email)
    if (found) {
      setUser(found)
      return true
    }
    // Default to first user if email matches pattern
    if (email.includes("@")) {
      setUser(mockUsers[0])
      return true
    }
    return false
  }, [])

  const logout = useCallback(() => {
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
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout, hasAccess }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
