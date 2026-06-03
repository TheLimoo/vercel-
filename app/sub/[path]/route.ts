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

    // Fallback guess to the default format or first enabled format if the guessed format is disabled
    if (!rawFormat && !enabledFormats.includes(format)) {
      if (sub.defaultFormat && enabledFormats.includes(sub.defaultFormat)) {
        format = sub.defaultFormat as any;
      } else {
        const firstEnabled = ["links", "plain", "sing-box", "clash", "json"].find(f => enabledFormats.includes(f));
        if (firstEnabled) {
          format = firstEnabled as any;
        }
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

      // Determine what format key is the default format.
      // If only 1 format is checked, that one becomes the only default format.
      // Otherwise, we look at sub.defaultFormat. If it is enabled, we use it.
      // Otherwise, the first enabled format from available formats.
      let chosenDefaultFormat = "links";
      if (enabledFormats.length === 1) {
        chosenDefaultFormat = enabledFormats[0];
      } else if (sub.defaultFormat && enabledFormats.includes(sub.defaultFormat)) {
        chosenDefaultFormat = sub.defaultFormat;
      } else if (enabledFormats.length > 0) {
        chosenDefaultFormat = enabledFormats[0];
      }

      const activeTabs = formatTabConfig.filter(t => enabledFormats.includes(t.key));
      const defaultTabConfigEntry = formatTabConfig.find(t => t.key === chosenDefaultFormat);
      const initialTab = defaultTabConfigEntry && enabledFormats.includes(chosenDefaultFormat)
        ? defaultTabConfigEntry
        : (activeTabs[0] || { id: "b64", key: "links", contentId: "tab-content-b64" });

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
      if (!activeFormatSlug) {
        const key = chosenDefaultFormat;
        if (key === "links") {
          activeFormatSlug = "?format=links";
        } else if (key === "plain") {
          activeFormatSlug = "?format=plain";
        } else {
          activeFormatSlug = key; // e.g., "sing-box", "clash", "json"
        }
      }
      
      const subNameHash = `#${encodeURIComponent(sub.name || "Unnamed")}`;
      const activeUrl = (activeFormatSlug 
        ? (activeFormatSlug.startsWith("?") ? `${baseSubUrl}${activeFormatSlug}` : `${baseSubUrl}/${activeFormatSlug}`)
        : baseSubUrl) + subNameHash;

      const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🍋 Limoo Gateway &mdash; ${safeName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;650;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;505;600&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
    }
    h1, h2, h3, h4, .font-display {
      font-family: 'Space Grotesk', sans-serif;
    }
    .font-mono {
      font-family: 'JetBrains Mono', monospace;
    }
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: rgba(8, 15, 8, 0.4);
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(132, 204, 22, 0.2);
      border-radius: 9999px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(132, 204, 22, 0.5);
    }
    .lime-glow {
      box-shadow: 0 0 35px -5px rgba(132, 204, 22, 0.15);
    }
    .citrus-gradient {
      background: linear-gradient(135deg, #a3e635 0%, #facc15 100%);
    }
    
    /* Subtle background bubble float */
    @keyframes floatBubble {
      0% { transform: translateY(100vh) scale(0.8); opacity: 0; }
      10% { opacity: 0.12; }
      90% { opacity: 0.12; }
      100% { transform: translateY(-20vh) scale(1.2); opacity: 0; }
    }
    .citrus-bubble {
      position: absolute;
      background: radial-gradient(circle, rgba(163, 230, 53, 0.15) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
      z-index: 0;
    }
  </style>
</head>
<body class="bg-black text-slate-100 min-h-screen relative flex flex-col items-center justify-start p-4 md:p-8 antialiased overflow-x-hidden selection:bg-lime-500/30 selection:text-lime-300">
  
  <!-- GLOWING LIME ORBS ATMOSPHERE -->
  <div class="absolute inset-x-0 top-0 h-[500px] bg-[radial-gradient(circle_at_top_right,rgba(163,230,53,0.08),transparent_55%)] pointer-events-none"></div>
  <div class="absolute inset-x-0 bottom-0 h-[600px] bg-[radial-gradient(circle_at_bottom_left,rgba(250,204,21,0.04),transparent_60%)] pointer-events-none"></div>

  <!-- FLOATING BUBBLES BACKGROUND DECORATION -->
  <div class="absolute inset-0 overflow-hidden pointer-events-none">
    <div class="citrus-bubble w-40 h-40 left-[10%] opacity-10" style="animation: floatBubble 22s infinite linear; bottom: -150px;"></div>
    <div class="citrus-bubble w-28 h-28 right-[15%] opacity-10" style="animation: floatBubble 18s infinite linear 4s; bottom: -120px;"></div>
    <div class="citrus-bubble w-48 h-48 left-[75%] opacity-10" style="animation: floatBubble 26s infinite linear 9s; bottom: -180px;"></div>
  </div>

  <div class="max-w-3xl w-full space-y-8 my-auto py-8 relative z-10">
    
    <!-- Limoo elegant logo and header -->
    <div class="text-center space-y-4 p-2 relative">
      <div class="inline-flex items-center justify-center p-4 bg-lime-500/10 border border-lime-500/20 rounded-[2rem] shadow-xl shadow-lime-500/5 select-none transition-transform hover:scale-105 duration-300">
        <span class="text-4xl filter drop-shadow-[0_4px_10px_rgba(132,204,22,0.3)] select-none">🍋</span>
      </div>
      <div>
        <h1 class="text-3xl md:text-4xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2 select-none">
          <span class="text-transparent bg-clip-text bg-gradient-to-r from-lime-400 to-yellow-350 font-black">Limoo</span>
          <span class="text-slate-400 font-light">&bull; Secure Proxy Feed</span>
        </h1>
        <p class="text-slate-500 text-[10px] mt-1.5 font-mono tracking-widest uppercase select-none flex items-center justify-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-lime-400 animate-ping"></span>
          Sync Engine &bull; Core Pruning Active
        </p>
      </div>
    </div>

    <!-- Main subscription details card -->
    <div class="bg-slate-900/30 backdrop-blur-xl rounded-3xl border border-slate-900/80 p-6 md:p-8 space-y-6 shadow-2xl relative lime-glow">
      <!-- Glow decoration item -->
      <div class="absolute -top-12 -right-12 w-36 h-36 bg-lime-500/5 rounded-full blur-3xl pointer-events-none select-none"></div>
      
      <!-- Diagnostic indicators -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 select-none">
        <div class="p-3 bg-slate-950/60 border border-slate-900/70 rounded-2xl flex flex-col justify-between">
          <span class="text-[10px] uppercase font-mono tracking-wider text-slate-450 block">Feed Status</span>
          <span class="text-xs font-bold text-lime-400 mt-1 flex items-center gap-1">
            <span class="inline-block w-2.5 h-2.5 rounded-full bg-lime-400/20 text-lime-400 animate-pulse text-[10px] text-center leading-none">●</span>
            Freshly Squeezed
          </span>
        </div>
        <div class="p-3 bg-slate-950/60 border border-slate-900/70 rounded-2xl flex flex-col justify-between">
          <span class="text-[10px] uppercase font-mono tracking-wider text-slate-450 block">Available Nodes</span>
          <span class="text-xs font-bold text-white mt-1 font-mono">${totalServers} Servers</span>
        </div>
        <div class="p-3 bg-slate-950/60 border border-slate-900/70 rounded-2xl flex flex-col justify-between">
          <span class="text-[10px] uppercase font-mono tracking-wider text-slate-450 block">Dummies</span>
          <span class="text-xs font-semibold text-slate-400 mt-1 font-mono">${totalDummies} Banners</span>
        </div>
        <div class="p-3 bg-slate-950/60 border border-slate-900/70 rounded-2xl flex flex-col justify-between col-span-2 md:col-span-1">
          <span class="text-[10px] uppercase font-mono tracking-wider text-slate-450 block">Compression</span>
          <span class="text-xs font-bold text-yellow-400 mt-1 font-mono">Pruned 60s Cached</span>
        </div>
      </div>

      <!-- Sub info grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-zinc-900/60 select-none">
        <div class="space-y-4">
          <h2 class="text-xs font-mono font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <span class="w-1 h-3 rounded bg-lime-400"></span> Profile parameters
          </h2>
          <div class="space-y-2.5">
            <div class="flex items-center justify-between border-b border-slate-900/40 pb-1.5">
              <span class="text-xs text-slate-400">Label</span>
              <span class="text-xs font-semibold text-white font-mono bg-zinc-900/50 px-2.5 py-1 rounded" title="${safeName}">${safeName}</span>
            </div>
            <div class="flex items-center justify-between border-b border-slate-900/40 pb-1.5">
              <span class="text-xs text-slate-400">Relative Path</span>
              <span class="text-xs font-mono bg-slate-950 px-2 py-0.5 rounded text-lime-400 border border-slate-900">/${safePath}${activeSingleFormat ? "/" + activeSingleFormat : ""}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-xs text-slate-400">Node Splicer</span>
              <span class="text-xs text-slate-300 font-mono">Custom template rules</span>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <h2 class="text-xs font-mono font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <span class="w-1 h-3 rounded bg-lime-400"></span> Session Context
          </h2>
          <div class="space-y-2.5">
            <div class="flex items-center justify-between border-b border-slate-900/40 pb-1.5">
              <span class="text-xs text-slate-400">Client Address</span>
              <span class="text-xs font-semibold text-slate-200 font-mono" title="Your external IP address">${safeIp}</span>
            </div>
            <div class="flex items-center justify-between border-b border-slate-900/40 pb-1.5">
              <span class="text-xs text-slate-400">Resolved Client</span>
              <span class="text-xs text-slate-300 max-w-[200px] truncate font-mono text-right" title="${safeDeviceType}">${safeDeviceType}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-xs text-slate-400">Hardware Fingerprint</span>
              <span class="text-xs text-slate-450 font-mono italic truncate max-w-[150px] text-right" title="${safeHwid}">${safeHwid}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick client integration url segment -->
      <div id="sub_url_block" class="space-y-3 bg-slate-950/60 border border-slate-900 p-5 rounded-2xl relative">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 select-none">
          <div class="space-y-1">
            <h3 class="text-sm font-bold text-slate-200 flex items-center gap-1.5">
              <span>⚡</span> ${activeSingleFormat ? activeSingleFormat.toUpperCase() + " Direct subscription URL" : "Auto-Sync Subscription URL"}
            </h3>
            <p class="text-xs text-slate-500 leading-normal max-w-xl">
              Add this primary connection URL directly to your clients (Shadowrocket, v2rayNG, sing-box, Clash, FoXray).
            </p>
          </div>
          <button 
            type="button" 
            id="sub-url-copy-btn"
            onclick="navigator.clipboard.writeText('${activeUrl}').then(() => { showToast('toast-notify'); });"
            class="flex items-center justify-center bg-lime-400 hover:bg-lime-300 active:bg-lime-500 text-slate-950 px-5 py-2.5 rounded-xl text-xs font-extrabold transition-all self-start md:self-auto shadow-lg shadow-lime-500/10 cursor-pointer"
          >
            <svg class="h-3.5 w-3.5 mr-1" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
            Copy URL
          </button>
        </div>
        <div class="bg-black/80 border border-slate-900 rounded-xl p-3 select-all overflow-x-auto text-xs text-lime-400/90 font-mono whitespace-nowrap leading-none select-all relative group">
          <span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-650 font-sans uppercase pointer-events-none group-hover:text-amber-500/80 transition">Auto-Select</span>
          ${activeUrl}
        </div>
      </div>

      <!-- Tabs and Code viewers section -->
      <div id="sub_tabs_block" class="space-y-4 pt-2">
        ${activeSingleFormat ? `
        <!-- Single format subpage banner -->
        <div class="flex items-center justify-between border-b border-slate-900 pb-2.5 select-none">
          <span class="text-xs text-lime-400 font-mono font-bold uppercase tracking-wider bg-lime-500/5 border border-lime-500/20 px-2.5 py-1 rounded-md">
            ${activeSingleFormat === "sing-box" ? "Sing-Box Client JSON Config" : 
              activeSingleFormat === "clash" ? "Clash Client Premium YAML" :
              activeSingleFormat === "v2ray" ? "V2Ray b64 links profile" :
              activeSingleFormat === "links" ? "Plain Share links" : "JSON nodes list"}
          </span>
          <a href="${baseSubUrl}" class="text-xs text-slate-400 hover:text-lime-400 underline font-medium transition">&larr; View all formats</a>
        </div>
        ` : `
        <div class="flex flex-wrap border-b border-slate-900 gap-1 overflow-x-auto select-none scroller-hidden">
          ${activeTabs.map((tab, idx) => {
            const isTabActive = tab.id === initialTab.id;
            const textClass = isTabActive 
              ? "text-lime-400 border-lime-400/80 bg-lime-950/20 shadow-inner" 
              : "text-slate-400 border-transparent hover:text-slate-200 hover:border-slate-800";
            return `
            <button 
              type="button" 
              id="tab-btn-${tab.id}"
              onclick="switchTab('tab-btn-${tab.id}', '${tab.contentId}')"
              class="tab-btn px-4 py-3 text-xs font-bold border-b-2 ${textClass} rounded-t-xl transition-all whitespace-nowrap cursor-pointer"
            >
              ${tab.label}
            </button>`;
          }).join("")}
        </div>
        `}

        <!-- Tab contents wrapper -->
        <div class="relative bg-black rounded-2xl border border-slate-900 overflow-hidden">
          
          <!-- TAB 1: BASE64 FEED CONTENT -->
          <div id="tab-content-b64" class="tab-content ${b64DisplayClass}">
            <div class="p-3.5 bg-slate-900/10 border-b border-slate-900/60 flex items-center justify-between select-none">
              <span class="text-xs text-slate-450 font-mono font-medium">B64 V2Ray payload (${b64ValueRaw.length} chars)</span>
              <button 
                type="button" 
                id="copy-btn-b64"
                onclick="copyToClipboard('b64-body', 'copy-btn-b64', 'toast-notify')"
                class="flex items-center text-xs text-lime-400 hover:text-lime-350 font-bold font-mono cursor-pointer transition"
              >
                <svg class="h-4 w-4 mr-1 inline" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                Copy Raw Payload
              </button>
            </div>
            <div id="b64-wrapper" class="p-5 max-h-72 overflow-y-auto relative transition-all duration-300">
              <pre id="b64-body" data-full-text="${b64ValueRaw}" data-is-b64-encoded="false" class="text-xs font-mono text-slate-400 break-all whitespace-pre-wrap select-text leading-relaxed font-semibold"></pre>
              <div id="b64-body-overlay" class="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black to-transparent flex items-end justify-center pb-4 hidden select-none">
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
            <div class="p-3.5 bg-slate-900/10 border-b border-slate-900/60 flex items-center justify-between select-none">
              <span class="text-xs text-slate-450 font-mono font-medium">Plain Links Payload (${linksOutputText.length} chars)</span>
              <button 
                type="button" 
                id="copy-btn-plain"
                onclick="copyToClipboard('plain-body', 'copy-btn-plain', 'toast-notify')"
                class="flex items-center text-xs text-lime-400 hover:text-lime-350 font-bold font-mono cursor-pointer transition"
              >
                <svg class="h-4 w-4 mr-1 inline" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                Copy Raw Payload
              </button>
            </div>
            <div id="plain-wrapper" class="p-5 max-h-72 overflow-y-auto relative transition-all duration-300">
              <pre id="plain-body" data-full-text="${Buffer.from(linksOutputText, "utf-8").toString("base64")}" data-is-b64-encoded="true" class="text-xs font-mono text-slate-400 break-all whitespace-pre-wrap select-text leading-relaxed"></pre>
              <div id="plain-body-overlay" class="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black to-transparent flex items-end justify-center pb-4 hidden select-none">
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
            <div class="p-3.5 bg-slate-900/10 border-b border-slate-900/60 flex items-center justify-between select-none">
              <span class="text-xs text-slate-450 font-mono font-medium">Sing-Box Client Profile JSON (${singBoxOutputText.length} chars)</span>
              <button 
                type="button" 
                id="copy-btn-singbox"
                onclick="copyToClipboard('singbox-body', 'copy-btn-singbox', 'toast-notify')"
                class="flex items-center text-xs text-lime-400 hover:text-lime-350 font-bold font-mono cursor-pointer transition"
              >
                <svg class="h-4 w-4 mr-1 inline" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                Copy Raw Payload
              </button>
            </div>
            <div id="singbox-wrapper" class="p-5 max-h-72 overflow-y-auto relative transition-all duration-300">
              <pre id="singbox-body" data-full-text="${Buffer.from(singBoxOutputText, "utf-8").toString("base64")}" data-is-b64-encoded="true" class="text-xs font-mono text-slate-450 break-all whitespace-pre-wrap select-text leading-relaxed font-sans"></pre>
              <div id="singbox-body-overlay" class="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black to-transparent flex items-end justify-center pb-4 hidden select-none">
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
            <div class="p-3.5 bg-slate-900/10 border-b border-slate-900/60 flex items-center justify-between select-none">
              <span class="text-xs text-slate-450 font-mono font-medium">Clash Client Profile YAML (${clashOutputText.length} chars)</span>
              <button 
                type="button" 
                id="copy-btn-clash"
                onclick="copyToClipboard('clash-body', 'copy-btn-clash', 'toast-notify')"
                class="flex items-center text-xs text-lime-400 hover:text-lime-350 font-bold font-mono cursor-pointer transition"
              >
                <svg class="h-4 w-4 mr-1 inline" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                Copy Raw Payload
              </button>
            </div>
            <div id="clash-wrapper" class="p-5 max-h-72 overflow-y-auto relative transition-all duration-300">
              <pre id="clash-body" data-full-text="${Buffer.from(clashOutputText, "utf-8").toString("base64")}" data-is-b64-encoded="true" class="text-xs font-mono text-slate-450 break-all whitespace-pre-wrap select-text leading-relaxed font-sans"></pre>
              <div id="clash-body-overlay" class="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black to-transparent flex items-end justify-center pb-4 hidden select-none">
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
            <div class="p-3.5 bg-slate-900/10 border-b border-slate-900/60 flex items-center justify-between select-none">
              <span class="text-xs text-slate-450 font-mono font-medium">Nodes JSON Array Payload (${jsonOutputText.length} chars)</span>
              <button 
                type="button" 
                id="copy-btn-json"
                onclick="copyToClipboard('json-body', 'copy-btn-json', 'toast-notify')"
                class="flex items-center text-xs text-lime-400 hover:text-lime-350 font-bold font-mono cursor-pointer transition"
              >
                <svg class="h-4 w-4 mr-1 inline" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                Copy Raw Payload
              </button>
            </div>
            <div id="json-wrapper" class="p-5 max-h-72 overflow-y-auto relative transition-all duration-300">
              <pre id="json-body" data-full-text="${Buffer.from(jsonOutputText, "utf-8").toString("base64")}" data-is-b64-encoded="true" class="text-xs font-mono text-slate-450 break-all whitespace-pre-wrap select-text leading-relaxed font-sans"></pre>
              <div id="json-body-overlay" class="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black to-transparent flex items-end justify-center pb-4 hidden select-none">
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
    <div class="text-center text-xs text-slate-605 font-mono py-4 select-none">
      Powered by <span class="text-lime-400 font-semibold font-sans">🍋 Limoo Gateway Engine</span> &bull; Privacy Optimized &bull; 2026
    </div>

  </div>

  <!-- Toast alert template notification container -->
  <div id="toast-notify" class="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-xl border border-lime-500/30 text-lime-400 px-6 py-3.5 rounded-2xl shadow-2xl flex items-center space-x-3 transition-all duration-300 opacity-0 translate-y-2 pointer-events-none z-50 select-none shadow-lime-500/10">
    <span class="text-base">🍋</span>
    <span class="text-xs font-bold font-sans">Limoo Payload copied successfully!</span>
  </div>

  <script>
    // Safe Base64 decoder supporting UTF-8 characters
    function decodeUtf8B64(str) {
      if (!str) return "";
      try {
        return decodeURIComponent(escape(atob(str)));
      } catch (err) {
        try {
          return atob(str);
        } catch (e) {
          return str;
        }
      }
    }

    // Modern Toast notification
    function showToast(toastId) {
      const toast = document.getElementById(toastId);
      if (toast) {
        toast.classList.remove("opacity-0", "translate-y-2", "pointer-events-none");
        toast.classList.add("opacity-100", "translate-y-0");
        setTimeout(() => {
          toast.classList.remove("opacity-100", "translate-y-0");
          toast.classList.add("opacity-0", "translate-y-2", "pointer-events-none");
        }, 2500);
      }
    }

    // Dynamic copyToClipboard helper
    function copyToClipboard(bodyId, buttonId, toastId) {
      const el = document.getElementById(bodyId);
      if (!el) return;
      
      const raw = el.getAttribute("data-full-text") || "";
      const isEncoded = el.getAttribute("data-is-b64-encoded") === "true";
      const fullText = isEncoded ? decodeUtf8B64(raw) : raw;

      navigator.clipboard.writeText(fullText).then(() => {
        showToast(toastId);
        
        const btn = document.getElementById(buttonId);
        if (btn) {
          const origHtml = btn.innerHTML;
          btn.innerHTML = '<svg class="h-4 w-4 mr-1 text-lime-400 inline-block" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"></path></svg><span>Copied!</span>';
          setTimeout(() => { btn.innerHTML = origHtml; }, 2000);
        }
      }).catch(err => {
        console.error("Copy operation failed: ", err);
      });
    }

    // Switch tab logic
    function switchTab(btnId, targetContentId) {
      const tabs = document.querySelectorAll(".tab-content");
      tabs.forEach(tab => {
        tab.classList.add("hidden");
        tab.classList.remove("block");
      });
      
      const tabBtns = document.querySelectorAll(".tab-btn");
      tabBtns.forEach(btn => {
        btn.classList.remove("text-lime-400", "border-lime-400/80", "bg-lime-950/20", "shadow-inner");
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
        clickedBtn.classList.add("text-lime-400", "border-lime-400/80", "bg-lime-950/20", "shadow-inner");
      }
    }

    // Toggle height of card container dynamically without replacing HTML texts
    function toggleTruncation(btnId, bodyId, wrapperId, overlayId) {
      const wrapper = document.getElementById(wrapperId);
      const overlay = document.getElementById(overlayId);
      const btn = document.getElementById(btnId);
      if (!wrapper || !overlay || !btn) return;
      
      const isCollapsed = wrapper.classList.contains("max-h-72");
      
      if (isCollapsed) {
        wrapper.classList.remove("max-h-72", "overflow-hidden");
        wrapper.classList.add("max-h-[1500px]", "overflow-y-auto");
        overlay.classList.add("hidden");
        btn.innerHTML = '<svg class="w-4 h-4 mr-1.5 inline-block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5"></path></svg>Collapse Profile';
      } else {
        wrapper.classList.remove("max-h-[1500px]", "overflow-y-auto");
        wrapper.classList.add("max-h-72", "overflow-hidden");
        overlay.classList.remove("hidden");
        btn.innerHTML = '<svg class="w-4 h-4 mr-1.5 inline-block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"></path></svg>Show Full Profile';
      }
    }

    // Self-contained page content loader which runs reliably
    document.addEventListener("DOMContentLoaded", () => {
      const elementIds = ["b64-body", "plain-body", "singbox-body", "clash-body", "json-body"];
      elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        
        const raw = el.getAttribute("data-full-text") || "";
        const isEncoded = el.getAttribute("data-is-b64-encoded") === "true";
        const fullContent = isEncoded ? decodeUtf8B64(raw) : raw;
        
        // Safely assign full decoded content
        el.textContent = fullContent;
        
        // Calculate dimensions to toggle wrapper and expand buttons dynamically
        setTimeout(() => {
          const wrapperId = id.replace("-body", "-wrapper");
          const overlayId = id.replace("-body", "-body-overlay");
          const btnId = id.replace("-body", "-body-expand-btn");
          
          const wrapper = document.getElementById(wrapperId);
          const overlay = document.getElementById(overlayId);
          const btn = document.getElementById(btnId);
          
          if (wrapper && overlay && btn) {
            if (el.scrollHeight > 280) {
              wrapper.classList.add("max-h-72", "overflow-hidden");
              overlay.classList.remove("hidden");
              btn.classList.remove("hidden");
            } else {
              wrapper.classList.remove("max-h-72");
              overlay.classList.add("hidden");
              btn.classList.add("hidden");
            }
          }
        }, 100);
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
