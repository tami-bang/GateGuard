import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { AuthProvider } from "@/lib/auth-context"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: "GateGuard SOC",
  description: "GateGuard Admin UI",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // next start는 NODE_ENV=production이라 로컬에서도 true가 되어버림
  // Vercel 배포 환경에서만 Analytics 렌더링
  const showAnalytics = process.env.VERCEL === "1"

  return (
    <html lang="en">
      <body className={`${inter.variable} ${mono.variable}`}>
        <AuthProvider>{children}</AuthProvider>
        {showAnalytics ? <Analytics /> : null}
      </body>
    </html>
  )
}
