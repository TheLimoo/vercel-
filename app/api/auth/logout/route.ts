import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    await clearSession();
    
    const response = NextResponse.json({ success: true, message: "Logged out successfully" });
    response.cookies.delete("admin_session");
    return response;
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
