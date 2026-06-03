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
  nameOverrides?: Record<string, string>; // custom index-based naming overrides
  enabledFormats?: string[]; // list of active format keys
  customFormatPayloads?: Record<string, string>; // pasted code index overrides
  defaultFormat?: string; // default pre-selected format
  additionalLink?: string; // alternative/additional proxy configs/links appended raw
  createdAt: string;
  updatedAt: string;
}

export interface ParsedProxy {
  id: string;
  protocol: "vless" | "vmess" | "trojan" | "ss" | "info";
  name: string;
  server: string;
  port: number;
  uuid?: string;
  password?: string;
  method?: string;
  security?: string;
  network?: string;
  sni?: string;
  path?: string;
  host?: string;
  publicKey?: string;
  shortId?: string;
  fingerprint?: string;
}

/**
 * Universal V2Ray/Xray URL parser supporting vless, vmess, trojan, ss, etc.
 */
export function parseV2rayLink(link: string, index: number = 0): ParsedProxy | null {
  try {
    const trimmed = link.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("vmess://")) {
      const b64Data = trimmed.substring(8).trim();
      const decoded = Buffer.from(b64Data, "base64").toString("utf-8");
      const json = JSON.parse(decoded);
      return {
        id: `vmess_${index}`,
        protocol: "vmess",
        name: json.ps || `VMess Server ${index + 1}`,
        server: json.add || "127.0.0.1",
        port: parseInt(json.port) || 443,
        uuid: json.id,
        network: json.net || "tcp",
        security: json.tls === "tls" ? "tls" : "none",
        host: json.host || "",
        path: json.path || "",
        sni: json.sni || ""
      };
    }

    if (trimmed.startsWith("vless://") || trimmed.startsWith("trojan://") || trimmed.startsWith("ss://")) {
      const protocol = trimmed.split("://")[0] as any;
      const hashIndex = trimmed.indexOf("#");
      let remark = `Server ${index + 1}`;
      let mainPart = trimmed;
      if (hashIndex !== -1) {
        mainPart = trimmed.substring(0, hashIndex);
        try {
          remark = decodeURIComponent(trimmed.substring(hashIndex + 1));
        } catch {
          remark = trimmed.substring(hashIndex + 1);
        }
      }

      const rest = mainPart.substring(protocol.length + 3);
      const atIndex = rest.indexOf("@");
      if (atIndex === -1) return null;
      const credentials = rest.substring(0, atIndex);
      const hostPortQuery = rest.substring(atIndex + 1);

      const queryMark = hostPortQuery.indexOf("?");
      let hostPort = hostPortQuery;
      let queryStr = "";
      if (queryMark !== -1) {
        hostPort = hostPortQuery.substring(0, queryMark);
        queryStr = hostPortQuery.substring(queryMark + 1);
      }

      const colonIndex = hostPort.lastIndexOf(":");
      if (colonIndex === -1) return null;
      const server = hostPort.substring(0, colonIndex);
      const port = parseInt(hostPort.substring(colonIndex + 1)) || 443;

      const queryParams = new URLSearchParams(queryStr);
      const network = queryParams.get("type") || "tcp";
      const security = queryParams.get("security") || "none";
      const sni = queryParams.get("sni") || "";
      const path = queryParams.get("path") || queryParams.get("serviceName") || "";
      const host = queryParams.get("host") || "";
      const publicKey = queryParams.get("pbk") || "";
      const shortId = queryParams.get("sid") || "";
      const fingerprint = queryParams.get("fp") || "";

      return {
        id: `${protocol}_${index}`,
        protocol,
        name: remark,
        server,
        port,
        uuid: protocol === "vless" ? credentials : undefined,
        password: (protocol === "trojan" || protocol === "ss") ? credentials : undefined,
        security,
        network,
        sni,
        path,
        host,
        publicKey,
        shortId,
        fingerprint
      };
    }
  } catch (err) {
    console.warn("Failed parsing V2Ray link: ", link, err);
  }
  return null;
}

/**
 * Universal V2Ray URL generator matching ParsedProxy properties
 */
