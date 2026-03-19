"use client"

import { useMemo, useState } from "react"
import { usePathname } from "next/navigation"
import { CircleHelp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHelpDialog } from "@/components/page-help-dialog"
import { getPageHelp } from "@/lib/page-help"

export function PageHelpFab() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const helpContent = useMemo(() => getPageHelp(pathname || "/"), [pathname])

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          type="button"
          size="icon"
          className="size-12 rounded-full shadow-lg"
          onClick={() => setOpen(true)}
          aria-label="Open page help"
        >
          <CircleHelp className="size-5" />
        </Button>
      </div>

      <PageHelpDialog open={open} onOpenChange={setOpen} content={helpContent} />
    </>
  )
}
