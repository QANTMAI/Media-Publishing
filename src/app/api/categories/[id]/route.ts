import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** PATCH /api/categories/:id — rename, recolor, or reset hashtags. A rename
 * also updates every existing post that references the old name, so history
 * stays consistent with the calendar legend. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    color?: string;
    hashtags?: string[];
  };

  const current = await db.category.findFirst({ where: { id, userId } });
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: { name?: string; color?: string; hashtags?: string | null } = {};
  let rename: { from: string; to: string } | null = null;

  if (body.name !== undefined) {
    const name = body.name.trim().slice(0, 60);
    if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    if (name.toLowerCase() !== current.name.toLowerCase()) {
      const clash = await db.category.findFirst({
        where: { userId, name, NOT: { id } },
      });
      if (clash) return NextResponse.json({ error: `"${name}" already exists` }, { status: 409 });
    }
    if (name !== current.name) rename = { from: current.name, to: name };
    data.name = name;
  }
  if (body.color !== undefined) {
    if (!HEX.test(body.color)) return NextResponse.json({ error: "Color must be a #rrggbb hex value" }, { status: 400 });
    data.color = body.color;
  }
  if (body.hashtags !== undefined) {
    const joined = body.hashtags.map((t) => t.trim()).filter(Boolean).slice(0, 12).join(",");
    data.hashtags = joined || null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Rename + post relabel in one transaction: a partial failure must not leave
  // the category renamed while posts still point at the old name.
  await db.$transaction([
    db.category.update({ where: { id }, data }),
    ...(rename ? [db.post.updateMany({ where: { userId, category: rename.from }, data: { category: rename.to } })] : []),
  ]);

  await audit("category.update", { userId, ip: requestIp(req), metadata: { id, ...(rename ? { rename } : {}) } });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/categories/:id — remove a category. Posts that used it keep
 * their category name (it just falls back to the neutral color); nothing is
 * cascade-deleted. Refuses to remove the last category so the composer always
 * has at least one choice. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const target = await db.category.findFirst({ where: { id, userId } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const count = await db.category.count({ where: { userId } });
  if (count <= 1) {
    return NextResponse.json({ error: "Keep at least one category" }, { status: 409 });
  }

  await db.category.delete({ where: { id } });
  await audit("category.delete", { userId, ip: requestIp(req), metadata: { name: target.name } });
  return NextResponse.json({ ok: true });
}