export function convertToShareLink(proxy: ParsedProxy): string {
  const remark = proxy.name || "Config";
  if (proxy.protocol === "vmess") {
    const vmessJsonObj: Record<string, any> = {
      v: "2",
      ps: remark,
      add: proxy.server,
      port: proxy.port,
      id: proxy.uuid || "",
      aid: "0",
      scy: "auto",
      net: proxy.network || "tcp",
      type: "none",
      host: proxy.host || "",
      path: proxy.path || "",
      tls: proxy.security === "tls" ? "tls" : "",
      sni: proxy.sni || ""
    };
    const vmessB64 = Buffer.from(JSON.stringify(vmessJsonObj), "utf-8").toString("base64");
    return `vmess://${vmessB64}`;
  }

  if (proxy.protocol === "vless") {
    const queryParams: string[] = [];
    queryParams.push(`security=${proxy.security || "none"}`);
    queryParams.push(`type=${proxy.network || "tcp"}`);
    if (proxy.sni) queryParams.push(`sni=${proxy.sni}`);
    if (proxy.host) queryParams.push(`host=${proxy.host}`);
    if (proxy.path) {
      if (proxy.network === "grpc") {
        queryParams.push(`serviceName=${encodeURIComponent(proxy.path)}`);
      } else {
        queryParams.push(`path=${encodeURIComponent(proxy.path)}`);
      }
    }
    if (proxy.publicKey) queryParams.push(`pbk=${proxy.publicKey}`);
    if (proxy.shortId) queryParams.push(`sid=${proxy.shortId}`);
    if (proxy.fingerprint) queryParams.push(`fp=${proxy.fingerprint}`);

    const queryStr = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";
    return `vless://${proxy.uuid || ""}@${proxy.server}:${proxy.port}${queryStr}#${encodeURIComponent(remark)}`;
  }

  if (proxy.protocol === "trojan") {
    const queryParams: string[] = [];
    queryParams.push(`security=${proxy.security || "none"}`);
    queryParams.push(`type=${proxy.network || "tcp"}`);
    if (proxy.sni) queryParams.push(`sni=${proxy.sni}`);
    if (proxy.host) queryParams.push(`host=${proxy.host}`);
    if (proxy.path) queryParams.push(`path=${encodeURIComponent(proxy.path)}`);

    const queryStr = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";
    return `trojan://${proxy.password || ""}@${proxy.server}:${proxy.port}${queryStr}#${encodeURIComponent(remark)}`;
  }

  if (proxy.protocol === "ss") {
    const creds = proxy.password || "";
    let finalCreds = creds;
    if (proxy.method && !creds.includes("@") && !creds.includes(":")) {
      finalCreds = Buffer.from(`${proxy.method}:${creds}`, "utf-8").toString("base64");
    }
    return `ss://${finalCreds}@${proxy.server}:${proxy.port}#${encodeURIComponent(remark)}`;
  }

  return "";
}

/**
 * Maps sing-box outbound protocol scheme back to standard ParsedProxy interface.
 */
export function parseSingBoxOutbound(obj: any, index: number = 0): ParsedProxy | null {
  try {
    if (!obj || typeof obj !== "object") return null;
    const type = obj.type;
    const isProxy = type === "vless" || type === "vmess" || type === "trojan" || type === "shadowsocks" || type === "ss";
    if (!isProxy) return null;

    const protocol = type === "shadowsocks" ? "ss" : type;
    const name = obj.tag || `Node #${index + 1}`;
    const server = obj.server || "127.0.0.1";
    const port = obj.server_port || 443;

    const uuid = obj.uuid;
    const password = obj.password;
    const method = obj.method;

    let security = "none";
    let sni = "";
    let publicKey = "";
    let shortId = "";
    let fingerprint = "";

    if (obj.tls?.enabled) {
      security = "tls";
      sni = obj.tls.server_name || "";
      if (obj.tls.reality?.enabled) {
        security = "reality";
        publicKey = obj.tls.reality.public_key || "";
        shortId = obj.tls.reality.short_id || "";
      }
      if (obj.tls.utls?.enabled && obj.tls.utls.fingerprint) {
        fingerprint = obj.tls.utls.fingerprint;
      }
    }

    let network = "tcp";
    let path = "";
    let host = "";

    if (obj.transport) {
      if (obj.transport.type === "ws") {
        network = "ws";
        path = obj.transport.path || "/";
        host = obj.transport.headers?.Host || obj.transport.headers?.host || "";
      } else if (obj.transport.type === "grpc") {
        network = "grpc";
        path = obj.transport.service_name || "";
      }
    }

    return {
      id: `sb_${protocol}_${index}`,
      protocol,
      name,
      server,
      port,
      uuid,
      password,
      method,
      security,
      network,
      sni,
      path,
      host,
      publicKey,
      shortId,
      fingerprint
    };
  } catch (err) {
    console.warn("Failed to parse sing-box outbound: ", obj, err);
  }
  return null;
}

