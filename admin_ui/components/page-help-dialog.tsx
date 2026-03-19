"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { PageHelpContent } from "@/lib/page-help"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  content: PageHelpContent
}

export function PageHelpDialog({ open, onOpenChange, content }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>{content.title}</DialogTitle>
          <DialogDescription>{content.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-2">
          {content.sections.map((section) => (
            <section key={section.title} className="rounded-lg border p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">{section.title}</h3>
              <div className="flex flex-col gap-2">
                {section.body.map((line, index) => (
                  <p key={`${section.title}-${index}`} className="text-sm leading-6 text-muted-foreground">
                    {line}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
