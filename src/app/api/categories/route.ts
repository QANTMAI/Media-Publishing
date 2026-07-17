import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { listCategories } from "@/lib/server/categories";
import { audit, requestIp } from "@/lib/server/audit";
import { CATEGORY_PALETTE } from "@/lib/platforms";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** GET /api/categories — the operator's content categories (seeds defaults on
 * first use). */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ categories: await listCategories(userId) });
}

/** POST /api/categories — create a category. Name is required and unique per
 * operator; color defaults to the next palette slot; hashtags optional. */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    color?: string;
    hashtags?: string[];
  };
  const name = body.name?.trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (body.color && !HEX.test(body.color)) {
    return NextResponse.json({ error: "Color must be a #rrggbb hex value" }, { status: 400 });
  }

  // Ensure defaults exist (and so the palette offset is stable) before adding.
  const existing = await listCategories(userId);
  if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: `"${name}" already exists` }, { status: 409 });
  }
  const color = body.color ?? CATEGORY_PALETTE[existing.length % CATEGORY_PALETTE.length];
  const hashtags = (body.hashtags ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join(",");

  const created = await db.category.create({
    data: {
      userId,
      name,
      color,
      hashtags: hashtags || null,
      sortOrder: existing.length,
    },
  });
  await audit("category.create", { userId, ip: requestIp(req), metadata: { name } });
  return NextResponse.json(
    { id: created.id, name: created.name, color: created.color, hashtags: hashtags ? hashtags.split(",") : [], sortOrder: created.sortOrder },
    { status: 201 },
  );
}
