"use client";

import { useState } from "react";
import { usePortal } from "@/lib/store";
import { PLATFORM_COLORS } from "@/lib/platforms";

/* Honest analytics: every figure on this page is computed from the portal's
 * own publishing records. Platform-side metrics (reach, engagement, clicks,
 * followers) require the analytics API pulls, which are NOT built yet — this
 * page says so instead of showing invented numbers. */

export default function AnalyticsPage() {
  const { posts } = usePortal();

  // Snapshot of "now" per mount — render math must stay pure.
  const [now] = useState(() => Date.now());
  const last30 = posts.filter(
    (p) => p.scheduledAt && new Date(p.scheduledAt).getTime() > now - 30 * 24 * 60 * 60_000,
  );
  const published30 = last30.filter((p) => p.status === "published");
  const failed30 = last30.filter((p) => p.status === "failed");
  const scheduledAhead = posts.filter(
    (p) => p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt).getTime() > now,
  );
  const successRate =
    published30.length + failed30.length > 0
      ? Math.round((published30.length / (published30.length + failed30.length)) * 100)
      : null;

  const byPlatform = new Map<string, { mark: string; count: number }>();
  for (const p of published30) {
    const cur = byPlatform.get(p.account.name) ?? { mark: p.account.mark, count: 0 };
    cur.count += 1;
    byPlatform.set(p.account.name, cur);
  }
  const platformRows = [...byPlatform.entries()].sort((a, b) => b[1].count - a[1].count);
  const maxCount = platformRows[0]?.[1].count ?? 1;

  const metrics = [
    { label: "Published · 30 days", value: String(published30.length), note: "from your publishing records" },
    { label: "Scheduled ahead", value: String(scheduledAhead.length), note: "queued right now" },
    { label: "Failed · 30 days", value: String(failed30.length), note: failed30.length ? "see calendar (status lens)" : "none — clean run" },
    { label: "Publish success", value: successRate === null ? "—" : `${successRate}%`, note: successRate === null ? "no attempts yet" : "of attempted publishes" },
  ];

  return (
    <div>
      <div
        className="stack stack-strong"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}
      >
        {metrics.map((m) => (
          <div key={m.label} style={{ padding: "18px 20px" }}>
            <div className="kick" style={{ margin: "0 0 6px" }}>
              {m.label}
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 30 }}>{m.value}</div>
            <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>{m.note}</div>
          </div>
        ))}
      </div>

      <p className="kick" style={{ color: "var(--color-accent)" }}>
        Published by platform · last 30 days
      </p>
      <div className="stack" style={{ marginBottom: 24 }}>
        {platformRows.length === 0 && (
          <div style={{ padding: "16px 18px", fontSize: 13, color: "var(--color-neutral-600)" }}>
            Nothing published in the last 30 days yet.
          </div>
        )}
        {platformRows.map(([name, { mark, count }]) => (
          <div key={name} style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 14 }}>
            <div className="mark">{mark}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{name}</div>
              <div style={{ height: 10, border: "1px solid var(--color-divider)", background: "var(--color-bg)" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round((count / maxCount) * 100)}%`,
                    background: PLATFORM_COLORS[mark as keyof typeof PLATFORM_COLORS] ?? "var(--color-neutral-600)",
                  }}
                />
              </div>
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 18, width: 32, textAlign: "right" }}>
              {count}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          border: "2px solid var(--color-divider)",
          background: "var(--color-bg)",
          padding: "14px 16px",
          fontSize: 13,
          color: "var(--color-neutral-700)",
          maxWidth: "70ch",
        }}
      >
        <strong style={{ color: "var(--color-accent-700)" }}>Reach, engagement, and follower metrics</strong> come
        from each platform&apos;s analytics API and are not connected yet. When those pulls land, this page adds
        real per-post performance and plain-English recommendations — until then it only shows numbers the portal
        can actually stand behind.
      </div>
    </div>
  );
}
