import { NextRequest, NextResponse } from "next/server";
import { getKV, logSubAccess } from "@/lib/db";
import { Subscription, generateProcessedSubscription, extractConfigsList } from "@/lib/v2ray";

const SUBS_DB_KEY = "v2ray_subscriptions_list";

function extractIP(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    return parts[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  
  const clientIp = (req as any).ip;
  return clientIp || "127.0.0.1";
}

function extractHWID(req: NextRequest, searchParams: URLSearchParams): string {
  const hwidParams = ["hwid", "id", "clientId", "client_id", "device", "deviceId", "device_id", "uuid"];
  for (const pt of hwidParams) {
    const val = searchParams.get(pt);
    if (val) return val.trim();
  }

  const hwidHeaders = [
    "x-client-hwid",
    "hwid",
    "x-hwid",
    "x-request-id",
    "client-id",
    "x-client-id",
    "x-device-id"
  ];
  for (const hdr of hwidHeaders) {
    const val = req.headers.get(hdr);
    if (val) return val.trim();
  }

  return "";
}

function parseUserAgent(ua: string): string {
  if (!ua) return "Generic Client";

  const uaLower = ua.toLowerCase();
  let clientName = "Generic Client";
  let osName = "Unknown OS";

  // Match client name
  if (uaLower.includes("shadowrocket")) {
    clientName = "Shadowrocket";
  } else if (uaLower.includes("v2rayng")) {
    clientName = "v2rayNG";
  } else if (uaLower.includes("v2rayn")) {
    clientName = "v2rayN";
  } else if (uaLower.includes("quantumult x") || uaLower.includes("quantumult%20x")) {
    clientName = "Quantumult X";
  } else if (uaLower.includes("clash") || uaLower.includes("stash") || uaLower.includes("meta")) {
    clientName = "Clash";
  } else if (uaLower.includes("sing-box") || uaLower.includes("sing_box")) {
    clientName = "sing-box";
  } else if (uaLower.includes("v2box")) {
    clientName = "V2Box";
  } else if (uaLower.includes("foxray")) {
    clientName = "FoXray";
  } else if (uaLower.includes("nekobox")) {
    clientName = "NekoBox";
  } else if (uaLower.includes("streisand")) {
    clientName = "Streisand";
  } else if (uaLower.includes("loon")) {
    clientName = "Loon";
  } else if (uaLower.includes("surge")) {
    clientName = "Surge";
  } else if (uaLower.includes("surfboard")) {
    clientName = "Surfboard";
  } else if (uaLower.includes("anxray")) {
    clientName = "AnXray";
  } else if (uaLower.includes("fair")) {
    clientName = "Fair";
  } else if (uaLower.includes("kitsunebi")) {
    clientName = "Kitsunebi";
  } else if (uaLower.includes("postman")) {
    clientName = "Postman / Debugger";
  } else if (uaLower.includes("curl") || uaLower.includes("wget")) {
    clientName = "Terminal Curl/Wget";
  } else if (uaLower.includes("mozilla") || uaLower.includes("safari") || uaLower.includes("chrome")) {
    clientName = "Web Browser";
  } else {
    const firstTokenMatch = ua.match(/^([^/;\s)(]+)/);
    if (firstTokenMatch && firstTokenMatch[1]) {
      clientName = firstTokenMatch[1];
    }
  }

  // Match OS
  if (uaLower.includes("iphone") || uaLower.includes("ipod")) {
    osName = "iOS / iPhone";
  } else if (uaLower.includes("ipad")) {
    osName = "iPadOS";
  } else if (uaLower.includes("android")) {
    osName = "Android";
  } else if (uaLower.includes("windows")) {
    osName = "Windows";
  } else if (uaLower.includes("macintosh") || uaLower.includes("mac os") || uaLower.includes("darwin")) {
    osName = "macOS";
  } else if (uaLower.includes("linux")) {
    osName = "Linux";
  }

  return `${osName === "Unknown OS" ? "" : osName + " - "}${clientName}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string }> }
) {
  try {
    const { path } = await params;
    
    if (!path) {
      return new NextResponse("Subscription Path Required", { status: 400 });
    }

    const currentList = await getKV<Subscription[]>(SUBS_DB_KEY) || [];
    const sub = currentList.find(s => s.path.toLowerCase() === path.toLowerCase());

    if (!sub) {
      return new NextResponse("Subscription configuration not found.", { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const rawFormat = searchParams.get("format");
    const isRaw = searchParams.get("raw") === "true" || searchParams.get("flag") === "raw";

    const ip = extractIP(req);
    const ua = req.headers.get("user-agent") || "";
    const hwid = extractHWID(req, searchParams);
    const deviceType = parseUserAgent(ua);
    const uaLower = ua.toLowerCase();

    // Retrieve active enabled formats list for this subscription (default to all if not set)
    const enabledFormats: string[] = sub.enabledFormats !== undefined ? sub.enabledFormats : ["links", "plain", "sing-box", "clash", "json"];

    // Guard explicitly requested formats: reject if they are disabled
    if (rawFormat) {
      let formatKeyToVerify = rawFormat;
      if (rawFormat === "v2ray" || rawFormat === "base64" || rawFormat === "b64") {
        formatKeyToVerify = "links";
      } else if (rawFormat === "raw") {
        formatKeyToVerify = "plain";
      } else if (rawFormat === "sing_box" || rawFormat === "singbox") {
        formatKeyToVerify = "sing-box";
      } else if (rawFormat === "meta" || rawFormat === "yaml") {
        formatKeyToVerify = "clash";
      }

      if (!enabledFormats.includes(formatKeyToVerify)) {
        return new NextResponse("Requested subscription format is currently not enabled by the administrator for this link.", { status: 403 });
      }
    }

    // Dynamically guess requested format from client's user-agent
    let format: "links" | "plain" | "json" | "sing-box" | "clash" = "json";
    if (rawFormat === "links" || rawFormat === "v2ray" || rawFormat === "base64" || rawFormat === "b64") {
      format = "links";
    } else if (rawFormat === "plain" || rawFormat === "raw") {
      format = "plain";
    } else if (rawFormat === "sing-box" || rawFormat === "sing_box" || rawFormat === "singbox") {
      format = "sing-box";
    } else if (rawFormat === "clash" || rawFormat === "meta" || rawFormat === "yaml") {
      format = "clash";
    } else if (rawFormat === "json") {
      format = "json";
    } else if (!rawFormat) {
      // Auto guess if standard raw URL fetched directly by client apps
      if (uaLower.includes("clash") || uaLower.includes("stash") || uaLower.includes("surfboard") || uaLower.includes("meta")) {
        format = "clash";
      } else if (uaLower.includes("sing-box") || uaLower.includes("sing_box")) {
        format = "sing-box";
      } else if (uaLower.includes("shadowrocket") || uaLower.includes("v2ray") || uaLower.includes("nekobox") || uaLower.includes("v2rayng")) {
        format = "links";
      }
    }

    // Fallback guess to the first enabled format if the guessed format is disabled
    if (!rawFormat && !enabledFormats.includes(format)) {
      const firstEnabled = ["links", "plain", "sing-box", "clash", "json"].find(f => enabledFormats.includes(f));
      if (firstEnabled) {
        format = firstEnabled as any;
      }
    }

    // Save analytics
    logSubAccess(sub.path, ip, ua, hwid, deviceType).catch(ex => {
      console.error("Failed asynchronously to log subscription metrics: ", ex);
    });

    const acceptHeader = req.headers.get("accept") || "";

    const isV2rayClient = 
      uaLower.includes("v2ray") ||
      uaLower.includes("clash") ||
      uaLower.includes("sing-box") ||
      uaLower.includes("shadowrocket") ||
      uaLower.includes("quantumult") ||
      uaLower.includes("v2box") ||
      uaLower.includes("foxray") ||
      uaLower.includes("nekobox") ||
      uaLower.includes("streisand") ||
      uaLower.includes("stash") ||
      uaLower.includes("loon") ||
      uaLower.includes("surge") ||
      uaLower.includes("surfboard") ||
      uaLower.includes("anxray") ||
      uaLower.includes("fair") ||
      uaLower.includes("kitsunebi");

    const isBrowserRequest = 
      (acceptHeader.includes("text/html") || acceptHeader.includes("application/xhtml+xml")) &&
      !isV2rayClient;

    const forceHtml = searchParams.get("view") === "true" || searchParams.get("format") === "html";

    if (forceHtml || (isBrowserRequest && !searchParams.get("format") && !searchParams.get("raw"))) {
      const host = req.headers.get("host") || req.nextUrl.host;
      const proto = req.headers.get("x-forwarded-proto") || (req.nextUrl.protocol.replace(":", "") || "https");
      const baseSubUrl = `${proto}://${host}/sub/${sub.path}`;

      const totalDummies = (sub.dummyConfigs || []).length;
      const baseConfigs = extractConfigsList(sub.jsonConfigs || "");
      const baseConfigsCount = baseConfigs.length;
      const totalServers = totalDummies + baseConfigsCount;

      // Generate payloads in all formats for rendering
      const linksOutputText = generateProcessedSubscription(sub, "links");
      const jsonOutputText = generateProcessedSubscription(sub, "json");
      const singBoxOutputText = generateProcessedSubscription(sub, "sing-box");
      const clashOutputText = generateProcessedSubscription(sub, "clash");

      // Generate tabs dynamically based on which are enabled
      const formatTabConfig = [
        { key: "links", id: "b64", label: "Base64 Feed (Standard)", contentId: "tab-content-b64" },
        { key: "plain", id: "plain", label: "Plain Share URLs", contentId: "tab-content-plain" },
        { key: "sing-box", id: "singbox", label: "Sing-Box Config (JSON)", contentId: "tab-content-singbox" },
        { key: "clash", id: "clash", label: "Clash Config (YAML)", contentId: "tab-content-clash" },
        { key: "json", id: "json", label: "Nodes JSON Array", contentId: "tab-content-json" }
      ];

      const activeTabs = formatTabConfig.filter(t => enabledFormats.includes(t.key));
      const initialTab = activeTabs[0] || { id: "b64", contentId: "tab-content-b64" };

      // Base64 V2Ray value
      const b64ValueRaw = Buffer.from(linksOutputText, "utf-8").toString("base64");
      
      const safeName = (sub.name || "Unnamed").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safePath = (sub.path || "").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeIp = ip.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeDeviceType = deviceType.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeHwid = (hwid || "Not supplied (Browser Session)").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // Detect if we are loading on an isolates single-format subpage
      let activeSingleFormat: string | null = null;
      if (rawFormat) {
        if (rawFormat === "sing-box" || rawFormat === "sing_box" || rawFormat === "singbox") {
          activeSingleFormat = "sing-box";
        } else if (rawFormat === "clash" || rawFormat === "meta" || rawFormat === "yaml") {
          activeSingleFormat = "clash";
        } else if (rawFormat === "links" || rawFormat === "plain" || rawFormat === "raw") {
          activeSingleFormat = "links";
        } else if (rawFormat === "json") {
          activeSingleFormat = "json";
        } else if (rawFormat === "v2ray" || rawFormat === "base64" || rawFormat === "b64") {
          activeSingleFormat = "v2ray";
        }
      }

      // Compute display classes for each content block
      const b64DisplayClass = enabledFormats.includes("links") && ((!activeSingleFormat && initialTab.id === "b64") || activeSingleFormat === "v2ray") ? "block" : "hidden";
      const plainDisplayClass = enabledFormats.includes("plain") && ((!activeSingleFormat && initialTab.id === "plain") || activeSingleFormat === "links") ? "block" : "hidden";
      const singboxDisplayClass = enabledFormats.includes("sing-box") && ((!activeSingleFormat && initialTab.id === "singbox") || activeSingleFormat === "sing-box") ? "block" : "hidden";
      const clashDisplayClass = enabledFormats.includes("clash") && ((!activeSingleFormat && initialTab.id === "clash") || activeSingleFormat === "clash") ? "block" : "hidden";
      const jsonDisplayClass = enabledFormats.includes("json") && ((!activeSingleFormat && initialTab.id === "json") || activeSingleFormat === "json") ? "block" : "hidden";

      // Dynamically derive the active copy URL structure in the box
      let activeFormatSlug = activeSingleFormat || "";
      if (!activeFormatSlug && activeTabs.length === 1) {
        // If only 1 format is active, use its direct slug
        const key = activeTabs[0].key;
        activeFormatSlug = key === "links" ? "?format=links" : key === "plain" ? "?format=plain" : key;
      }
      
      const activeUrl = activeFormatSlug 
        ? (activeFormatSlug.startsWith("?") ? `${baseSubUrl}${activeFormatSlug}` : `${baseSubUrl}/${activeFormatSlug}`)
        : baseSubUrl;

      const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Limoo &mdash; ${safeName} Subscription</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Inter', sans-serif;
    }
    .font-mono {
      font-family: 'JetBrains Mono', monospace;
    }
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: rgba(15, 23, 42, 0.4);
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(51, 65, 85, 0.4);
      border-radius: 9999px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(51, 65, 85, 0.7);
    }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col items-center justify-start p-4 md:p-8 antialiased">
  
  <div class="max-w-3xl w-full space-y-8 my-auto py-10">
    
    <!-- Limoo elegant logo and header -->
    <div class="text-center space-y-3 p-2">
      <div class="inline-flex items-center justify-center p-3.5 bg-gradient-to-br from-teal-500/10 to-sky-500/10 border border-teal-500/20 rounded-3xl shadow-xl shadow-teal-500/5 select-none animate-pulse">
        <svg class="h-9 w-9 text-teal-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M12 5a7 7 0 100 14 7 7 0 000-14zM12 8a4 4 0 110 8 4 4 0 010-8z"></path>
        </svg>
      </div>
      <div>
        <h1 class="text-3xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2 select-none">
          <span class="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-sky-400 font-black">Limoo</span>
          <span class="text-slate-400 font-light">&bull; Secure Subscription</span>
        </h1>
        <p class="text-slate-500 text-[10px] mt-1 font-mono tracking-wider uppercase select-none">
          Subscription Management Service
        </p>
      </div>
    </div>

    <!-- Main subscription details card -->
    <div class="bg-slate-900/40 backdrop-blur-md rounded-3xl border border-slate-800/80 p-6 md:p-8 space-y-6 shadow-2xl relative overflow-hidden">
      <!-- Glow decoration item -->
      <div class="absolute -top-12 -right-12 w-32 h-32 bg-teal-500/10 rounded-full blur-3xl pointer-events-none select-none"></div>
      
      <!-- Sub info grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-slate-800/60 select-none">
        <div class="space-y-4">
          <h2 class="text-xs font-mono font-bold text-slate-500 uppercase tracking-wider">Subscription Parameters</h2>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-sm text-slate-400 font-medium">Name:</span>
              <span class="text-sm font-semibold text-white">${safeName}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-slate-400 font-medium">Path:</span>
              <span class="text-xs font-mono bg-slate-950 px-2 py-1 rounded text-teal-400 border border-slate-800">/${safePath}${activeSingleFormat ? "/" + activeSingleFormat : ""}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-slate-400 font-medium">Node Population:</span>
              <span class="text-sm font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-mono text-xs">
                ${totalServers} servers (${totalDummies} dummies)
              </span>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <h2 class="text-xs font-mono font-bold text-slate-500 uppercase tracking-wider">Your Device Connection Context</h2>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-sm text-slate-400 font-medium">Your IP Address:</span>
              <span class="text-sm font-semibold text-white font-mono">${safeIp}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-slate-400 font-medium">User-Agent:</span>
              <span class="text-xs text-slate-300 max-w-[200px] truncate" title="${safeDeviceType}">${safeDeviceType}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-slate-400 font-medium">Hardware ID (HWID):</span>
              <span class="text-xs text-slate-400 font-mono italic truncate max-w-[150px]">${safeHwid}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick client integration url segment -->
      <div id="sub_url_block" class="space-y-3 bg-slate-950/40 border border-slate-800/80 p-5 rounded-2xl">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-2 select-none">
          <div>
            <h3 class="text-sm font-bold text-slate-200">
              ${activeSingleFormat ? activeSingleFormat.toUpperCase() + " Direct sub URL" : "Auto-Sync Subscription URL"}
            </h3>
            <p class="text-xs text-slate-500">
              Provide this direct link to client apps sync engines to fetch verified node profiles dynamically.
            </p>
          </div>
          <button 
            type="button" 
            id="sub-url-copy-btn"
            onclick="navigator.clipboard.writeText('${activeUrl}').then(() => { showToast('toast-notify'); });"
            class="flex items-center justify-center bg-teal-500 hover:bg-teal-400 text-slate-950 px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap self-start md:self-auto shadow-lg shadow-teal-500/10 cursor-pointer"
          >
            <svg class="h-3.5 w-3.5 mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
            Copy URL
          </button>
        </div>
        <div class="bg-slate-950 border border-slate-900 rounded-xl p-3 select-all overflow-x-auto text-xs text-slate-300 font-mono whitespace-nowrap">
          ${activeUrl}
        </div>
      </div>

      <!-- Tabs and Code viewers section -->
      <div id="sub_tabs_block" class="space-y-4 pt-2">
        ${activeSingleFormat ? `
        <!-- Single format subpage banner -->
        <div class="flex items-center justify-between border-b border-slate-800 pb-2.5 select-none">
          <span class="text-xs text-teal-400 font-mono font-bold uppercase tracking-wider bg-teal-500/10 border border-teal-500/20 px-2.5 py-1 rounded-md">
            ${activeSingleFormat === "sing-box" ? "Sing-Box Client JSON Config" : 
              activeSingleFormat === "clash" ? "Clash Client Premium YAML" :
              activeSingleFormat === "v2ray" ? "V2Ray b64 links profile" :
              activeSingleFormat === "links" ? "Plain Share links" : "JSON nodes list"}
          </span>
          <a href="${baseSubUrl}" class="text-xs text-slate-400 hover:text-sky-400 underline font-medium transition">&larr; View all formats</a>
        </div>
        ` : `
        <div class="flex flex-wrap border-b border-slate-800/80 gap-1 overflow-x-auto select-none scroller-hidden">
          ${activeTabs.map((tab, idx) => {
            const isTabActive = tab.id === initialTab.id;
            const textClass = isTabActive 
              ? "text-teal-400 border-b-2 border-teal-400 bg-slate-900/50" 
              : "text-slate-400 border-b-2 border-transparent hover:text-slate-200";
            return `
            <button 
              type="button" 
              id="tab-btn-${tab.id}"
              onclick="switchTab('tab-btn-${tab.id}', '${tab.contentId}')"
              class="tab-btn px-4 py-2.5 text-xs font-bold ${textClass} rounded-t-xl transition whitespace-nowrap cursor-pointer"
            >
              ${tab.label}
            </button>`;
          }).join("")}
        </div>
        `}

        <!-- Tab contents wrapper -->
        <div class="relative bg-slate-950 rounded-2xl border border-slate-850 overflow-hidden">
          
          <!-- TAB 1: BASE64 FEED CONTENT -->
          <div id="tab-content-b64" class="tab-content ${b64DisplayClass}">
            <div class="p-3.5 bg-slate-900/30 border-b border-slate-900/60 flex items-center justify-between select-none">
              <span class="text-xs text-slate-400 font-mono font-medium">B64 V2Ray payload (${b64ValueRaw.length} chars)</span>
              <button 
                type="button" 
                id="copy-btn-b64"
                onclick="copyToClipboard('b64-body', 'copy-btn-b64', 'toast-notify')"
                class="flex items-center text-xs text-teal-400 hover:text-teal-300 font-medium font-mono cursor-pointer transition"
              >
                <svg class="h-4 w-4 mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                Copy Config
              </button>
            </div>
            <div id="b64-wrapper" class="p-5 max-h-72 overflow-y-auto relative transition-all duration-300">
              <pre id="b64-body" data-full-text="${b64ValueRaw}" data-is-b64-encoded="false" class="text-xs font-mono text-slate-400 break-all whitespace-pre-wrap select-text leading-relaxed font-semibold"></pre>
              <div id="b64-body-overlay" class="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-slate-950 to-transparent flex items-end justify-center pb-4 hidden select-none">
                <button 
                  type="button" 
                  id="b64-body-expand-btn"
                  onclick="toggleTruncation('b64-body-expand-btn', 'b64-body', 'b64-wrapper', 'b64-body-overlay')"
                  class="bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold px-4 py-2 rounded-xl flex items-center justify-center transition cursor-pointer shadow-lg hidden"
                >
                  <svg class="w-4 h-4 mr-1.5 inline-block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"></path></svg>
                  Show Full Config
                </button>
              </div>
            </div>
          </div>

          <!-- TAB 2: PLAIN CONFIGS CONTENT -->
          <div id="tab-content-plain" class="tab-content ${plainDisplayClass}">
            <div class="p-3.5 bg-slate-900/30 border-b border-slate-900/60 flex items-center justify-between select-none">
              <span class="text-xs text-slate-400 font-mono font-medium">Plain Links Payload (${linksOutputText.length} chars)</span>
              <button 
                type="button" 
                id="copy-btn-plain"
                onclick="copyToClipboard('plain-body', 'copy-btn-plain', 'toast-notify')"
                class="flex items-center text-xs text-teal-400 hover:text-teal-300 font-medium font-mono cursor-pointer transition"
              >
                <svg class="h-4 w-4 mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                Copy Config
              </button>
            </div>
            <div id="plain-wrapper" class="p-5 max-h-72 overflow-y-auto relative transition-all duration-300">
              <pre id="plain-body" data-full-text="${Buffer.from(linksOutputText, "utf-8").toString("base64")}" data-is-b64-encoded="true" class="text-xs font-mono text-slate-400 break-all whitespace-pre-wrap select-text leading-relaxed"></pre>
              <div id="plain-body-overlay" class="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-slate-950 to-transparent flex items-end justify-center pb-4 hidden select-none">
                <button 
                  type="button" 
                  id="plain-body-expand-btn"
                  onclick="toggleTruncation('plain-body-expand-btn', 'plain-body', 'plain-wrapper', 'plain-body-overlay')"
                  class="bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold px-4 py-2 rounded-xl flex items-center justify-center transition cursor-pointer shadow-lg hidden"
                >
                  <svg class="w-4 h-4 mr-1.5 inline-block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"></path></svg>
                  Show Full Config
                </button>
              </div>
            </div>
          </div>

          <!-- TAB 3: SING-BOX CONFIG FILE -->
          <div id="tab-content-singbox" class="tab-content ${singboxDisplayClass}">
            <div class="p-3.5 bg-slate-900/30 border-b border-slate-900/60 flex items-center justify-between select-none">
              <span class="text-xs text-slate-400 font-mono font-medium">Sing-Box Client Profile JSON (${singBoxOutputText.length} chars)</span>
              <button 
                type="button" 
                id="copy-btn-singbox"
                onclick="copyToClipboard('singbox-body', 'copy-btn-singbox', 'toast-notify')"
                class="flex items-center text-xs text-teal-400 hover:text-teal-300 font-medium font-mono cursor-pointer transition"
              >
                <svg class="h-4 w-4 mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                Copy Config
              </button>
            </div>
            <div id="singbox-wrapper" class="p-5 max-h-72 overflow-y-auto relative transition-all duration-300">
              <pre id="singbox-body" data-full-text="${Buffer.from(singBoxOutputText, "utf-8").toString("base64")}" data-is-b64-encoded="true" class="text-xs font-mono text-slate-400 break-all whitespace-pre-wrap select-text leading-relaxed font-sans"></pre>
              <div id="singbox-body-overlay" class="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-slate-950 to-transparent flex items-end justify-center pb-4 hidden select-none">
                <button 
                  type="button" 
                  id="singbox-body-expand-btn"
                  onclick="toggleTruncation('singbox-body-expand-btn', 'singbox-body', 'singbox-wrapper', 'singbox-body-overlay')"
                  class="bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold px-4 py-2 rounded-xl flex items-center justify-center transition cursor-pointer shadow-lg hidden"
                >
                  <svg class="w-4 h-4 mr-1.5 inline-block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"></path></svg>
                  Show Full Config
                </button>
              </div>
            </div>
          </div>

          <!-- TAB 4: CLASH CONFIG FILE -->
          <div id="tab-content-clash" class="tab-content ${clashDisplayClass}">
            <div class="p-3.5 bg-slate-900/30 border-b border-slate-900/60 flex items-center justify-between select-none">
              <span class="text-xs text-slate-400 font-mono font-medium">Clash Client Profile YAML (${clashOutputText.length} chars)</span>
              <button 
                type="button" 
                id="copy-btn-clash"
                onclick="copyToClipboard('clash-body', 'copy-btn-clash', 'toast-notify')"
                class="flex items-center text-xs text-teal-400 hover:text-teal-300 font-medium font-mono cursor-pointer transition"
              >
                <svg class="h-4 w-4 mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 5a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                Copy Config
              </button>
            </div>
            <div id="clash-wrapper" class="p-5 max-h-72 overflow-y-auto relative transition-all duration-300">
              <pre id="clash-body" data-full-text="${Buffer.from(clashOutputText, "utf-8").toString("base64")}" data-is-b64-encoded="true" class="text-xs font-mono text-slate-400 break-all whitespace-pre-wrap select-text leading-relaxed font-sans"></pre>
              <div id="clash-body-overlay" class="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-slate-950 to-transparent flex items-end justify-center pb-4 hidden select-none">
                <button 
                  type="button" 
                  id="clash-body-expand-btn"
                  onclick="toggleTruncation('clash-body-expand-btn', 'clash-body', 'clash-wrapper', 'clash-body-overlay')"
                  class="bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold px-4 py-2 rounded-xl flex items-center justify-center transition cursor-pointer shadow-lg hidden"
                >
                  <svg class="w-4 h-4 mr-1.5 inline-block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"></path></svg>
                  Show Full Config
                </button>
              </div>
            </div>
          </div>

          <!-- TAB 5: JSON NODES CONTENT -->
          <div id="tab-content-json" class="tab-content ${jsonDisplayClass}">
            <div class="p-3.5 bg-slate-900/30 border-b border-slate-900/60 flex items-center justify-between select-none">
              <span class="text-xs text-slate-400 font-mono font-medium">Nodes JSON Array Payload (${jsonOutputText.length} chars)</span>
              <button 
                type="button" 
                id="copy-btn-json"
                onclick="copyToClipboard('json-body', 'copy-btn-json', 'toast-notify')"
                class="flex items-center text-xs text-teal-400 hover:text-teal-300 font-medium font-mono cursor-pointer transition"
              >
                <svg class="h-4 w-4 mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                Copy Config
              </button>
            </div>
            <div id="json-wrapper" class="p-5 max-h-72 overflow-y-auto relative transition-all duration-300">
              <pre id="json-body" data-full-text="${Buffer.from(jsonOutputText, "utf-8").toString("base64")}" data-is-b64-encoded="true" class="text-xs font-mono text-slate-400 break-all whitespace-pre-wrap select-text leading-relaxed font-sans"></pre>
              <div id="json-body-overlay" class="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-slate-950 to-transparent flex items-end justify-center pb-4 hidden select-none">
                <button 
                  type="button" 
                  id="json-body-expand-btn"
                  onclick="toggleTruncation('json-body-expand-btn', 'json-body', 'json-wrapper', 'json-body-overlay')"
                  class="bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold px-4 py-2 rounded-xl flex items-center justify-center transition cursor-pointer shadow-lg hidden"
                >
                  <svg class="w-4 h-4 mr-1.5 inline-block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"></path></svg>
                  Show Full Config
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

    </div>
    
    <!-- Footer Section with Limoo attribution -->
    <div class="text-center text-xs text-slate-600 font-mono py-4 select-none">
      Powered by <span class="text-teal-400/80 font-semibold font-sans">Limoo Gateway Service</span> &bull; Security Verified &bull; 2026
    </div>

  </div>

  <!-- Toast alert template notification container -->
  <div id="toast-notify" class="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-800 text-teal-400 px-5 py-3 rounded-2xl shadow-2xl flex items-center space-x-2.5 transition-all duration-300 opacity-0 translate-y-2 pointer-events-none z-50 select-none">
    <svg class="h-4.5 w-4.5 text-teal-400" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
    <span class="text-xs font-semibold">Config payload copied to your clipboard!</span>
  </div>

  <script>
    function decodeUtf8B64(str) {
      try {
        return decodeURIComponent(escape(atob(str)));
      } catch (err) {
        return atob(str);
      }
    }

    function copyToClipboard(bodyId, buttonId, toastId) {
      const el = document.getElementById(bodyId);
      if (!el) return;
      
      const raw = el.getAttribute("data-full-text") || "";
      const isEncoded = el.getAttribute("data-is-b64-encoded") === "true" || el.id !== "b64-body";
      const fullText = isEncoded ? decodeUtf8B64(raw) : raw;

      navigator.clipboard.writeText(fullText).then(() => {
        showToast(toastId);
        
        const btn = document.getElementById(buttonId);
        if (btn) {
          const origHtml = btn.innerHTML;
          btn.innerHTML = \`<svg class="h-4 w-4 mr-1 text-emerald-400 inline-block" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"></path></svg><span>Copied!</span>\`;
          setTimeout(() => { btn.innerHTML = origHtml; }, 2000);
        }
      }).catch(err => {
        console.error("Copy operation failed: ", err);
      });
    }

    function showToast(toastId) {
      const toast = document.getElementById(toastId);
      if (toast) {
        toast.classList.remove("opacity-0", "translate-y-2", "pointer-events-none");
        toast.classList.add("opacity-100", "translate-y-0");
        setTimeout(() => {
          toast.classList.remove("opacity-100", "translate-y-0");
          toast.classList.add("opacity-0", "translate-y-2", "pointer-events-none");
        }, 2200);
      }
    }

    function switchTab(btnId, targetContentId) {
      const tabs = document.querySelectorAll(".tab-content");
      tabs.forEach(tab => { tab.classList.add("hidden"); tab.classList.remove("block"); });
      
      const tabBtns = document.querySelectorAll(".tab-btn");
      tabBtns.forEach(btn => {
        btn.classList.remove("text-teal-400", "border-teal-400", "bg-slate-900/50");
        btn.classList.add("text-slate-400", "border-transparent", "hover:text-slate-200");
      });
      
      const target = document.getElementById(targetContentId);
      if (target) {
        target.classList.remove("hidden");
        target.classList.add("block");
      }
      
      const clickedBtn = document.getElementById(btnId);
      if (clickedBtn) {
        clickedBtn.classList.remove("text-slate-400", "border-transparent", "hover:text-slate-200");
        clickedBtn.classList.add("text-teal-400", "border-teal-400", "bg-slate-900/50");
      }
    }

    function toggleTruncation(btnId, bodyId, wrapperId, overlayId) {
      const body = document.getElementById(bodyId);
      const wrapper = document.getElementById(wrapperId);
      const overlay = document.getElementById(overlayId);
      const btn = document.getElementById(btnId);
      if (!body || !wrapper || !overlay || !btn) return;
      
      const raw = body.getAttribute("data-full-text") || "";
      const isEncoded = body.getAttribute("data-is-b64-encoded") === "true" || bodyId !== "b64-body";
      const fullText = isEncoded ? decodeUtf8B64(raw) : raw;
      
      const isTruncated = body.getAttribute("data-truncated") === "true";
      
      if (isTruncated) {
        body.innerText = fullText;
        body.setAttribute("data-truncated", "false");
        overlay.classList.add("hidden");
        wrapper.classList.remove("max-h-72");
        wrapper.classList.add("max-h-[500px]");
        btn.innerHTML = \`<svg class="w-4 h-4 mr-1.5 inline-block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5"></path></svg>Collapse Preview\`;
      } else {
        const limit = 500;
        body.innerText = fullText.substring(0, limit) + "\\n\\n... [TRUNCATED - PLEASE CLICK SHOW FULL OR USE COPY BUTTON]";
        body.setAttribute("data-truncated", "true");
        overlay.classList.remove("hidden");
        wrapper.classList.remove("max-h-[500px]");
        wrapper.classList.add("max-h-72");
        btn.innerHTML = \`<svg class="w-4 h-4 mr-1.5 inline-block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"></path></svg>Show Full Config\`;
      }
    }

    document.addEventListener("DOMContentLoaded", () => {
      const elementIds = ["b64-body", "plain-body", "singbox-body", "clash-body", "json-body"];
      elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        
        const raw = el.getAttribute("data-full-text") || "";
        const isEncoded = el.getAttribute("data-is-b64-encoded") === "true" || id !== "b64-body";
        const full = isEncoded ? decodeUtf8B64(raw) : raw;
        
        const limitCh = 650;
        
        if (full.length > limitCh) {
          el.innerText = full.substring(0, 500) + "\\n\\n... [TRUNCATED - PLEASE CLICK SHOW FULL OR USE COPY BUTTON]";
          el.setAttribute("data-truncated", "true");
          
          const btnId = id + "-expand-btn";
          const overlayId = id + "-overlay";
          const btn = document.getElementById(btnId);
          const overlay = document.getElementById(overlayId);
          if (btn) btn.classList.remove("hidden");
          if (overlay) overlay.classList.remove("hidden");
        } else {
          el.innerText = full;
          el.setAttribute("data-truncated", "false");
        }
      });
    });
  </script>
</body>
</html>`;

      return new NextResponse(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    const resultText = generateProcessedSubscription(sub, format);

    if (format === "sing-box") {
      return new NextResponse(resultText, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    if (format === "clash") {
      return new NextResponse(resultText, {
        status: 200,
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    if (format === "json") {
      return new NextResponse(resultText, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    // Default raw links or base64 links handling
    if (isRaw) {
      return new NextResponse(resultText, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Subscription-Userinfo": "upload=0; download=0; total=1073741824000; expire=0", 
        },
      });
    }

    const base64Value = Buffer.from(resultText, "utf-8").toString("base64");

    return new NextResponse(base64Value, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Subscription-Userinfo": "upload=0; download=0; total=1073741824000; expire=0",
      },
    });
  } catch (err: any) {
    console.error("Subscription output failed: ", err);
    return new NextResponse(`Internal Server Error: ${err.message}`, { status: 500 });
  }
}
