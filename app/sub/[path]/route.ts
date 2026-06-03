import { NextRequest, NextResponse } from "next/server";
import { getKV, logSubAccess } from "@/lib/db";
import { Subscription, generateProcessedSubscription } from "@/lib/v2ray";

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
  } else if (uaLower.includes("clash")) {
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
  } else if (uaLower.includes("stash")) {
    clientName = "Stash";
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
    const format = searchParams.get("format") === "links" ? "links" : "json";
    const isRaw = searchParams.get("raw") === "true" || searchParams.get("flag") === "raw";

    // Trace diagnostic/metrics asynchronously
    const ip = extractIP(req);
    const ua = req.headers.get("user-agent") || "";
    const hwid = extractHWID(req, searchParams);
    const deviceType = parseUserAgent(ua);

    logSubAccess(sub.path, ip, ua, hwid, deviceType).catch(ex => {
      console.error("Failed asynchronously to log subscription metrics: ", ex);
    });

    const resultText = generateProcessedSubscription(sub, format);

    if (format === "json") {
      return new NextResponse(resultText, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    if (isRaw) {
      return new NextResponse(resultText, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Subscription-Userinfo": "upload=0; download=0; total=1073741824000; expire=0", // Dummy metrics hint
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
