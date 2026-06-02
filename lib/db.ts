import fs from "fs";
import path from "path";

const LOCAL_STORE_PATH = path.join(process.cwd(), "v2ray_kv_store.json");

// Define high-level database helper
export async function getKV<T>(key: string): Promise<T | null> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (url && token) {
    try {
      // Connect to Vercel KV / Upstash Redis via standard REST API
      const response = await fetch(`${url}/get/${key}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Vercel KV HTTP error: ${response.status}`);
      }

      const data = await response.json();
      if (data.result === null || data.result === undefined) {
        return null;
      }

      // Vercel KV stores stringified JSON if we save objects, parse if valid string
      try {
        return JSON.parse(data.result) as T;
      } catch {
        return data.result as T;
      }
    } catch (err) {
      console.error("Vercel KV failed, pulling from local storage: ", err);
    }
  }

  // Fallback to local file filesystem storage
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const content = fs.readFileSync(LOCAL_STORE_PATH, "utf-8");
      const store = JSON.parse(content);
      return (store[key] as T) || null;
    }
  } catch (err) {
    console.error("Local store read failed:", err);
  }
  return null;
}

export async function setKV<T>(key: string, value: T): Promise<void> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  const valueStr = typeof value === "string" ? value : JSON.stringify(value);

  if (url && token) {
    try {
      // Vercel KV Set Command via POST REST API on /set/key
      const response = await fetch(`${url}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(["set", key, valueStr]),
      });

      if (response.ok) {
        return;
      }
      console.warn("Vercel KV Set via POST status:", response.status);
    } catch (err) {
      console.error("Vercel KV save failed, falling back to local file:", err);
    }
  }

  // Fallback / Local persistent File Storage
  try {
    let store: Record<string, any> = {};
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      try {
        const content = fs.readFileSync(LOCAL_STORE_PATH, "utf-8");
        store = JSON.parse(content);
      } catch {
        store = {};
      }
    }
    store[key] = value;
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("Local store write failed:", err);
    throw err;
  }
}
