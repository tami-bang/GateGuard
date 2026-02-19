"use client"

import { useAuth } from "@/lib/auth-context"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, LogOut, User } from "lucide-react"

const roleBadgeColors: Record<string, string> = {
  Admin: "bg-[#2563EB] text-white",
  Operator: "bg-success text-white",
  Engineer: "bg-warning text-white",
}

export function AppHeader() {
  const { user, logout } = useAuth()
  const router = useRouter()

  if (!user) return null

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-6">
      <div />
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-muted outline-none">
          <div className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            {user.name.split(" ").map(n => n[0]).join("")}
          </div>
          <span className="font-medium text-foreground">{user.name}</span>
          <Badge className={roleBadgeColors[user.role] + " text-[10px] px-1.5 py-0 border-0"}>
            {user.role}
          </Badge>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="font-normal">
            <div className="text-sm font-medium">{user.name}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <User className="mr-2 size-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              logout()
              router.push("/")
            }}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 size-4" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
