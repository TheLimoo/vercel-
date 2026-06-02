import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const isAuthorized = await checkAuth(req);
    const isUsingDefaultPassword = !process.env.ADMIN_PASSWORD;

    return NextResponse.json({
      authenticated: isAuthorized,
      isUsingDefaultPassword,
    });
  } catch (err: any) {
    return NextResponse.json({ authenticated: false, error: err.message }, { status: 500 });
  }
}
