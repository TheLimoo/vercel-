import { NextRequest, NextResponse } from "next/server";
import { checkAuthWithLevel } from "@/lib/auth";
import { createClient } from "@libsql/client";
import { setKV } from "@/lib/db";

function getClient() {
  const url = process.env.TURSO_DATABASE_URL || "file:v2ray_local.db";
  const authToken = process.env.TURSO_AUTH_TOKEN || "";
  return createClient({ url, authToken });
}

export async function GET(req: NextRequest) {
  const isAuthorized = await checkAuthWithLevel(req, 2);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = getClient();
    const res = await client.execute("SELECT key, value FROM kv_store ORDER BY key ASC");
    const rows = res.rows.map(row => ({
      key: String(row.key),
      value: String(row.value),
    }));

    return NextResponse.json({ success: true, rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const isAuthorized = await checkAuthWithLevel(req, 2);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized. Editor (Level 2) access is required." }, { status: 403 });
  }

  try {
    const { key, value } = await req.json();
    if (!key) {
      return NextResponse.json({ error: "Key is required" }, { status: 400 });
    }

    // Attempt to parse JSON if possible to save it in standard object format
    let finalValue: any = value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          finalValue = JSON.parse(trimmed);
        } catch (e) {
          // ignore parsing error and save as raw string
        }
      }
    }

    await setKV(key, finalValue);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const isAuthorized = await checkAuthWithLevel(req, 2);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized. Editor (Level 2) access is required." }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "Key is required" }, { status: 400 });
    }

    const client = getClient();
    await client.execute({
      sql: "DELETE FROM kv_store WHERE key = ?",
      args: [key],
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