/**
 * Maps Clash proxy structure back to standard ParsedProxy interface.
 */
export function parseClashProxy(obj: any, index: number = 0): ParsedProxy | null {
  try {
    if (!obj || typeof obj !== "object") return null;
    const type = obj.type;
    const isProxy = type === "vless" || type === "vmess" || type === "trojan" || type === "ss" || type === "shadowsocks";
    if (!isProxy) return null;

    const protocol = type === "shadowsocks" ? "ss" : type;
    const name = obj.name || `Node #${index + 1}`;
    const server = obj.server || "127.0.0.1";
    const port = obj.port || 443;

    const uuid = obj.uuid;
    const password = obj.password;
    const method = obj.cipher;

    let security = "none";
    if (obj.tls) {
      security = "tls";
    }
    const sni = obj.servername || "";
    let publicKey = "";
    let shortId = "";
    if (obj["reality-opts"]) {
      security = "reality";
      publicKey = obj["reality-opts"].public_key || obj["reality-opts"]["public-key"] || "";
      shortId = obj["reality-opts"].short_id || obj["reality-opts"]["short-id"] || "";
    }

    let network = obj.network || "tcp";
    let path = "";
    let host = "";

    if (obj["ws-opts"]) {
      network = "ws";
      path = obj["ws-opts"].path || "/";
      host = obj["ws-opts"].headers?.Host || obj["ws-opts"].headers?.host || "";
    } else if (obj["grpc-opts"]) {
      network = "grpc";
      path = obj["grpc-opts"]["grpc-service-name"] || "";
    }

    return {
      id: `clash_${protocol}_${index}`,
      protocol,
      name,
      server,
      port,
      uuid,
      password,
      method,
      security,
      network,
      sni,
      path,
      host,
      publicKey,
      shortId
    };
  } catch (err) {
    console.warn("Failed to parse Clash proxy: ", obj, err);
  }
  return null;
}

/**
 * Converts ParsedProxy schema back to sing-box outbound schema object
 */
export function convertToSingBoxOutbound(proxy: ParsedProxy): any {
  const remark = proxy.name || "Config";
  const baseOutbound: Record<string, any> = {
    type: proxy.protocol === "ss" ? "shadowsocks" : proxy.protocol,
    tag: remark,
    server: proxy.server,
    server_port: proxy.port,
  };

  if (proxy.protocol === "vless" || proxy.protocol === "vmess") {
    baseOutbound.uuid = proxy.uuid || "";
  }
  if (proxy.protocol === "trojan") {
    baseOutbound.password = proxy.password || "";
  }
  if (proxy.protocol === "ss") {
    baseOutbound.password = proxy.password || "";
    baseOutbound.method = proxy.method || "aes-256-gcm";
  }

  if (proxy.security === "tls" || proxy.security === "reality") {
    baseOutbound.tls = {
      enabled: true,
      server_name: proxy.sni || ""
    };
    if (proxy.security === "reality") {
      baseOutbound.tls.reality = {
        enabled: true,
        public_key: proxy.publicKey || "",
        short_id: proxy.shortId || ""
      };
    }
    if (proxy.fingerprint) {
      baseOutbound.tls.utls = {
        enabled: true,
        fingerprint: proxy.fingerprint
      };
    }
  }

  if (proxy.network === "ws" || proxy.network === "grpc") {
    baseOutbound.transport = {
      type: proxy.network
    };
    if (proxy.network === "ws") {
      baseOutbound.transport.path = proxy.path || "/";
      if (proxy.host) {
        baseOutbound.transport.headers = {
          "Host": proxy.host
        };
      }
    } else if (proxy.network === "grpc") {
      baseOutbound.transport.service_name = proxy.path || "";
    }
  }

  return baseOutbound;
}

