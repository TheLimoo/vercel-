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
export function extractConfigsList(rawInput: string): (string | any)[] {
  if (!rawInput || !rawInput.trim()) return [];

  const trimmed = rawInput.trim();

  // Try parsing file as a JSON
  try {
    const data = JSON.parse(trimmed);
    if (Array.isArray(data)) {
      return data.flatMap(item => {
        if (!item) return [];
        if (typeof item === "string") return [item];
        if (typeof item === "object") {
          // Check if it's a share link nested inside a simple field
          const possible = item.url || item.config || item.link || "";
          if (possible && typeof possible === "string" && possible.includes("://")) {
            return [possible];
          }
          // Otherwise, if it has standard properties of a V2Ray JSON config, treat as config object
          if (item.remarks || item.outbounds || item.inbounds) {
            return [item];
          }
        }
        return [];
      });
    } else if (data && typeof data === "object") {
      // Check if it's a single raw config object instead of an array
      if (data.remarks || data.outbounds || data.inbounds) {
        return [data];
      }
      // Look for standard arrays inside config wrapper
      const possibleArrays = [data.configs, data.nodes, data.servers, data.proxies, data.links];
      for (const arr of possibleArrays) {
        if (Array.isArray(arr)) {
          return arr.flatMap(x => {
            if (!x) return [];
            if (typeof x === "string") return [x];
            if (typeof x === "object") {
              const possible = x.url || x.config || x.link || "";
              if (possible && typeof possible === "string" && possible.includes("://")) {
                return [possible];
              }
              if (x.remarks || x.outbounds || x.inbounds) {
                return [x];
              }
            }
            return [];
          });
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
 * Converts a V2Ray/Xray JSON configuration object into its equivalent share link structure.
 */
export function convertJsonConfigToShareLink(obj: any): string {
  try {
    if (!obj || typeof obj !== "object") return "";
    const remark = obj.remarks || "Config";
    
    // Locate the first non-direct protocol outbound
    const outbounds = obj.outbounds || [];
    const proxyOutbound = outbounds.find((o: any) => 
      o && (o.protocol === "vless" || o.protocol === "vmess" || o.protocol === "trojan" || o.protocol === "shadowsocks" || o.protocol === "ss")
    ) || outbounds[0];

    if (!proxyOutbound) return "";

    const protocol = proxyOutbound.protocol;
    
    if (protocol === "vless") {
      const vnext = proxyOutbound.settings?.vnext?.[0];
      if (!vnext) return "";
      const address = vnext.address;
      const port = vnext.port;
      const user = vnext.users?.[0];
      const id = user?.id;
      const encryption = user?.encryption || "none";

      const streamSettings = proxyOutbound.streamSettings || {};
      const network = streamSettings.network || "tcp";
      const security = streamSettings.security || "none";

      const queryParams: string[] = [];
      queryParams.push(`encryption=${encryption}`);
      queryParams.push(`security=${security}`);
      queryParams.push(`type=${network}`);

      if (security === "tls") {
        const tlsSettings = streamSettings.tlsSettings || {};
        if (tlsSettings.serverName) {
          queryParams.push(`sni=${tlsSettings.serverName}`);
        }
      }

      if (network === "ws") {
        const wsSettings = streamSettings.wsSettings || {};
        if (wsSettings.host) {
          queryParams.push(`host=${wsSettings.host}`);
        }
        if (wsSettings.path) {
          queryParams.push(`path=${encodeURIComponent(wsSettings.path)}`);
        }
      } else if (network === "grpc") {
        const grpcSettings = streamSettings.grpcSettings || {};
        if (grpcSettings.serviceName) {
          queryParams.push(`serviceName=${encodeURIComponent(grpcSettings.serviceName)}`);
        }
      }

      const queryStr = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";
      return `vless://${id}@${address}:${port}${queryStr}#${encodeURIComponent(remark)}`;
    }

    if (protocol === "vmess") {
      const vnext = proxyOutbound.settings?.vnext?.[0];
      if (!vnext) return "";
      const address = vnext.address;
      const port = vnext.port;
      const user = vnext.users?.[0];
      const id = user?.id;

      const streamSettings = proxyOutbound.streamSettings || {};
      const network = streamSettings.network || "tcp";
      const security = streamSettings.security || "none";

      const vmessJsonObj: Record<string, any> = {
        v: "2",
        ps: remark,
        add: address,
        port: port,
        id: id,
        aid: "0",
        scy: "auto",
        net: network,
        type: "none",
        host: "",
        path: "",
        tls: security === "tls" ? "tls" : "",
        sni: ""
      };

      if (network === "ws") {
        vmessJsonObj.host = streamSettings.wsSettings?.host || "";
        vmessJsonObj.path = streamSettings.wsSettings?.path || "";
      } else if (network === "grpc") {
        vmessJsonObj.path = streamSettings.grpcSettings?.serviceName || "";
      }

      if (security === "tls") {
        vmessJsonObj.sni = streamSettings.tlsSettings?.serverName || "";
      }

      const vmessB64 = Buffer.from(JSON.stringify(vmessJsonObj), "utf-8").toString("base64");
      return `vmess://${vmessB64}`;
    }

    if (protocol === "trojan") {
      const server = proxyOutbound.settings?.servers?.[0];
      if (!server) return "";
      const address = server.address;
      const port = server.port;
      const password = server.password;

      const streamSettings = proxyOutbound.streamSettings || {};
      const security = streamSettings.security || "none";
      const network = streamSettings.network || "tcp";

      const queryParams: string[] = [];
      queryParams.push(`security=${security}`);
      queryParams.push(`type=${network}`);

      if (security === "tls") {
        const tlsSettings = streamSettings.tlsSettings || {};
        if (tlsSettings.serverName) {
          queryParams.push(`sni=${tlsSettings.serverName}`);
        }
      }

      const queryStr = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";
      return `trojan://${password}@${address}:${port}${queryStr}#${encodeURIComponent(remark)}`;
    }

    return "";
  } catch (err) {
    console.error("Failed to convert JSON config object to share link:", err);
    return "";
  }
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
 * Handles processing of subscriptions in both share links formats and raw updated JSON arrays.
 */
export function generateProcessedSubscription(sub: Subscription, format: "links" | "json" = "links"): string {
  const configsList = extractConfigsList(sub.jsonConfigs);
  const template = sub.remarksTemplate || "Server *";

  // Process item remarks and formats
  const processedConfigs = configsList.map((item, index) => {
    const oneBasedIndex = index + 1;
    const remarkName = template.includes("*")
      ? template.replaceAll("*", String(oneBasedIndex))
      : `${template} ${oneBasedIndex}`;

    if (typeof item === "string") {
      return updateConfigRemark(item, remarkName);
    } else if (item && typeof item === "object") {
      const clonedObj = JSON.parse(JSON.stringify(item));
      clonedObj.remarks = remarkName;
      return clonedObj;
    }
    return "";
  }).filter(Boolean);

  if (format === "json") {
    // Return custom updated JSON structures array
    const dummyNodes = (sub.dummyConfigs || []).map(dummy => ({
      remarks: dummy.name,
      outbounds: [
        {
          protocol: dummy.protocol === "info" ? "vless" : dummy.protocol,
          settings: {
            vnext: [
              {
                address: dummy.targetHost || "127.0.5.1",
                port: 443,
                users: [
                  {
                    id: "00000000-0000-0000-0000-000000000000",
                    encryption: "none"
                  }
                ]
              }
            ]
          }
        }
      ],
      tag: `dummy-${dummy.id}`
    }));

    return JSON.stringify([...dummyNodes, ...processedConfigs], null, 2);
  }

  // Links format (standard plain text line-by-line configuration)
  const processedLines: string[] = [];

  // 1. Add dummies
  if (sub.dummyConfigs && sub.dummyConfigs.length > 0) {
    sub.dummyConfigs.forEach(dummy => {
      processedLines.push(buildDummyConfigLink(dummy));
    });
  }

  // 2. Add profiles
  processedConfigs.forEach(item => {
    if (typeof item === "string") {
      processedLines.push(item);
    } else {
      const converted = convertJsonConfigToShareLink(item);
      if (converted) {
        processedLines.push(converted);
      }
    }
  });

  return processedLines.join("\n");
}

/**
 * Processes full subscription list into default text format.
 */
export function generateProcessedSubscriptionText(sub: Subscription): string {
  return generateProcessedSubscription(sub, "links");
}
