import { db } from "./db";
import { DEFAULT_CATEGORIES } from "@/lib/platforms";

/* Content categories are per-operator editable data. Defaults are seeded the
 * first time a user's categories are read, so an existing operator (created
 * before this feature) transparently gets the standard set without a reseed. */

export interface CategoryRow {
  id: string;
  name: string;
  color: string;
  hashtags: string[];
  sortOrder: number;
}

function shape(c: { id: string; name: string; color: string; hashtags: string | null; sortOrder: number }): CategoryRow {
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    hashtags: c.hashtags ? c.hashtags.split(",").filter(Boolean) : [],
    sortOrder: c.sortOrder,
  };
}

/** Return the operator's categories, seeding the defaults on first use.
 * Idempotent: the seed is a create-if-absent per default name. */
export async function listCategories(userId: string): Promise<CategoryRow[]> {
  const existing = await db.category.count({ where: { userId } });
  if (existing === 0) {
    await db.category.createMany({
      data: DEFAULT_CATEGORIES.map((c, i) => ({
        userId,
        name: c.name,
        color: c.color,
        hashtags: c.hashtags.join(","),
        sortOrder: i,
      })),
    });
  }
  const rows = await db.category.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(shape);
}
