import { NextRequest } from "next/server";
import { getKV, setKV } from "./db";
import crypto from "crypto";

const SESSION_KEY = "admin_active_session_token";
const ADMINS_LIST_KEY = "v2ray_administrators_list";
const SESSIONS_MAP_KEY = "v2ray_active_sessions_map";

export interface Admin {
  username: string;
  name: string;
  passwordHash: string;
  level: number; // 3: Super Admin, 2: Editor (Admin), 1: Viewer (Support)
  description: string;
  createdAt: string;
  updatedAt: string;
}

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "admin123";
}

export async function getAdminsList(): Promise<Admin[]> {
  const list = await getKV<Admin[]>(ADMINS_LIST_KEY);
  if (list && list.length > 0) {
    // If has list, ensure master username admin exists and is up to date with ADMIN_PASSWORD
    const masterPass = getAdminPassword();
    const hasAdmin = list.some(a => a.username.toLowerCase() === "admin");
    if (!hasAdmin) {
      const defaultMaster: Admin = {
        username: "admin",
        name: "System Super Admin",
        passwordHash: hashPassword(masterPass),
        level: 3,
        description: "System default master administration account",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      list.push(defaultMaster);
      await saveAdminsList(list);
    }
    return list;
  }
  
  // Seed initial system administrator
  const masterPassword = getAdminPassword();
  const defaultMaster: Admin = {
    username: "admin",
    name: "System Super Admin",
    passwordHash: hashPassword(masterPassword),
    level: 3,
    description: "System default master administration account",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  await setKV(ADMINS_LIST_KEY, [defaultMaster]);
  return [defaultMaster];
}

export async function saveAdminsList(list: Admin[]): Promise<void> {
  await setKV(ADMINS_LIST_KEY, list);
}

export async function getLoggedInUser(req: NextRequest): Promise<Admin | null> {
  const sessionToken = req.cookies.get("admin_session")?.value;
  if (!sessionToken) return null;

  const sessions = await getKV<Record<string, { username: string; expiresAt: string }>>(SESSIONS_MAP_KEY) || {};
  const sess = sessions[sessionToken];
  
  if (!sess) {
    // Check backward compatibility for the old single token format
    const oldToken = await getKV<string>(SESSION_KEY);
    if (oldToken && oldToken === sessionToken) {
      const admins = await getAdminsList();
      const master = admins.find(a => a.username.toLowerCase() === "admin") || admins[0];
      return master || null;
    }
    return null;
  }

  // Check expiration date
  if (new Date(sess.expiresAt) < new Date()) {
    delete sessions[sessionToken];
    await setKV(SESSIONS_MAP_KEY, sessions);
    return null;
  }

  const admins = await getAdminsList();
  const matchedAdmin = admins.find(a => a.username.toLowerCase() === sess.username.toLowerCase());
  return matchedAdmin || null;
}

export async function checkAuth(req: NextRequest): Promise<boolean> {
  const user = await getLoggedInUser(req);
  return user !== null;
}

export async function checkAuthWithLevel(req: NextRequest, minLevel: number): Promise<boolean> {
  const user = await getLoggedInUser(req);
  if (!user) return false;
  return user.level >= minLevel;
}

export async function createSession(password: string): Promise<string | null> {
  // Backwards compatibility fallback (e.g. login with password only defaults to admin user)
  const result = await createAdminSession("admin", password);
  return result ? result.token : null;
}

export async function createAdminSession(username: string, password: string): Promise<{ token: string; user: Admin } | null> {
  const userString = (username || "admin").trim().toLowerCase();
  const admins = await getAdminsList();
  const matchedAdmin = admins.find(a => a.username.toLowerCase() === userString);

  if (!matchedAdmin) {
    return null;
  }

  const typedHash = hashPassword(password);
  
  // Special override for master admin env variable check
  if (userString === "admin") {
    const masterPassword = getAdminPassword();
    if (password !== masterPassword && typedHash !== matchedAdmin.passwordHash) {
      return null;
    }
    
    // Auto sync master hash if password changes in process.env
    if (password === masterPassword && typedHash !== matchedAdmin.passwordHash) {
      matchedAdmin.passwordHash = typedHash;
      matchedAdmin.updatedAt = new Date().toISOString();
      await saveAdminsList(admins);
    }
  } else {
    // Standard user password comparison
    if (typedHash !== matchedAdmin.passwordHash) {
      return null;
    }
  }

  const randomToken = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  const sessions = await getKV<Record<string, { username: string; expiresAt: string }>>(SESSIONS_MAP_KEY) || {};
  sessions[randomToken] = {
    username: matchedAdmin.username,
    expiresAt: expiresAt.toISOString(),
  };

  await setKV(SESSIONS_MAP_KEY, sessions);
  
  if (userString === "admin") {
    await setKV(SESSION_KEY, randomToken);
  }

  return { token: randomToken, user: matchedAdmin };
}

export async function clearSession(): Promise<void> {
  await setKV(SESSION_KEY, null);
}

export async function clearSessionByToken(token: string): Promise<void> {
  const sessions = await getKV<Record<string, { username: string; expiresAt: string }>>(SESSIONS_MAP_KEY) || {};
  if (sessions[token]) {
    delete sessions[token];
    await setKV(SESSIONS_MAP_KEY, sessions);
  }
}
