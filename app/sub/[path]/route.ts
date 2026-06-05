import { NextRequest, NextResponse } from "next/server";
import { getKV, logSubAccess } from "@/lib/db";
import { Subscription, generateProcessedSubscription, extractConfigsList, parseV2rayLink, convertJsonConfigToShareLink, updateConfigRemark } from "@/lib/v2ray";

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
    let sub = currentList.find(s => s.path.toLowerCase() === path.toLowerCase());
    let isAlternativePath = false;

    if (!sub) {
      sub = currentList.find(s => s.alternativePath && s.alternativePath.toLowerCase() === path.toLowerCase());
      if (sub) {
        isAlternativePath = true;
      }
    }

    if (!sub) {
      return new NextResponse("Subscription configuration not found.", { status: 404 });
    }

    if (isAlternativePath) {
      sub = {
        ...sub,
        path: sub.alternativePath || sub.path,
        jsonConfigs: sub.alternativeJsonConfigs || "",
        nameOverrides: {},
      };
    }

    const { searchParams } = new URL(req.url);
    const rawFormat = searchParams.get("format");
    const isRaw = searchParams.get("raw") === "true" || searchParams.get("flag") === "raw";

    const ip = extractIP(req);
    const ua = req.headers.get("user-agent") || "";
    const hwid = extractHWID(req, searchParams);
    const deviceType = parseUserAgent(ua);
    const uaLower = ua.toLowerCase();

    // Dynamically retrieve additional links from url on-the-fly if needed
    let fetchedAdditionalConfigs: string[] = [];
    if (sub.additionalLink && sub.additionalLink.trim().startsWith("http")) {
      try {
        const fetchRes = await fetch(sub.additionalLink.trim(), { signal: AbortSignal.timeout(3000) });
        if (fetchRes.ok) {
          const text = await fetchRes.text();
          let decoded = text;
          try {
            if (!text.includes("://") && text.trim().length > 10) {
              decoded = Buffer.from(text.trim(), "base64").toString("utf-8");
            }
          } catch {}
          fetchedAdditionalConfigs = decoded.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        }
      } catch (err) {
        console.warn("Could not retrieve external additional subscription feed:", err);
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

    // Standard outputs resolved
    const linksOutputText = generateProcessedSubscription(sub, "links", fetchedAdditionalConfigs);

    if (forceHtml || (isBrowserRequest && !searchParams.get("format") && !searchParams.get("raw"))) {
      const host = req.headers.get("host") || req.nextUrl.host;
      const proto = req.headers.get("x-forwarded-proto") || (req.nextUrl.protocol.replace(":", "") || "https");
      const baseSubUrl = `${proto}://${host}/sub/${sub.path}`;
      const subNameHash = `#${encodeURIComponent(sub.name || "Unnamed")}`;
      const activeUrl = baseSubUrl + subNameHash;

      // Extract details about configurations list for total calculations
      const baseConfigs = extractConfigsList(sub.jsonConfigs || "");
      const rawAlternatives = fetchedAdditionalConfigs.length > 0
        ? fetchedAdditionalConfigs
        : (sub.additionalLink && !sub.additionalLink.trim().startsWith("http")
            ? sub.additionalLink.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
            : []);

      const totalNodes = baseConfigs.length + rawAlternatives.length;

      // Generate the exact pretty JSON string with renamed remarks applied
      const jsonOutputText = generateProcessedSubscription(sub, "json", fetchedAdditionalConfigs);
      const jsonB64 = Buffer.from(jsonOutputText, "utf-8").toString("base64");

      const safeName = (sub.name || "Unnamed").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safePath = (sub.path || "").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeIp = ip.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeDeviceType = deviceType.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeHwid = (hwid || "Not supplied (Browser Session)").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const html = `<!DOCTYPE html>
<html lang="en" class="dark font-sans">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>🍋 Limoo Gateway &mdash; ${safeName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
    }
    h1, h2, h3, .font-display {
      font-family: 'Space Grotesk', sans-serif;
    }
    .font-mono {
      font-family: 'JetBrains Mono', monospace;
    }
    .lime-glow {
      box-shadow: 0 0 40px -10px rgba(163, 230, 53, 0.15);
    }
    /* Simple custom scrollbar styling */
    .scrollbar-thin::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    .scrollbar-thin::-webkit-scrollbar-track {
      background: transparent;
    }
    .scrollbar-thin::-webkit-scrollbar-thumb {
      background: #1e293b;
      border-radius: 4px;
    }
    .scrollbar-thin::-webkit-scrollbar-thumb:hover {
      background: #334155;
    }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen relative flex flex-col items-center justify-start p-4 py-8 antialiased selection:bg-lime-500/30 selection:text-lime-300">
  
  <!-- Glow orbs -->
  <div class="absolute inset-x-0 top-0 h-[400px] bg-[radial-gradient(circle_at_top,rgba(163,230,53,0.06),transparent_60%)] pointer-events-none"></div>

  <div class="max-w-2xl w-full space-y-6 relative z-10 my-auto">
    
    <!-- Header -->
    <div class="text-center space-y-3">
      <div class="inline-flex items-center justify-center p-3.5 bg-lime-500/10 border border-lime-500/20 rounded-2xl shadow-lg shadow-lime-500/5 transition duration-300 pointer-events-none">
        <span class="text-3xl filter drop-shadow-[0_4px_8px_rgba(163,230,53,0.3)]">🍋</span>
      </div>
      <div>
        <h1 class="text-2xl md:text-3xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
          <span class="text-transparent bg-clip-text bg-gradient-to-r from-lime-400 to-yellow-350 font-extrabold">Limoo</span>
          <span class="text-slate-400 font-light">&bull; Secure Gateway</span>
        </h1>
        <p class="text-slate-500 text-[10px] mt-1 font-mono tracking-widest uppercase flex items-center justify-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-lime-400 animate-pulse"></span>
          Core Feed Active
        </p>
      </div>
    </div>

    <!-- Details Card -->
    <div class="bg-slate-900 border border-slate-850 p-5 md:p-6 rounded-3xl space-y-5 lime-glow">
      
      <!-- Metrics Info -->
      <div class="grid grid-cols-2 gap-3">
        <div class="p-3 bg-slate-950 border border-slate-850 rounded-xl flex flex-col justify-between">
          <span class="text-[10px] uppercase font-mono tracking-wider text-slate-500">Status</span>
          <span class="text-xs font-bold text-lime-400 mt-0.5 flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-lime-400 animate-ping"></span> Active
          </span>
        </div>
        <div class="p-3 bg-slate-950 border border-slate-850 rounded-xl flex flex-col justify-between">
          <span class="text-[10px] uppercase font-mono tracking-wider text-slate-500">Active Nodes</span>
          <span class="text-xs font-bold text-white mt-0.5 font-mono">${totalNodes} Servers</span>
        </div>
      </div>

      <!-- Settings List -->
      <div class="space-y-2 border-t border-slate-850 pt-4">
        <div class="flex items-center justify-between py-1 border-b border-slate-850/60 text-xs">
          <span class="text-slate-400">Subscription Name</span>
          <span class="font-bold text-white font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-850">${safeName}</span>
        </div>
        <div class="flex items-center justify-between py-1 border-b border-slate-850/60 text-xs">
          <span class="text-slate-400">Gateway Path</span>
          <span class="font-mono text-lime-400">/sub/${safePath}</span>
        </div>
        <div class="flex items-center justify-between py-1 text-xs">
          <span class="text-slate-400">Client Address</span>
          <span class="font-mono text-slate-300" title="${safeDeviceType}">${safeIp}</span>
        </div>
      </div>

      <!-- Copy Subscription Input Box -->
      <div class="space-y-2.5 bg-slate-950 p-4 rounded-2xl border border-slate-850">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-bold text-slate-300 flex items-center gap-1">
            <span>⚡</span> Sync Subscription URL
          </h3>
          <span class="text-[9px] text-lime-400 bg-lime-400/10 border border-lime-400/20 px-1.5 py-0.5 rounded font-mono">CLIENT LINK</span>
        </div>
        
        <p class="text-[11px] text-slate-500 leading-normal">
          Import this secure URL directly into Shadowrocket, v2rayNG, Sing-Box, or any proxy client app.
        </p>

        <div class="flex items-center gap-2 mt-2">
          <div class="flex-1 bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl text-xs font-mono text-sky-300 truncate select-all relative group" style="line-height: 1.5rem;">
            ${activeUrl}
          </div>
          <button 
            type="button" 
            id="copy-sub-btn"
            onclick="navigator.clipboard.writeText('${activeUrl}').then(() => { showToast('Subscription URL copied!'); });"
            class="flex items-center justify-center bg-lime-400 hover:bg-lime-300 active:bg-lime-500 text-slate-950 p-2.5 rounded-xl transition cursor-pointer shadow-md shadow-lime-500/5"
            title="Copy URL Address"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
          </button>
        </div>
      </div>

      <!-- Copy Client Configurations JSON Viewport -->
      <div class="space-y-3 pt-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
            <span class="inline-block w-1.5 h-3 bg-lime-400 rounded-sm"></span> 
            <span>Configurations File (JSON format)</span>
          </div>
          <button 
            type="button" 
            id="copy-json-btn"
            onclick="navigator.clipboard.writeText(atob('${jsonB64}')).then(() => { showToast('JSON Configs copied!'); });"
            class="flex items-center gap-1.5 bg-lime-500/10 hover:bg-lime-500/20 active:bg-lime-500/30 text-lime-400 border border-lime-500/20 px-30 py-1.5 px-3 rounded-xl text-[11px] font-bold font-mono transition cursor-pointer"
            title="Copy entire JSON configs"
          >
            📋 Copy JSON
          </button>
        </div>

        <div class="relative rounded-2xl border border-slate-850 bg-slate-950 overflow-hidden lime-glow">
          <!-- Window Header (Mac elements decoration) -->
          <div class="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-850 select-none">
            <div class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-rose-500/80"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
            </div>
            <span class="text-[10px] font-mono text-slate-500 tracking-wider font-semibold">configs.json</span>
            <div class="w-12"></div>
          </div>
          
          <!-- Code Block with Client-Side Syntax Accent Colorizing -->
          <pre class="p-4 overflow-auto max-h-[380px] text-[11px] font-mono leading-relaxed text-left break-all whitespace-pre-wrap select-all scrollbar-thin scrollbar-thumb-slate-800" style="word-break: break-all;"><code id="json-code" class="block text-slate-300"></code></pre>
        </div>
      </div>

    </div>

    <!-- Plain Text URL Fallback link -->
    <div class="text-center select-none">
      <a 
        href="/sub/${safePath}?format=links&raw=true" 
        target="_blank"
        class="text-[11px] font-mono text-slate-500 hover:text-lime-400 underline transition-all"
      >
        View RAW base64 connection feed profile &rarr;
      </a>
    </div>

    <!-- Footer -->
    <div class="text-center text-[10px] text-slate-600 font-mono py-2">
      Powered by <span class="text-slate-400 font-semibold font-sans">🍋 Limoo Secure Gateway</span> &bull; 2026
    </div>

  </div>

  <!-- Toast alert notification -->
  <div id="toast-notify" class="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/95 backdrop-blur-xl border border-lime-500/30 text-lime-400 px-5 py-3 rounded-2xl shadow-xl flex items-center space-x-2.5 transition-all duration-300 opacity-0 translate-y-3 pointer-events-none z-50">
    <span class="text-sm">🍋</span>
    <span class="text-xs font-bold toast-title">Successfully copied!</span>
  </div>

  <script>
    function showToast(msg) {
      const toast = document.getElementById("toast-notify");
      if (toast) {
        const titleSpan = toast.querySelector(".toast-title");
        if (titleSpan && msg) {
          titleSpan.textContent = msg;
        }
        toast.classList.remove("opacity-0", "translate-y-3", "pointer-events-none");
        toast.classList.add("opacity-100", "translate-y-0");
        setTimeout(() => {
          toast.classList.remove("opacity-100", "translate-y-0");
          toast.classList.add("opacity-0", "translate-y-3", "pointer-events-none");
        }, 2200);
      }
    }

    // High performance syntax colorization helper mapping to tailwind classes
    function syntaxHighlight(jsonStr) {
      jsonStr = jsonStr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return jsonStr.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\\d+(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)/g, function (match) {
        var cls = 'text-amber-300';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'text-sky-450 font-semibold';
          } else {
            cls = 'text-teal-400';
          }
        } else if (/true|false/.test(match)) {
          cls = 'text-fuchsia-400 font-medium';
        } else if (/null/.test(match)) {
          cls = 'text-rose-400';
        } else {
          cls = 'text-violet-400';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      });
    }

    try {
      const rawB64 = '${jsonB64}';
      const rawJson = atob(rawB64);
      document.getElementById('json-code').innerHTML = syntaxHighlight(rawJson);
    } catch (e) {
      console.error('Failed to parse or render JSON code: ', e);
    }
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

    const activeFormatParam = (rawFormat || sub.defaultFormat || "links").toLowerCase();
    const allowedFormats = ["links", "plain", "json", "sing-box", "clash"];
    const activeFormat = allowedFormats.includes(activeFormatParam)
      ? (activeFormatParam as "links" | "plain" | "json" | "sing-box" | "clash")
      : "links";

    const outputText = generateProcessedSubscription(sub, activeFormat, fetchedAdditionalConfigs);

    if (activeFormat === "json" || activeFormat === "sing-box") {
      return new NextResponse(outputText, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Subscription-Userinfo": "upload=0; download=0; total=1073741824000; expire=0",
        },
      });
    }

    if (activeFormat === "clash") {
      return new NextResponse(outputText, {
        status: 200,
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Subscription-Userinfo": "upload=0; download=0; total=1073741824000; expire=0",
        },
      });
    }

    if (activeFormat === "plain") {
      return new NextResponse(outputText, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Subscription-Userinfo": "upload=0; download=0; total=1073741824000; expire=0",
        },
      });
    }

    // Default "links" fallback - check isRaw flag for base64 vs plain
    if (isRaw) {
      return new NextResponse(outputText, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Subscription-Userinfo": "upload=0; download=0; total=1073741824000; expire=0",
        },
      });
    }

    const base64Value = Buffer.from(outputText, "utf-8").toString("base64");

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
