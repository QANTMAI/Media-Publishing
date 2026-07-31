/* Derive hashtag suggestions from the operator's ACTUAL trending feed titles —
 * deterministic, no AI. Pulls capitalized proper-noun phrases (e.g. "Artificial
 * Intelligence" -> #ArtificialIntelligence), ranks by frequency across the
 * loaded feed items, and returns the top few. Falls back to nothing when the
 * feed is empty (the caller then shows category starters). */

const STOP = new Set([
  "The", "A", "An", "And", "Or", "But", "For", "With", "How", "When", "Why", "What", "Who",
  "Is", "Are", "To", "Of", "In", "On", "At", "By", "As", "It", "Its", "New", "News", "Show",
  "Google", "Hacker", "Reuters", "Bloomberg", "Inc", "Corp", "Ltd", "Us", "Uk", "My", "Your",
]);

export function trendingHashtags(titles: string[], limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const raw of titles) {
    const title = (raw ?? "").trim();
    if (!title) continue;
    // Sequences of 1–3 Capitalized words = a proper-noun phrase.
    const phrases = title.match(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2}\b/g) ?? [];
    for (const phrase of phrases) {
      const words = phrase.split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
      if (!words.length) continue;
      const tag = "#" + words.map((w) => w.replace(/[^a-zA-Z0-9]/g, "")).join("");
      if (tag.length > 3 && tag.length <= 30) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}
