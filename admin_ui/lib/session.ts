import { type User } from "./mock-data"

const COOKIE_NAME = "gg_session"
const DEFAULT_MAX_AGE_SEC = 60 * 60 * 8 // 8 hours

function getSecret(): string {
  // Edge에서도 빌드 시점에 주입되는 env는 접근 가능
  return process.env.GG_SESSION_SECRET || "dev-secret-change-me"
}

function base64urlFromBytes(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const b64 = btoa(binary)
  return b64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
}

function bytesFromBase64url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/")
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4))
  const binary = atob(b64 + pad)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function hmacSha256Base64url(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data))
  return base64urlFromBytes(new Uint8Array(sig))
}

export async function buildSessionCookie(user: User, maxAgeSec = DEFAULT_MAX_AGE_SEC) {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + maxAgeSec,
  }

  const body = base64urlFromBytes(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await hmacSha256Base64url(getSecret(), body)
  const token = `${body}.${sig}`

  return {
    name: COOKIE_NAME,
    value: token,
    maxAge: maxAgeSec,
  }
}

export function clearSessionCookie() {
  return { name: COOKIE_NAME, value: "", maxAge: 0 }
}

export async function verifySessionCookie(
  token: string | undefined | null
): Promise<null | { sub: string; email: string; name: string; role: string; iat: number; exp: number }> {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length !== 2) return null

  const [body, sig] = parts
  const expected = await hmacSha256Base64url(getSecret(), body)
  if (sig !== expected) return null

  try {
    const json = new TextDecoder().decode(bytesFromBase64url(body))
    const payload = JSON.parse(json)
    const now = Math.floor(Date.now() / 1000)
    if (!payload?.exp || now >= payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
export const SESSION_MAX_AGE_SEC = DEFAULT_MAX_AGE_SEC
