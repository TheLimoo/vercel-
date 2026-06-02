import { NextRequest } from "next/server";
import { getKV, setKV } from "./db";

const SESSION_KEY = "admin_active_session_token";

export async function checkAuth(req: NextRequest): Promise<boolean> {
  const sessionToken = req.cookies.get("admin_session")?.value;
  if (!sessionToken) return false;

  // Read registered valid token from DB
  const validToken = await getKV<string>(SESSION_KEY);
  if (!validToken) return false;

  return sessionToken === validToken;
}

export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "admin123";
}

export async function createSession(password: string): Promise<string | null> {
  const adminPassword = getAdminPassword();
  if (password !== adminPassword) {
    return null;
  }

  // Generate a random stable token
  const randomToken = crypto.randomUUID();
  await setKV(SESSION_KEY, randomToken);
  return randomToken;
}

export async function clearSession(): Promise<void> {
  await setKV(SESSION_KEY, null);
}
