import net from "net";
import { getKV, setKV } from "./db";
import { Subscription, extractConfigsList } from "./v2ray";

export interface PingSettings {
  mode: "auto" | "manual";
  intervalMinutes: number | "never";
  lastPingAllTime?: string;
  adminAlertFails?: string[]; // list of names/paths that failed all pings
}

export type NodeStatusType = "active" | "offline";

// Socket TCP Connection check
export function testPortConnection(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    let completed = false;
    const socket = new net.Socket();

    socket.setTimeout(timeoutMs);

    socket.connect(port, host, () => {
      if (!completed) {
        completed = true;
        socket.destroy();
        resolve(true); // Connected!
      }
    });

    socket.on("timeout", () => {
      if (!completed) {
        completed = true;
        socket.destroy();
        resolve(false); // Refused or timeout
      }
    });

    socket.on("error", () => {
      if (!completed) {
        completed = true;
        socket.destroy();
        resolve(false); // Refused or offline
      }
    });
  });
}

// Extract host and port using various V2Ray configuration/format attributes
export function extractHostAndPort(item: any): { host: string; port: number } | null {
  if (!item) return null;

  try {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (!trimmed) return null;

      // Match common URL sharing formats: e.g. vmess://..., vless://..., trojan://..., ss://...
      if (trimmed.includes("://")) {
        const urlPart = trimmed.split("://")[1] || "";
        // Match base64 decode if VMess or decode host:port query params
        if (trimmed.startsWith("vmess://")) {
          try {
            const b64Data = urlPart.trim();
            const decoded = Buffer.from(b64Data, "base64").toString("utf-8");
            const json = JSON.parse(decoded);
            if (json.add && json.port) {
              return { host: String(json.add).trim(), port: Number(json.port) };
            }
          } catch (e) {
            // parsing VMess b64 failed or string format directly
          }
        }

        // Match generic vless / ss / trojan format: text@host:port?query#remark
        // Or if it includes standard uri hostname:port
        const atIndex = urlPart.indexOf("@");
        let serverPart = atIndex !== -1 ? urlPart.substring(atIndex + 1) : urlPart;
        
        // Remove hash / queries
        if (serverPart.includes("#")) {
          serverPart = serverPart.split("#")[0];
        }
        if (serverPart.includes("?")) {
          serverPart = serverPart.split("?")[0];
        }

        // Match host:port
        const colonIndex = serverPart.lastIndexOf(":");
        if (colonIndex !== -1) {
          const host = serverPart.substring(0, colonIndex).replace("[", "").replace("]", "").trim();
          const port = parseInt(serverPart.substring(colonIndex + 1));
          if (host && !isNaN(port)) {
            return { host, port };
          }
        }
      }
    } else if (typeof item === "object") {
      // Check standard JSON properties directly
      const host = item.add || item.server || item.host || item.address;
      const port = item.port ? Number(item.port) : null;
      if (host && port && !isNaN(port)) {
        return { host: String(host).trim(), port };
      }
    }
  } catch (err) {
    // ignore parsing fails
  }

  return null;
}

// Main operational health pinger
export async function pingAllSubscriptions(): Promise<PingSettings> {
  const SUBS_DB_KEY = "v2ray_subscriptions_list";
  const SETTINGS_KEY = "v2ray_ping_settings";

  // Load subscriptions and ping configurations
  const subs = await getKV<any[]>(SUBS_DB_KEY) || [];
  const settingsDef = await getKV<PingSettings>(SETTINGS_KEY) || {
    mode: "auto",
    intervalMinutes: 15,
  };

  const failedSubscriptions: string[] = [];
  const updatedSubs = await Promise.all(
    subs.map(async (sub) => {
      const configs = extractConfigsList(sub.jsonConfigs || "");
      if (configs.length === 0) {
        // No parseable config inside. Retain current state or active by default
        return {
          ...sub,
          nodeStatuses: {},
          lastPingedAt: new Date().toISOString(),
        };
      }

      const nodeStatuses: Record<string, NodeStatusType> = {};
      let activeNodesCount = 0;
      let checkableNodesCount = 0;

      // Parallel TCP testing for configs of this sub
      await Promise.all(
        configs.map(async (config, idx) => {
          const target = extractHostAndPort(config);
          const keyIdx = String(idx);
          if (target && target.host && target.port) {
            checkableNodesCount++;
            const isOnline = await testPortConnection(target.host, target.port);
            if (isOnline) {
              nodeStatuses[keyIdx] = "active";
              activeNodesCount++;
            } else {
              nodeStatuses[keyIdx] = "offline";
            }
          } else {
            // Uncheckable / special node counts as active to avoid false offline alarm
            nodeStatuses[keyIdx] = "active";
          }
        })
      );

      // Status rule: if at least ONE checked node is online, sub is active. Otherwise, offline.
      // If there were no checkable nodes, we keep active.
      let finalStatus: NodeStatusType = "active";
      if (checkableNodesCount > 0 && activeNodesCount === 0) {
        finalStatus = "offline";
        failedSubscriptions.push(sub.name || sub.path);
      }

      return {
        ...sub,
        status: finalStatus,
        nodeStatuses,
        lastPingedAt: new Date().toISOString(),
      };
    })
  );

  // Persist updated states to Subscription DB Key-Value Store
  await setKV(SUBS_DB_KEY, updatedSubs);

  // Update ping status timestamp
  const updatedSettings: PingSettings = {
    ...settingsDef,
    lastPingAllTime: new Date().toISOString(),
    adminAlertFails: failedSubscriptions,
  };
  await setKV(SETTINGS_KEY, updatedSettings);

  return updatedSettings;
}

// Singleton global background daemon interval manager
const globalForPing = globalThis as unknown as {
  healthIntervalRef: NodeJS.Timeout | undefined;
  activeIntervalMinutes: number | "never" | undefined;
};

export async function startHealthPingScheduler() {
  const SETTINGS_KEY = "v2ray_ping_settings";
  const settings = await getKV<PingSettings>(SETTINGS_KEY) || {
    mode: "auto",
    intervalMinutes: 15,
  };

  // If in manual or never ping, clear any background ticker
  if (settings.mode === "manual" || settings.intervalMinutes === "never") {
    if (globalForPing.healthIntervalRef) {
      clearInterval(globalForPing.healthIntervalRef);
      globalForPing.healthIntervalRef = undefined;
      globalForPing.activeIntervalMinutes = undefined;
      console.log("[HealthScheduler] Automatic periodic health checkers disabled manually.");
    }
    return;
  }

  const intervalMin = Number(settings.intervalMinutes) || 15;

  // Setup/restart timer if interval value changed or hasn't started yet
  if (
    !globalForPing.healthIntervalRef ||
    globalForPing.activeIntervalMinutes !== intervalMin
  ) {
    if (globalForPing.healthIntervalRef) {
      clearInterval(globalForPing.healthIntervalRef);
    }

    globalForPing.activeIntervalMinutes = intervalMin;
    const intervalMs = intervalMin * 60 * 1000;

    console.log(`[HealthScheduler] Starting periodic pinger. Checking all node sub ports every ${intervalMin} minutes.`);

    globalForPing.healthIntervalRef = setInterval(async () => {
      try {
        console.log("[HealthScheduler] Triggering periodic background connection checks...");
        await pingAllSubscriptions();
      } catch (err) {
        console.error("[HealthScheduler] Background connection check failed:", err);
      }
    }, intervalMs);

    // Run first diagnostic check asynchronously to populate health tables immediately
    Promise.resolve().then(async () => {
      try {
        await pingAllSubscriptions();
      } catch (e) {
        // ignore
      }
    });
  }
}
