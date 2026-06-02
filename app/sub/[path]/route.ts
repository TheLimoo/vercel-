import { NextRequest, NextResponse } from "next/server";
import { getKV } from "@/lib/db";
import { Subscription, generateProcessedSubscription } from "@/lib/v2ray";

const SUBS_DB_KEY = "v2ray_subscriptions_list";

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
    const format = searchParams.get("format") === "json" ? "json" : "links";
    const isRaw = searchParams.get("raw") === "true" || searchParams.get("flag") === "raw";

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
          "Subscription-Userinfo": "upload=0; download=0; total=1073741824000; expire=0", // Dummy metrics hint for Rocket / Shadow
        },
      });
    }

    // Default: Encode in standard client Base64 for links standard feed
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
