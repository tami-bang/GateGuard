export type SessionUser = {
  id: string
  email: string
  name: string
  role: "Admin" | "Operator" | "Engineer"
}

type SessionPayload = {
  sub: string
  email: string
  name: string
  role: string
  iat: number
  exp: number
}

type PendingTwoFactorPayload = {
  sub: string
  email: string
  name: string
  role: string
  iat: number
  exp: number
  purpose: "2fa_pending"
}

const COOKIE_NAME = "gg_session"
const PENDING_2FA_COOKIE_NAME = "gg_2fa_pending"

const DEFAULT_MAX_AGE_SEC = 60 * 60 * 8
const DEFAULT_PENDING_2FA_MAX_AGE_SEC = 60 * 5

function getSecret(): string {
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

async function buildSignedCookie(
  cookieName: string,
  payload: Record<string, any>,
  maxAgeSec: number
) {
  const body = base64urlFromBytes(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await hmacSha256Base64url(getSecret(), body)
  const token = `${body}.${sig}`

  return {
    name: cookieName,
    value: token,
    maxAge: maxAgeSec,
  }
}

async function verifySignedToken<T>(token: string | undefined | null): Promise<T | null> {
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
    return payload as T
  } catch {
    return null
  }
}

export async function buildSessionCookie(user: SessionUser, maxAgeSec = DEFAULT_MAX_AGE_SEC) {
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + maxAgeSec,
  }

  return await buildSignedCookie(COOKIE_NAME, payload, maxAgeSec)
}

export async function buildPendingTwoFactorCookie(
  user: SessionUser,
  maxAgeSec = DEFAULT_PENDING_2FA_MAX_AGE_SEC
) {
  const now = Math.floor(Date.now() / 1000)
  const payload: PendingTwoFactorPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    purpose: "2fa_pending",
    iat: now,
    exp: now + maxAgeSec,
  }

  return await buildSignedCookie(PENDING_2FA_COOKIE_NAME, payload, maxAgeSec)
}

export function clearSessionCookie() {
  return { name: COOKIE_NAME, value: "", maxAge: 0 }
}

export function clearPendingTwoFactorCookie() {
  return { name: PENDING_2FA_COOKIE_NAME, value: "", maxAge: 0 }
}

export async function verifySessionCookie(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  return await verifySignedToken<SessionPayload>(token)
}

export async function verifyPendingTwoFactorCookie(
  token: string | undefined | null
): Promise<PendingTwoFactorPayload | null> {
  const payload = await verifySignedToken<PendingTwoFactorPayload>(token)
  if (!payload) return null
  if (payload.purpose !== "2fa_pending") return null
  return payload
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
export const SESSION_MAX_AGE_SEC = DEFAULT_MAX_AGE_SEC
export const PENDING_2FA_MAX_AGE_SEC = DEFAULT_PENDING_2FA_MAX_AGE_SEC
export const PENDING_2FA_COOKIE_NAME_EXPORT = PENDING_2FA_COOKIE_NAME
