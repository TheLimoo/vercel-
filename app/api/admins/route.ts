import { NextRequest, NextResponse } from "next/server";
import { getLoggedInUser, getAdminsList, saveAdminsList, hashPassword, Admin } from "@/lib/auth";

// Secure endpoints - strictly Level 3 (Super Admin) required for Admin list operations
export async function GET(req: NextRequest) {
  try {
    const actor = await getLoggedInUser(req);
    if (!actor || actor.level < 3) {
      return NextResponse.json({ error: "Unauthorized. Super Admin access required." }, { status: 403 });
    }

    const list = await getAdminsList();
    // Hide password hashes for safety
    const safeList = list.map(admin => ({
      username: admin.username,
      name: admin.name,
      level: admin.level,
      description: admin.description,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
    }));

    return NextResponse.json({ success: true, admins: safeList });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getLoggedInUser(req);
    if (!actor || actor.level < 3) {
      return NextResponse.json({ error: "Unauthorized. Super Admin access required." }, { status: 403 });
    }

    const { username, name, password, level, description } = await req.json();

    if (!username || !name || !password || !level) {
      return NextResponse.json({ error: "Missing required fields: username, name, password, and level are mandatory." }, { status: 400 });
    }

    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!cleanUsername) {
      return NextResponse.json({ error: "Invalid username segment specified" }, { status: 400 });
    }

    const list = await getAdminsList();
    const exists = list.some(a => a.username.toLowerCase() === cleanUsername);
    if (exists) {
      return NextResponse.json({ error: `An administrator with username '${cleanUsername}' already exists.` }, { status: 400 });
    }

    const targetLevel = Number(level);
    if (targetLevel < 1 || targetLevel > 3) {
      return NextResponse.json({ error: "Permission level must be between 1 (Viewer) and 3 (Super Admin)." }, { status: 400 });
    }

    const newAdmin: Admin = {
      username: cleanUsername,
      name: name.trim(),
      passwordHash: hashPassword(password),
      level: targetLevel,
      description: (description || "").trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updatedList = [...list, newAdmin];
    await saveAdminsList(updatedList);

    return NextResponse.json({ 
      success: true, 
      message: `Admin '${cleanUsername}' created successfully.`,
      admins: updatedList.map(a => ({
        username: a.username,
        name: a.name,
        level: a.level,
        description: a.description,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }))
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await getLoggedInUser(req);
    if (!actor || actor.level < 3) {
      return NextResponse.json({ error: "Unauthorized. Super Admin access required." }, { status: 403 });
    }

    const { username, name, password, level, description } = await req.json();

    if (!username) {
      return NextResponse.json({ error: "Username parameter is required for updates." }, { status: 400 });
    }

    const cleanUsername = username.trim().toLowerCase();
    const list = await getAdminsList();
    const adminIndex = list.findIndex(a => a.username.toLowerCase() === cleanUsername);

    if (adminIndex === -1) {
      return NextResponse.json({ error: "Administrator account not found." }, { status: 404 });
    }

    // Protection to avoid demoting oneself or disabling the system-wide master account 'admin'
    if (cleanUsername === actor.username.toLowerCase() && Number(level) !== actor.level) {
      return NextResponse.json({ error: "You cannot change or demote your own permission level." }, { status: 400 });
    }

    if (cleanUsername === "admin" && Number(level) !== 3) {
      return NextResponse.json({ error: "The default master 'admin' account must remain a Super Admin (Level 3)." }, { status: 400 });
    }

    const targetLevel = level !== undefined ? Number(level) : list[adminIndex].level;
    if (targetLevel < 1 || targetLevel > 3) {
      return NextResponse.json({ error: "Permission level must be between 1 (Viewer) and 3 (Super Admin)." }, { status: 400 });
    }

    const updatedAdmin: Admin = {
      ...list[adminIndex],
      name: name !== undefined ? name.trim() : list[adminIndex].name,
      level: targetLevel,
      description: description !== undefined ? description.trim() : list[adminIndex].description,
      updatedAt: new Date().toISOString(),
    };

    if (password) {
      updatedAdmin.passwordHash = hashPassword(password);
    }

    list[adminIndex] = updatedAdmin;
    await saveAdminsList(list);

    return NextResponse.json({ 
      success: true, 
      message: `Admin '${cleanUsername}' details updated successfully.`,
      admins: list.map(a => ({
        username: a.username,
        name: a.name,
        level: a.level,
        description: a.description,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }))
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await getLoggedInUser(req);
    if (!actor || actor.level < 3) {
      return NextResponse.json({ error: "Unauthorized. Super Admin access required." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const targetUsername = searchParams.get("username");

    if (!targetUsername) {
      return NextResponse.json({ error: "Username parameter is required for deletion." }, { status: 400 });
    }

    const cleanUsername = targetUsername.trim().toLowerCase();

    if (cleanUsername === actor.username.toLowerCase()) {
      return NextResponse.json({ error: "You are not permitted to delete your own logged-in admin account." }, { status: 400 });
    }

    if (cleanUsername === "admin") {
      return NextResponse.json({ error: "The default master 'admin' account cannot be deleted as it is a crucial seed anchor." }, { status: 400 });
    }

    const list = await getAdminsList();
    const updatedList = list.filter(a => a.username.toLowerCase() !== cleanUsername);

    if (list.length === updatedList.length) {
      return NextResponse.json({ error: "Administrator account not found." }, { status: 404 });
    }

    await saveAdminsList(updatedList);

    return NextResponse.json({ 
      success: true, 
      message: `Admin '${cleanUsername}' deleted successfully.`,
      admins: updatedList.map(a => ({
        username: a.username,
        name: a.name,
        level: a.level,
        description: a.description,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }))
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
