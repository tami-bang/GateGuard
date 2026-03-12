"use client"

import Image from "next/image"
import { useEffect, useState } from "react"

type GateGuardSplashProps = {
  visible: boolean
  onDone?: () => void
  durationMs?: number
}

export function GateGuardSplash({
  visible,
  onDone,
  durationMs = 1500,
}: GateGuardSplashProps) {
  const [shouldRender, setShouldRender] = useState(visible)
  const [isLeaving, setIsLeaving] = useState(false)
  const [dotCount, setDotCount] = useState(1)

  useEffect(() => {
    if (!visible) {
      setShouldRender(false)
      setIsLeaving(false)
      return
    }

    setShouldRender(true)
    setIsLeaving(false)

    const leaveTimer = window.setTimeout(() => {
      setIsLeaving(true)
    }, Math.max(durationMs - 320, 300))

    const doneTimer = window.setTimeout(() => {
      setShouldRender(false)
      setIsLeaving(false)
      onDone?.()
    }, durationMs)

    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(doneTimer)
    }
  }, [visible, durationMs, onDone])

  useEffect(() => {
    if (!shouldRender) return

    const interval = window.setInterval(() => {
      setDotCount((prev) => (prev >= 3 ? 1 : prev + 1))
    }, 280)

    return () => {
      window.clearInterval(interval)
    }
  }, [shouldRender])

  if (!shouldRender) return null

  return (
    <div
      className={[
        "fixed inset-0 z-[100] flex items-center justify-center",
        "bg-[rgba(11,18,32,0.82)] backdrop-blur-xl",
        "transition-opacity duration-300",
        isLeaving ? "opacity-0" : "opacity-100",
      ].join(" ")}
      aria-hidden="true"
    >
      <div
        className={[
          "flex flex-col items-center justify-center text-center",
          "transition-all duration-500",
          isLeaving
            ? "translate-y-1 scale-[0.985] opacity-0"
            : "translate-y-0 scale-100 opacity-100",
        ].join(" ")}
      >
        <div className="relative flex items-center justify-center">
          <div className="absolute h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="absolute h-48 w-48 rounded-full border border-blue-400/10" />
          <div className="absolute h-64 w-64 rounded-full border border-blue-400/8" />

          <div className="relative animate-[gg-logo-enter_420ms_ease-out]">
            <Image
              src="/branding/gateguard-logo.png"
              alt="GateGuard"
              width={1200}
              height={800}
              priority
              className="h-auto w-[380px] translate-y-6 select-none object-contain md:w-[500px] lg:w-[580px]"
            />
          </div>
        </div>

        <div className="mt-5 animate-[gg-text-enter_480ms_ease-out]">
          <p className="text-sm text-slate-300 md:text-[0.95rem]">
            Initializing Security Engine{".".repeat(dotCount)}
          </p>
        </div>
      </div>
    </div>
  )
}
