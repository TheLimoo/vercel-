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
    await client.execute(`
      CREATE TABLE IF NOT EXISTS sub_access_metrics (
        sub_path TEXT NOT NULL,
        ip TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        hwid TEXT NOT NULL,
        device_type TEXT NOT NULL,
        access_count INTEGER DEFAULT 1,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (sub_path, ip, user_agent, hwid)
      )
    `);
    isTableEnsured = true;
  } catch (err) {
    console.error("Failed to initialize system tables in Turso/SQLite:", err);
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

export interface AccessMetric {
  sub_path: string;
  ip: string;
  user_agent: string;
  hwid: string;
  device_type: string;
  access_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export async function logSubAccess(
  subPath: string,
  ip: string,
  ua: string,
  hwid: string,
  deviceType: string
): Promise<void> {
  try {
    await ensureTable();
    const client = getClient();
    const now = new Date().toISOString();

    await client.execute({
      sql: `
        INSERT INTO sub_access_metrics (sub_path, ip, user_agent, hwid, device_type, access_count, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT (sub_path, ip, user_agent, hwid) DO UPDATE SET
          access_count = access_count + 1,
          last_seen_at = excluded.last_seen_at,
          device_type = CASE WHEN excluded.device_type != '' THEN excluded.device_type ELSE device_type END
      `,
      args: [subPath.toLowerCase(), ip, ua, hwid, deviceType, now, now]
    });
  } catch (err) {
    console.error(`logSubAccess failed for path "${subPath}":`, err);
  }
}

export async function getSubAccessMetrics(subPath?: string): Promise<AccessMetric[]> {
  try {
    await ensureTable();
    const client = getClient();
    
    let res;
    if (subPath) {
      res = await client.execute({
        sql: "SELECT * FROM sub_access_metrics WHERE sub_path = ? ORDER BY last_seen_at DESC",
        args: [subPath.toLowerCase()]
      });
    } else {
      res = await client.execute("SELECT * FROM sub_access_metrics ORDER BY last_seen_at DESC");
    }

    return res.rows.map(row => ({
      sub_path: String(row.sub_path),
      ip: String(row.ip),
      user_agent: String(row.user_agent),
      hwid: String(row.hwid),
      device_type: String(row.device_type),
      access_count: Number(row.access_count),
      first_seen_at: String(row.first_seen_at),
      last_seen_at: String(row.last_seen_at)
    }));
  } catch (err) {
    console.error("getSubAccessMetrics failed:", err);
    return [];
  }
}

export async function deleteSubAccessMetrics(subPath: string): Promise<void> {
  try {
    await ensureTable();
    const client = getClient();
    await client.execute({
      sql: "DELETE FROM sub_access_metrics WHERE sub_path = ?",
      args: [subPath.toLowerCase()]
    });
  } catch (err) {
    console.error("deleteSubAccessMetrics failed:", err);
  }
}

