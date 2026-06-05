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

      // Extract details about internal parsed and alternative extra links
      const baseConfigs = extractConfigsList(sub.jsonConfigs || "");
      
      const renamedConfigsList: { name: string; url: string; server: string; protocol: string }[] = [];
      baseConfigs.forEach((item, index) => {
        const hasOverrideName = sub.nameOverrides && sub.nameOverrides[String(index)] !== undefined && sub.nameOverrides[String(index)].trim() !== "";
        const hasRemarksTemplate = sub.remarksTemplate && sub.remarksTemplate.trim() !== "";

        let name = "";
        if (hasOverrideName) {
          name = sub.nameOverrides![String(index)].trim();
        } else if (hasRemarksTemplate) {
          const template = sub.remarksTemplate.trim();
          const oneBasedIndex = index + 1;
          name = template.includes("*")
            ? template.replaceAll("*", String(oneBasedIndex))
            : `${template} ${oneBasedIndex}`;
        }

        let pLink = "";
        if (typeof item === "string") {
          pLink = item;
        } else if (item && typeof item === "object") {
          pLink = convertJsonConfigToShareLink(item);
        }
        if (pLink) {
          const updatedLink = name ? updateConfigRemark(pLink, name) : pLink;
          const parsed = parseV2rayLink(updatedLink, index);
          if (parsed) {
            renamedConfigsList.push({
              name: name || parsed.name,
              url: updatedLink,
              server: parsed.server,
              protocol: parsed.protocol.toUpperCase(),
            });
          }
        }
      });

      const alternativeConfigsList: { name: string; url: string; server: string; protocol: string }[] = [];
      const rawAlternatives = fetchedAdditionalConfigs.length > 0
        ? fetchedAdditionalConfigs
        : (sub.additionalLink && !sub.additionalLink.trim().startsWith("http")
            ? sub.additionalLink.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
            : []);

      rawAlternatives.forEach((item, index) => {
        const parsed = parseV2rayLink(item, index + 20000);
        if (parsed) {
          alternativeConfigsList.push({
            name: parsed.name,
            url: item,
            server: parsed.server,
            protocol: parsed.protocol.toUpperCase(),
          });
        }
      });

      const totalNodes = renamedConfigsList.length + alternativeConfigsList.length;

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
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen relative flex flex-col items-center justify-start p-4 py-8 antialiased selection:bg-lime-500/30 selection:text-lime-300">
  
  <!-- Glow orbs -->
  <div class="absolute inset-x-0 top-0 h-[400px] bg-[radial-gradient(circle_at_top,rgba(163,230,53,0.06),transparent_60%)] pointer-events-none"></div>

  <div class="max-w-xl w-full space-y-6 relative z-10 my-auto">
    
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
            onclick="navigator.clipboard.writeText('${activeUrl}').then(() => { showToast(); });"
            class="flex items-center justify-center bg-lime-400 hover:bg-lime-300 active:bg-lime-500 text-slate-950 p-2.5 rounded-xl transition cursor-pointer shadow-md shadow-lime-500/5"
            title="Copy URL Address"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
          </button>
        </div>
      </div>

      <!-- Renamed Configuration Nodes List -->
      <div class="space-y-3 pt-3">
        <div class="flex items-center gap-1 text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
          <span class="inline-block w-1.5 h-3 bg-lime-400 rounded-sm"></span> 
          <span>Renamed Nodes Feed (${renamedConfigsList.length})</span>
        </div>

        ${renamedConfigsList.length === 0 ? `
          <p class="text-xs text-slate-600 font-medium italic py-1">No custom renamed nodes found in this feed yet.</p>
        ` : `
          <div class="space-y-2 max-h-[220px] overflow-y-auto pr-1">
            ${renamedConfigsList.map((node) => `
              <div class="flex items-center justify-between border border-slate-850 bg-slate-950 px-3.5 py-2.5 rounded-xl text-xs hover:border-slate-800 transition">
                <div class="space-y-0.5 truncate pr-2">
                  <div class="font-bold text-white truncate max-w-[170px]">${node.name}</div>
                  <div class="text-[9px] font-mono text-slate-500 truncate max-w-[170px]">${node.server}</div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <span class="text-[9px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">${node.protocol}</span>
                  <button 
                    onclick="navigator.clipboard.writeText('${node.url}').then(() => { showToast(); });"
                    class="p-1 text-slate-500 hover:text-white transition"
                    title="Copy connection link"
                  >
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2"></path></svg>
                  </button>
                </div>
              </div>
            `).join("")}
          </div>
        `}
      </div>

      <!-- Injected Additional Alternative Links -->
      ${alternativeConfigsList.length > 0 ? `
        <div class="space-y-3 pt-3 border-t border-slate-850/60">
          <div class="flex items-center gap-1 text-xs font-bold text-slate-400 uppercase tracking-wider font-mono text-amber-500">
            <span class="inline-block w-1.5 h-3 bg-amber-500 rounded-sm"></span> 
            <span>Alternative Admin Configs (${alternativeConfigsList.length})</span>
          </div>

          <div class="space-y-2 max-h-[160px] overflow-y-auto pr-1">
            ${alternativeConfigsList.map((node) => `
              <div class="flex items-center justify-between border border-amber-950/30 bg-amber-500/5 px-3.5 py-2.5 rounded-xl text-xs hover:border-amber-900/50 transition">
                <div class="space-y-0.5 truncate pr-2">
                  <div class="font-bold text-slate-300 truncate max-w-[170px]">${node.name}</div>
                  <div class="text-[9px] font-mono text-slate-600 truncate max-w-[170px]">${node.server}</div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <span class="text-[9px] font-mono text-amber-500/80 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">${node.protocol}</span>
                  <button 
                    onclick="navigator.clipboard.writeText('${node.url}').then(() => { showToast(); });"
                    class="p-1 text-slate-500 hover:text-amber-500 transition"
                    title="Copy alternative connection link"
                  >
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2"></path></svg>
                  </button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

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
    <span class="text-xs font-bold">Successfully copied link to clipboard!</span>
  </div>

  <script>
    function showToast() {
      const toast = document.getElementById("toast-notify");
      if (toast) {
        toast.classList.remove("opacity-0", "translate-y-3", "pointer-events-none");
        toast.classList.add("opacity-100", "translate-y-0");
        setTimeout(() => {
          toast.classList.remove("opacity-100", "translate-y-0");
          toast.classList.add("opacity-0", "translate-y-3", "pointer-events-none");
        }, 2200);
      }
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
