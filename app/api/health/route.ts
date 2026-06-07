import { NextRequest, NextResponse } from "next/server";
import { checkAuth, checkAuthWithLevel } from "@/lib/auth";
import { getKV, setKV } from "@/lib/db";
import { pingAllSubscriptions, startHealthPingScheduler, PingSettings } from "@/lib/health";

const SETTINGS_KEY = "v2ray_ping_settings";

export async function GET(req: NextRequest) {
  const isAuthorized = await checkAuth(req);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const settings = await getKV<PingSettings>(SETTINGS_KEY) || {
      mode: "auto",
      intervalMinutes: 15,
      adminAlertFails: [],
    };
    
    // Explicitly auto start scheduler on first request if alive
    await startHealthPingScheduler();

    return NextResponse.json({ success: true, settings });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const isAuthorized = await checkAuthWithLevel(req, 2);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { action, mode, intervalMinutes } = body;

    const currentSettings = await getKV<PingSettings>(SETTINGS_KEY) || {
      mode: "auto",
      intervalMinutes: 15,
      adminAlertFails: [],
    };

    if (action === "pingAll") {
      // Manual trigger on-demand connect check list
      const results = await pingAllSubscriptions();
      return NextResponse.json({ success: true, settings: results });
    }

    // Otherwise, standard update universal options settings
    if (mode) {
      currentSettings.mode = mode;
    }
    if (intervalMinutes !== undefined) {
      currentSettings.intervalMinutes = intervalMinutes;
    }

    await setKV(SETTINGS_KEY, currentSettings);

    // Apply or restart background timers immediately
    await startHealthPingScheduler();

    return NextResponse.json({ success: true, settings: currentSettings });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
