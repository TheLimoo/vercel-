import { NextRequest, NextResponse } from "next/server";
import { checkAuth, checkAuthWithLevel } from "@/lib/auth";
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
  const isAuthorized = await checkAuthWithLevel(req, 2);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized. Editor (Level 2) access is required." }, { status: 403 });
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

    if (subData.alternativePath) {
      subData.alternativePath = subData.alternativePath.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
    }

    const currentList = await getKV<Subscription[]>(SUBS_DB_KEY) || [];

    // Check if path or alternativePath is already used by another sub
    const pathConflict = currentList.find(sub => 
      (sub.path === subData.path || (sub.alternativePath && sub.alternativePath === subData.path)) && 
      sub.id !== subData.id
    );
    if (pathConflict) {
      return NextResponse.json({ error: `The custom path '${subData.path}' is already occupied by subscription '${pathConflict.name}'` }, { status: 400 });
    }

    if (subData.alternativePath) {
      const altConflict = currentList.find(sub => 
        (sub.path === subData.alternativePath || (sub.alternativePath && sub.alternativePath === subData.alternativePath)) && 
        sub.id !== subData.id
      );
      if (altConflict) {
        return NextResponse.json({ error: `The alternative path '${subData.alternativePath}' is already occupied by subscription '${altConflict.name}'` }, { status: 400 });
      }
    }

    let updatedList: Subscription[];

    if (subData.id) {
      // Modify - Optimize: if absolutely no fields changed, we don't need to write to DB
      const existingSub = currentList.find(sub => sub.id === subData.id);
      if (existingSub) {
        const nameEqual = subData.name === existingSub.name;
        const pathEqual = subData.path === existingSub.path;
        const remarksTemplateEqual = (subData.remarksTemplate === undefined ? "Server *" : subData.remarksTemplate) === (existingSub.remarksTemplate !== undefined ? existingSub.remarksTemplate : "Server *");
        const jsonConfigsEqual = (subData.jsonConfigs || "") === (existingSub.jsonConfigs || "");
        const dummyConfigsEqual = JSON.stringify(subData.dummyConfigs || []) === JSON.stringify(existingSub.dummyConfigs || []);
        const nameOverridesEqual = JSON.stringify(subData.nameOverrides || {}) === JSON.stringify(existingSub.nameOverrides || {});
        const enabledFormatsEqual = JSON.stringify(subData.enabledFormats !== undefined ? subData.enabledFormats : ["links", "plain", "sing-box", "clash", "json"]) === JSON.stringify(existingSub.enabledFormats !== undefined ? existingSub.enabledFormats : ["links", "plain", "sing-box", "clash", "json"]);
        const customFormatPayloadsEqual = JSON.stringify(subData.customFormatPayloads || {}) === JSON.stringify(existingSub.customFormatPayloads || {});
        const defaultFormatEqual = (subData.defaultFormat || "") === (existingSub.defaultFormat || "");
        const additionalLinkEqual = (subData.additionalLink || "") === (existingSub.additionalLink || "");
        const alternativePathEqual = (subData.alternativePath || "") === (existingSub.alternativePath || "");
        const alternativeJsonConfigsEqual = (subData.alternativeJsonConfigs || "") === (existingSub.alternativeJsonConfigs || "");
        const totalTrafficGbEqual = (subData.totalTrafficGb === undefined ? 1000 : Number(subData.totalTrafficGb)) === (existingSub.totalTrafficGb === undefined ? 1000 : Number(existingSub.totalTrafficGb));

        if (nameEqual && pathEqual && remarksTemplateEqual && jsonConfigsEqual && dummyConfigsEqual && nameOverridesEqual && enabledFormatsEqual && customFormatPayloadsEqual && defaultFormatEqual && additionalLinkEqual && alternativePathEqual && alternativeJsonConfigsEqual && totalTrafficGbEqual) {
          // No changes detected! Avoid database update transaction completely.
          return NextResponse.json({ success: true, subscriptions: currentList, noChanges: true });
        }
      }

      updatedList = currentList.map(existing => {
        if (existing.id === subData.id) {
          return {
            ...existing,
            name: subData.name!,
            path: subData.path!,
            remarksTemplate: subData.remarksTemplate !== undefined ? subData.remarksTemplate : "Server *",
            jsonConfigs: subData.jsonConfigs || "",
            dummyConfigs: subData.dummyConfigs || [],
            nameOverrides: subData.nameOverrides || {},
            enabledFormats: subData.enabledFormats !== undefined ? subData.enabledFormats : ["links", "plain", "sing-box", "clash", "json"],
            customFormatPayloads: subData.customFormatPayloads || {},
            defaultFormat: subData.defaultFormat || "",
            additionalLink: subData.additionalLink || "",
            alternativePath: subData.alternativePath || "",
            alternativeJsonConfigs: subData.alternativeJsonConfigs || "",
            totalTrafficGb: subData.totalTrafficGb !== undefined && subData.totalTrafficGb !== null && !isNaN(Number(subData.totalTrafficGb)) ? Number(subData.totalTrafficGb) : 1000,
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
        remarksTemplate: subData.remarksTemplate !== undefined ? subData.remarksTemplate : "Server *",
        jsonConfigs: subData.jsonConfigs || "",
        dummyConfigs: subData.dummyConfigs || [],
        nameOverrides: subData.nameOverrides || {},
        enabledFormats: subData.enabledFormats !== undefined ? subData.enabledFormats : ["links", "plain", "sing-box", "clash", "json"],
        customFormatPayloads: subData.customFormatPayloads || {},
        defaultFormat: subData.defaultFormat || "",
        additionalLink: subData.additionalLink || "",
        alternativePath: subData.alternativePath || "",
        alternativeJsonConfigs: subData.alternativeJsonConfigs || "",
        totalTrafficGb: subData.totalTrafficGb !== undefined && subData.totalTrafficGb !== null && !isNaN(Number(subData.totalTrafficGb)) ? Number(subData.totalTrafficGb) : 1000,
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
  const isAuthorized = await checkAuthWithLevel(req, 2);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized. Editor (Level 2) access is required." }, { status: 403 });
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
