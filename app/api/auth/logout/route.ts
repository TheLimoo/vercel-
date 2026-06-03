import { NextRequest, NextResponse } from "next/server";
import { clearSession, clearSessionByToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const sessionToken = req.cookies.get("admin_session")?.value;
    if (sessionToken) {
      await clearSessionByToken(sessionToken);
    }
    await clearSession();
    
    const response = NextResponse.json({ success: true, message: "Logged out successfully" });
    response.cookies.delete("admin_session");
    return response;
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