/**
 * Converts ParsedProxy schema back to Clash proxy schema object
 */
export function convertToClashProxy(proxy: ParsedProxy): any {
  const remark = proxy.name || "Config";
  const baseProxy: Record<string, any> = {
    name: remark,
    type: proxy.protocol,
    server: proxy.server,
    port: proxy.port,
    udp: true
  };

  if (proxy.protocol === "vless" || proxy.protocol === "vmess") {
    baseProxy.uuid = proxy.uuid || "";
    baseProxy.cipher = "auto";
  }
  if (proxy.protocol === "trojan") {
    baseProxy.password = proxy.password || "";
  }
  if (proxy.protocol === "ss") {
    baseProxy.cipher = proxy.method || "aes-256-gcm";
    baseProxy.password = proxy.password || "";
  }

  if (proxy.security === "tls" || proxy.security === "reality") {
    baseProxy.tls = true;
    if (proxy.sni) baseProxy.servername = proxy.sni;
    if (proxy.security === "reality") {
      baseProxy["reality-opts"] = {
        "public-key": proxy.publicKey || "",
        "short-id": proxy.shortId || ""
      };
    }
    baseProxy["skip-cert-verify"] = false;
  }

  if (proxy.network === "ws" || proxy.network === "grpc") {
    baseProxy.network = proxy.network;
    if (proxy.network === "ws") {
      baseProxy["ws-opts"] = {
        path: proxy.path || "/",
        headers: proxy.host ? { Host: proxy.host } : undefined
      };
    } else if (proxy.network === "grpc") {
      baseProxy["grpc-opts"] = {
        "grpc-service-name": proxy.path || ""
      };
    }
  }

  return baseProxy;
}

/**
 * Custom light and bulletproof YAML array serializer
 */
export function convertArrayToYaml(arr: any[], indent: string = "  "): string {
  let yaml = "proxies:\n";
  for (const proxy of arr) {
    yaml += `${indent}- name: "${proxy.name}"\n`;
    yaml += `${indent}  type: ${proxy.type}\n`;
    yaml += `${indent}  server: ${proxy.server}\n`;
    yaml += `${indent}  port: ${proxy.port}\n`;
    yaml += `${indent}  udp: ${proxy.udp !== false ? "true" : "false"}\n`;

    if (proxy.uuid) yaml += `${indent}  uuid: ${proxy.uuid}\n`;
    if (proxy.password) yaml += `${indent}  password: ${proxy.password}\n`;
    if (proxy.cipher) yaml += `${indent}  cipher: ${proxy.cipher}\n`;
    if (proxy.tls !== undefined) yaml += `${indent}  tls: ${proxy.tls ? "true" : "false"}\n`;
    if (proxy.servername) yaml += `${indent}  servername: ${proxy.servername}\n`;
    if (proxy.network) yaml += `${indent}  network: ${proxy.network}\n`;
    if (proxy.skip_cert_verify !== undefined) yaml += `${indent}  skip-cert-verify: ${proxy.skip_cert_verify}\n`;

    if (proxy["reality-opts"]) {
      yaml += `${indent}  reality-opts:\n`;
      yaml += `${indent}    public-key: ${proxy["reality-opts"]["public-key"]}\n`;
      yaml += `${indent}    short-id: ${proxy["reality-opts"]["short-id"]}\n`;
    }

    if (proxy["ws-opts"]) {
      yaml += `${indent}  ws-opts:\n`;
      yaml += `${indent}    path: ${proxy["ws-opts"].path || "/"}\n`;
      if (proxy["ws-opts"].headers?.Host) {
        yaml += `${indent}    headers:\n`;
        yaml += `${indent}      Host: ${proxy["ws-opts"].headers.Host}\n`;
      }
    } else if (proxy["grpc-opts"]) {
      yaml += `${indent}  grpc-opts:\n`;
      yaml += `${indent}    grpc-service-name: ${proxy["grpc-opts"]["grpc-service-name"]}\n`;
    }
  }
  return yaml;
}

