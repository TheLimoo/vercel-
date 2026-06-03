import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { getSubAccessMetrics, deleteSubAccessMetrics, deleteSingleAccessMetric } from "@/lib/db";

export async function GET(req: NextRequest) {
  const isAuthorized = await checkAuth(req);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const path = searchParams.get("path") || undefined;
    const metrics = await getSubAccessMetrics(path);
    return NextResponse.json({ success: true, metrics });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const isAuthorized = await checkAuth(req);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const path = searchParams.get("path");
    if (!path) {
      return NextResponse.json({ error: "Query parameter 'path' is required" }, { status: 400 });
    }

    const ip = searchParams.get("ip");
    const ua = searchParams.get("ua");
    const hwid = searchParams.get("hwid");

    if (ip !== null && ua !== null && hwid !== null) {
      await deleteSingleAccessMetric(path, ip, ua, hwid);
      return NextResponse.json({ success: true, message: `Access metric for user IP ${ip} deleted.` });
    }

    await deleteSubAccessMetrics(path);
    return NextResponse.json({ success: true, message: `Access metrics for sub path /sub/${path} deleted.` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
