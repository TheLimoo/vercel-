import { NextRequest, NextResponse } from "next/server";
import { getLoggedInUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await getLoggedInUser(req);
    const isUsingDefaultPassword = !process.env.ADMIN_PASSWORD;

    if (user) {
      return NextResponse.json({
        authenticated: true,
        user: {
          username: user.username,
          name: user.name,
          level: user.level,
          description: user.description,
        },
        isUsingDefaultPassword,
      });
    }

    return NextResponse.json({
      authenticated: false,
      isUsingDefaultPassword,
    });
  } catch (err: any) {
    return NextResponse.json({ authenticated: false, error: err.message }, { status: 500 });
  }
}
