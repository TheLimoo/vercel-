import { NextRequest, NextResponse } from "next/server";
import { createAdminSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = body.username ? String(body.username).trim() : "";
    const password = body.password ? String(body.password) : "";

    if (!password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    // Attempt to log in with username (defaults to 'admin' inside createAdminSession if empty)
    const loginResult = await createAdminSession(username || "admin", password);
    if (!loginResult) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Set HTTP-Only Cookie
    const response = NextResponse.json({ 
      success: true, 
      message: "Logged in successfully",
      user: {
        username: loginResult.user.username,
        name: loginResult.user.name,
        level: loginResult.user.level,
      }
    });

    response.cookies.set("admin_session", loginResult.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
