import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { getSubAccessMetrics, deleteSubAccessMetrics } from "@/lib/db";

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
      return NextResponse.json({ error: "Query parameter 'path' is required to delete metrics" }, { status: 400 });
    }

    await deleteSubAccessMetrics(path);
    return NextResponse.json({ success: true, message: `Access metrics for sub path /sub/${path} deleted.` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