/**
 * Normalizes input text consisting of JSON, standard V2Pay, sing-box or Clash configurations.
 */
export function extractConfigsList(rawInput: string): (string | any)[] {
  if (!rawInput || !rawInput.trim()) return [];

  const trimmed = rawInput.trim();

  // Try parsing file as a JSON
  try {
    const data = JSON.parse(trimmed);

    // Sing-box root object parser detection
    if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.outbounds)) {
      return data.outbounds.flatMap((x: any, idx: number) => {
        const parsed = parseSingBoxOutbound(x, idx);
        if (parsed) {
          const sLink = convertToShareLink(parsed);
          return sLink ? [sLink] : [];
        }
        return [];
      });
    }

    // Clash root object parser detection
    if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.proxies)) {
      return data.proxies.flatMap((x: any, idx: number) => {
        const parsed = parseClashProxy(x, idx);
        if (parsed) {
          const sLink = convertToShareLink(parsed);
          return sLink ? [sLink] : [];
        }
        return [];
      });
    }

    if (Array.isArray(data)) {
      return data.flatMap((item, idx) => {
        if (!item) return [];
        if (typeof item === "string") return [item];
        if (typeof item === "object") {
          // Check if nested URL/link
          const possible = item.url || item.config || item.link || "";
          if (possible && typeof possible === "string" && possible.includes("://")) {
            return [possible];
          }
          // Check if it's directly a sing-box config object
          const parsedSb = parseSingBoxOutbound(item, idx);
          if (parsedSb) {
            const sLink = convertToShareLink(parsedSb);
            if (sLink) return [sLink];
          }
          // Check if it's directly a Clash proxy object
          const parsedClash = parseClashProxy(item, idx);
          if (parsedClash) {
            const sLink = convertToShareLink(parsedClash);
            if (sLink) return [sLink];
          }
          // Standard V2Ray object fallback
          if (item.remarks || item.outbounds || item.inbounds) {
            return [item];
          }
        }
        return [];
      });
    } else if (data && typeof data === "object") {
      // Standard single V2Ray object check
      if (data.remarks || data.outbounds || data.inbounds) {
        return [data];
      }
      // Traversal for other lists
      const possibleArrays = [data.configs, data.nodes, data.servers, data.proxies, data.links, data.outbounds];
      for (const arr of possibleArrays) {
        if (Array.isArray(arr)) {
          return arr.flatMap((x, idx) => {
            if (!x) return [];
            if (typeof x === "string") return [x];
            if (typeof x === "object") {
              const possible = x.url || x.config || x.link || "";
              if (possible && typeof possible === "string" && possible.includes("://")) {
                return [possible];
              }
              const parsedSb = parseSingBoxOutbound(x, idx);
              if (parsedSb) {
                const sLink = convertToShareLink(parsedSb);
                if (sLink) return [sLink];
              }
              const parsedClash = parseClashProxy(x, idx);
              if (parsedClash) {
                const sLink = convertToShareLink(parsedClash);
                if (sLink) return [sLink];
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
    // Fail-through to raw text parsing
  }

  // Split by newlines and grep share URIs or robust strings
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

    if (trimmed.startsWith("vmess://")) {
      const b64Data = trimmed.substring(8);
      try {
        const decoded = Buffer.from(b64Data, "base64").toString("utf-8");
        const json = JSON.parse(decoded);
        json.ps = remark;
        const updatedB64 = Buffer.from(JSON.stringify(json), "utf-8").toString("base64");
        return `vmess://${updatedB64}`;
      } catch (err) {
        return trimmed;
      }
    }

    if (
      trimmed.startsWith("vless://") ||
      trimmed.startsWith("trojan://") ||
      trimmed.startsWith("ss://")
    ) {
      const hashIndex = trimmed.indexOf("#");
      const basePart = hashIndex !== -1 ? trimmed.substring(0, hashIndex) : trimmed;
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
    return `vless://${idStr}@${host}:443?encryption=none&security=tls&type=tcp#${nameEncoded}`;
  }
  
  return `${dummy.protocol}://${idStr}@${host}:1337?encryption=none&security=none#${nameEncoded}`;
}

/**
 * Handles processing of subscriptions in multiple client formats.
 */
export function generateProcessedSubscription(
  sub: Subscription,
  format: "links" | "plain" | "json" | "sing-box" | "clash" = "links",
  fetchedAdditionalConfigs: string[] = []
): string {
  // If custom format payload exists for this specific format and is not empty, use it directly!
  if (sub.customFormatPayloads && sub.customFormatPayloads[format] !== undefined && sub.customFormatPayloads[format].trim() !== "") {
    return sub.customFormatPayloads[format];
  }

  // Handle plain format special override fallback path
  if (format === "plain") {
    if (sub.customFormatPayloads && sub.customFormatPayloads["plain"] !== undefined && sub.customFormatPayloads["plain"].trim() !== "") {
      return sub.customFormatPayloads["plain"];
    }
    if (sub.customFormatPayloads && sub.customFormatPayloads["links"] !== undefined && sub.customFormatPayloads["links"].trim() !== "") {
      return sub.customFormatPayloads["links"];
    }
  }

  const activeFormat = format === "plain" ? "links" : format;
  const configsList = extractConfigsList(sub.jsonConfigs);

  // Process item remarks and formats - ONLY include those that have been explicitly renamed
  const processedConfigs = configsList.map((item, index) => {
    // Only configs that have custom override/renaming should be processed!
    const hasOverrideName = sub.nameOverrides && sub.nameOverrides[String(index)] !== undefined && sub.nameOverrides[String(index)].trim() !== "";
    if (!hasOverrideName) {
      return null;
    }
    const remarkName = sub.nameOverrides![String(index)].trim();

    if (typeof item === "string") {
      return updateConfigRemark(item, remarkName);
    } else if (item && typeof item === "object") {
      const clonedObj = JSON.parse(JSON.stringify(item));
      clonedObj.remarks = remarkName;
      return clonedObj;
    }
    return null;
  }).filter(Boolean);

  // Parse list into structured objects
  const parsedProxies = processedConfigs.map((item, index) => {
    if (typeof item === "string") {
      return parseV2rayLink(item, index);
    }
    return null;
  }).filter(Boolean) as ParsedProxy[];

  // Merge parsed/fetched additional configs
  const mergedAdditional: string[] = [];
  if (fetchedAdditionalConfigs && fetchedAdditionalConfigs.length > 0) {
    mergedAdditional.push(...fetchedAdditionalConfigs);
  } else if (sub.additionalLink && !sub.additionalLink.trim().startsWith("http")) {
    const rawLines = sub.additionalLink.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    mergedAdditional.push(...rawLines);
  }

  if (activeFormat === "sing-box") {
    const sbProxies = parsedProxies.map(convertToSingBoxOutbound);
    
    // Parse any additional proxy strings to convert them into Sing-Box outbounds
    const sbAdditional = mergedAdditional.map((link, idx) => {
      const parsed = parseV2rayLink(link, idx + 10000);
      return parsed ? convertToSingBoxOutbound(parsed) : null;
    }).filter(Boolean);

    const allOutbounds = [...sbAdditional, ...sbProxies];
    const singBoxConfig = {
      log: {
        level: "info",
        timestamp: true
      },
      dns: {
        servers: [
          {
            tag: "dns-remote",
            address: "https://8.8.8.8/dns-query",
            detour: "select"
          },
          {
            tag: "dns-direct",
            address: "1.1.1.1",
            detour: "direct"
          }
        ],
        rules: [
          {
            outbound: "any",
            server: "dns-direct"
          }
        ]
      },
      inbounds: [
        {
          type: "tun",
          tag: "tun-in",
          interface_name: "tun0",
          inet4_address: "172.19.0.1/30",
          auto_route: true,
          strict_route: true,
          stack: "gvisor",
          sniff: true
        }
      ],
      outbounds: [
        {
          type: "selector",
          tag: "select",
          outbounds: ["direct", ...allOutbounds.map(o => o.tag)]
        },
        ...allOutbounds,
        {
          type: "direct",
          tag: "direct"
        },
        {
          type: "block",
          tag: "block"
        },
        {
          type: "dns",
          tag: "dns-out"
        }
      ],
      route: {
        auto_detect_interface: true,
        rules: [
          {
            protocol: "dns",
            outbound: "dns-out"
          },
          {
            port: 53,
            outbound: "dns-out"
          },
          {
            ip_is_private: true,
            outbound: "direct"
          }
        ]
      }
    };
    return JSON.stringify(singBoxConfig, null, 2);
  }

  if (activeFormat === "clash") {
    const clashProxies = parsedProxies.map(convertToClashProxy);
    
    const clashAdditional = mergedAdditional.map((link, idx) => {
      const parsed = parseV2rayLink(link, idx + 10000);
      return parsed ? convertToClashProxy(parsed) : null;
    }).filter(Boolean);

    const allClashProxies = [...clashAdditional, ...clashProxies];
    const clashYamlHeader = `port: 7890\nsocks-port: 7891\nallow-lan: true\nmode: Rule\nlog-level: info\nexternal-controller: '127.0.0.1:9090'\n\ndns:\n  enable: true\n  ipv6: false\n  listen: 0.0.0.0:53\n  enhanced-mode: fake-ip\n  nameserver:\n    - 114.114.114.114\n    - 8.8.8.8\n  fallback:\n    - https://8.8.8.8/dns-query\n\n`;
    const proxiesYaml = convertArrayToYaml(allClashProxies, "  ");
    const groupsYaml = `\nproxy-groups:\n  - name: PROXIES\n    type: select\n    proxies:\n      - DIRECT\n      - AUTO_SELECT\n      ${allClashProxies.map(p => `- "${p.name}"`).join("\n      ")}\n  - name: AUTO_SELECT\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    tolerance: 50\n    proxies:\n      ${allClashProxies.map(p => `- "${p.name}"`).join("\n      ")}\n\nrules:\n  - DOMAIN-SUFFIX,google.com,PROXIES\n  - DOMAIN-KEYWORD,google,PROXIES\n  - DOMAIN-SUFFIX,github.com,PROXIES\n  - GEOIP,CN,DIRECT\n  - MATCH,PROXIES\n`;

    return `${clashYamlHeader}${proxiesYaml}${groupsYaml}`;
  }

  if (activeFormat === "json") {
    const clashAdditional = mergedAdditional.map((link, idx) => {
      const parsed = parseV2rayLink(link, idx + 10000);
      if (!parsed) return null;
      return {
        remarks: parsed.name,
        outbounds: [
          {
            protocol: parsed.protocol,
            settings: {
              vnext: [
                {
                  address: parsed.server,
                  port: parsed.port,
                  users: [
                    {
                      id: parsed.uuid || "",
                      encryption: "none"
                    }
                  ]
                }
              ]
            }
          }
        ],
        tag: parsed.id
      };
    }).filter(Boolean);

    return JSON.stringify([...clashAdditional, ...processedConfigs], null, 2);
  }

  // Fallback to "links" format
  const processedLines: string[] = [];

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

  // Append raw additional config verbatim (it bypasses renaming, overrides, templates)
  mergedAdditional.forEach(line => {
    processedLines.push(line);
  });

  return processedLines.join("\n");
}

/**
 * Processes full subscription list into default text format.
 */
export function generateProcessedSubscriptionText(sub: Subscription): string {
  return generateProcessedSubscription(sub, "links");
}
