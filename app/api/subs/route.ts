import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { getKV, setKV } from "@/lib/db";
import { Subscription } from "@/lib/v2ray";

const SUBS_DB_KEY = "v2ray_subscriptions_list";

export async function GET(req: NextRequest) {
  const isAuthorized = await checkAuth(req);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const list = await getKV<Subscription[]>(SUBS_DB_KEY) || [];
    return NextResponse.json({ success: true, subscriptions: list });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const isAuthorized = await checkAuth(req);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const subData: Partial<Subscription> = await req.json();
    if (!subData.name || !subData.path) {
      return NextResponse.json({ error: "Name and custom path are required fields" }, { status: 400 });
    }

    // Clean space or illegal path characters
    subData.path = subData.path.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (!subData.path) {
      return NextResponse.json({ error: "Invalid path segment specified" }, { status: 400 });
    }

    const currentList = await getKV<Subscription[]>(SUBS_DB_KEY) || [];

    // Check if path is already used by another sub
    const pathConflict = currentList.find(sub => sub.path === subData.path && sub.id !== subData.id);
    if (pathConflict) {
      return NextResponse.json({ error: `The custom path '${subData.path}' is already occupied by subscription '${pathConflict.name}'` }, { status: 400 });
    }

    let updatedList: Subscription[];

    if (subData.id) {
      // Modify
      updatedList = currentList.map(existing => {
        if (existing.id === subData.id) {
          return {
            ...existing,
            name: subData.name!,
            path: subData.path!,
            remarksTemplate: subData.remarksTemplate || "Server *",
            jsonConfigs: subData.jsonConfigs || "",
            dummyConfigs: subData.dummyConfigs || [],
            updatedAt: new Date().toISOString(),
          };
        }
        return existing;
      });
    } else {
      // Create new
      const newSub: Subscription = {
        id: `sub_${crypto.randomUUID().substring(0, 8)}`,
        name: subData.name,
        path: subData.path,
        remarksTemplate: subData.remarksTemplate || "Server *",
        jsonConfigs: subData.jsonConfigs || "",
        dummyConfigs: subData.dummyConfigs || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      updatedList = [...currentList, newSub];
    }

    await setKV(SUBS_DB_KEY, updatedList);
    return NextResponse.json({ success: true, subscriptions: updatedList });
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
    const subId = searchParams.get("id");
    if (!subId) {
      return NextResponse.json({ error: "Subscription id is required" }, { status: 400 });
    }

    const currentList = await getKV<Subscription[]>(SUBS_DB_KEY) || [];
    const filteredList = currentList.filter(sub => sub.id !== subId);

    await setKV(SUBS_DB_KEY, filteredList);
    return NextResponse.json({ success: true, subscriptions: filteredList });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
