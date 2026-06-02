import { createClient } from "@libsql/client";

let clientInstance: ReturnType<typeof createClient> | null = null;
let isTableEnsured = false;

function getClient() {
  if (clientInstance) return clientInstance;

  const url = process.env.TURSO_DATABASE_URL || "file:v2ray_local.db";
  const authToken = process.env.TURSO_AUTH_TOKEN || "";

  clientInstance = createClient({
    url,
    authToken,
  });
  
  return clientInstance;
}

async function ensureTable() {
  if (isTableEnsured) return;
  const client = getClient();
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    isTableEnsured = true;
  } catch (err) {
    console.error("Failed to initialize kv_store table in Turso/SQLite:", err);
  }
}

// Define high-level database helper
export async function getKV<T>(key: string): Promise<T | null> {
  try {
    await ensureTable();
    const client = getClient();
    const res = await client.execute({
      sql: "SELECT value FROM kv_store WHERE key = ?",
      args: [key],
    });

    if (res.rows.length === 0) {
      return null;
    }

    const rawValue = res.rows[0].value;
    if (rawValue === null || rawValue === undefined) {
      return null;
    }

    const strValue = String(rawValue);

    // Parse back if it looks like a stringified JSON object or array, otherwise return as string
    try {
      if ((strValue.startsWith("{") && strValue.endsWith("}")) || (strValue.startsWith("[") && strValue.endsWith("]"))) {
        return JSON.parse(strValue) as T;
      }
    } catch {
      // Return as text if parse fails
    }

    return strValue as unknown as T;
  } catch (err) {
    console.error(`getKV failed for key "${key}":`, err);
    return null;
  }
}

export async function setKV<T>(key: string, value: T): Promise<void> {
  try {
    await ensureTable();
    const client = getClient();

    let valueStr: string;
    if (value === null || value === undefined) {
      valueStr = "";
    } else if (typeof value === "string") {
      valueStr = value;
    } else {
      valueStr = JSON.stringify(value);
    }

    await client.execute({
      sql: "INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [key, valueStr],
    });
  } catch (err) {
    console.error(`setKV failed for key "${key}":`, err);
    throw err;
  }
}
