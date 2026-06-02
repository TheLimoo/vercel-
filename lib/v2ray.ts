// Interface for subscription dummy configs
export interface DummyConfig {
  id: string;
  name: string;        // E.g., "⏳ Server expires: 2026-12-31" or "📢 Announcement: System is healthy!"
  protocol: "vless" | "vmess" | "trojan" | "ss" | "info";
  targetHost: string;  // Visual node details
}

export interface Subscription {
  id: string;
  name: string;
  path: string; // url sub path
  remarksTemplate: string; // e.g. "VIP Server - *"
  jsonConfigs: string; // holds raw input config data
  dummyConfigs: DummyConfig[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Normalizes input text which might be a JSON list or plaintext newline-separated list of configs.
 */
export function extractConfigsList(rawInput: string): string[] {
  if (!rawInput || !rawInput.trim()) return [];

  const trimmed = rawInput.trim();

  // Try parsing file as a JSON
  try {
    const data = JSON.parse(trimmed);
    if (Array.isArray(data)) {
      return data.flatMap(item => {
        if (typeof item === "string") return [item];
        if (item && typeof item === "object") {
          // Check for common properties like url, config, path
          const possible = item.url || item.config || item.link || item.ps || "";
          if (possible && typeof possible === "string" && possible.includes("://")) {
            return [possible];
          }
        }
        return [];
      });
    } else if (data && typeof data === "object") {
      // Look for a config array inside standard keys
      const possibleArrays = [data.configs, data.nodes, data.servers, data.proxies, data.links];
      for (const arr of possibleArrays) {
        if (Array.isArray(arr)) {
          return arr.map(x => (typeof x === "string" ? x : x.url || x.config || x.link || "")).filter(Boolean);
        }
      }
    }
  } catch {
    // Treat as raw text parsing
  }

  // Fallback to splitting by newlines or spaces
  return trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && (line.includes("://") || line.length > 20));
}

/**
 * Modifies the remarks (display name) of a standard V2Ray share link config.
 */
export function updateConfigRemark(configUrl: string, remark: string): string {
  try {
    const trimmed = configUrl.trim();
    if (!trimmed) return "";

    // 1. VMESS format: vmess://<base64_json_obj>
    if (trimmed.startsWith("vmess://")) {
      const b64Data = trimmed.substring(8);
      try {
        const decoded = Buffer.from(b64Data, "base64").toString("utf-8");
        const json = JSON.parse(decoded);
        
        // Update the remarks field (ps)
        json.ps = remark;
        
        const updatedB64 = Buffer.from(JSON.stringify(json), "utf-8").toString("base64");
        return `vmess://${updatedB64}`;
      } catch (err) {
        // Fallback for malformed base64
        return trimmed;
      }
    }

    // 2. VLESS, Trojan, SS, etc. format: protocol://credentials@host:port?query#oldRemark
    if (
      trimmed.startsWith("vless://") ||
      trimmed.startsWith("trojan://") ||
      trimmed.startsWith("ss://")
    ) {
      // Split by '#'
      const hashIndex = trimmed.indexOf("#");
      const basePart = hashIndex !== -1 ? trimmed.substring(0, hashIndex) : trimmed;
      
      // Return updated anchor hash segment
      return `${basePart}#${encodeURIComponent(remark)}`;
    }

    return trimmed;
  } catch (err) {
    console.error("Failed to update config remark for link: ", configUrl, err);
    return configUrl;
  }
}

/**
 * Generates VLESS formatted dummy configuration with info string.
 */
export function buildDummyConfigLink(dummy: DummyConfig): string {
  const host = dummy.targetHost || "127.0.0.1";
  const idStr = "00000000-0000-0000-0000-000000000000";
  const nameEncoded = encodeURIComponent(dummy.name);
  
  if (dummy.protocol === "info") {
    // A clean info visual standard
    return `vless://${idStr}@${host}:443?encryption=none&security=tls&type=tcp#${nameEncoded}`;
  }
  
  return `${dummy.protocol}://${idStr}@${host}:1337?encryption=none&security=none#${nameEncoded}`;
}

/**
 * Processes full subscription list.
 */
export function generateProcessedSubscriptionText(sub: Subscription): string {
  const configsList = extractConfigsList(sub.jsonConfigs);
  const processedLines: string[] = [];

  // 1. Append dummy announcement/info configs first
  if (sub.dummyConfigs && sub.dummyConfigs.length > 0) {
    sub.dummyConfigs.forEach(dummy => {
      processedLines.push(buildDummyConfigLink(dummy));
    });
  }

  // 2. Parse and append processed parsed configs
  const template = sub.remarksTemplate || "Server *";
  configsList.forEach((confClean, index) => {
    const oneBasedIndex = index + 1;
    // Replace '*' with auto-increment number, if * exists
    const remarkName = template.includes("*")
      ? template.replaceAll("*", String(oneBasedIndex))
      : `${template} ${oneBasedIndex}`;
      
    const updated = updateConfigRemark(confClean, remarkName);
    if (updated) {
      processedLines.push(updated);
    }
  });

  return processedLines.join("\n");
}
