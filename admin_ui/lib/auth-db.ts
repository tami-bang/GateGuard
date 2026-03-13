import "server-only"

import mysql from "mysql2/promise"

export type DbUserAccount = {
  user_id: number
  email: string
  password_hash: string
  name: string
  role: "ADMIN" | "OPERATOR" | "ENGINEER"
  is_active: number
  created_at: string
  updated_at: string | null
}

function getDbConfig() {
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER || "gateguard",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "gateguard",
  }
}

export async function getDbConnection() {
  return await mysql.createConnection(getDbConfig())
}

export async function findUserByEmail(email: string): Promise<DbUserAccount | null> {
  const conn = await getDbConnection()
  try {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `
      SELECT
        user_id,
        email,
        password_hash,
        name,
        role,
        is_active,
        created_at,
        updated_at
      FROM user_account
      WHERE email = ?
      LIMIT 1
      `,
      [email]
    )

    if (!rows.length) return null
    return rows[0] as unknown as DbUserAccount
  } finally {
    await conn.end()
  }
}

export async function insertUserAccount(params: {
  email: string
  passwordHash: string
  name: string
  role?: "ADMIN" | "OPERATOR" | "ENGINEER"
}) {
  const conn = await getDbConnection()
  try {
    const [result] = await conn.execute<mysql.ResultSetHeader>(
      `
      INSERT INTO user_account (
        email,
        password_hash,
        name,
        role,
        is_active
      ) VALUES (?, ?, ?, ?, 1)
      `,
      [
        params.email,
        params.passwordHash,
        params.name,
        params.role ?? "OPERATOR",
      ]
    )

    return result.insertId
  } finally {
    await conn.end()
  }
}

export function mapDbRoleToUiRole(
  role: string
): "Admin" | "Operator" | "Engineer" {
  if (role === "ADMIN") return "Admin"
  if (role === "ENGINEER") return "Engineer"
  return "Operator"
}
