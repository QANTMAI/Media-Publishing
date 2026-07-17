"use client";

import { useEffect, useState } from "react";
import { usePortal } from "@/lib/store";
import { PLATFORM_COLORS } from "@/lib/platforms";

interface MetricPost {
  targetId: string;
  caption: string;
  account: { name: string; mark: string; handle: string };
  permalink: string | null;
  fetchedAt: string;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

/* Honest analytics section (handoff #2 folds Analytics into the Dashboard).
 * Every figure is computed from the portal's own publishing records; platform
 * metrics (reach/engagement/etc.) only appear once real insight pulls run —
 * otherwise the section says so rather than inventing numbers. */
export function AnalyticsSection() {
  const { posts } = usePortal();
  const [now] = useState(() => Date.now());

  const [metricPosts, setMetricPosts] = useState<MetricPost[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/metrics").then(async (res) => {
      if (cancelled || !res.ok) return;
      const d = await res.json();
      setMetricPosts(d.posts ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 20 }}
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
      <div className="stack" style={{ marginBottom: 20 }}>
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

      <p className="kick" style={{ color: "var(--color-accent)" }}>
        What your numbers are telling you · from platform insights
      </p>
      {metricPosts.length > 0 ? (
        <div className="stack">
          {metricPosts.slice(0, 10).map((m) => (
            <div key={m.targetId} style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 14 }}>
              <div className="mark">{m.account.mark}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {m.caption}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-neutral-600)" }}>
                  {m.account.handle} · pulled{" "}
                  {new Date(m.fetchedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--color-neutral-700)", flex: "none" }}>
                {([
                  ["views", m.views],
                  ["reach", m.reach],
                  ["likes", m.likes],
                  ["comments", m.comments],
                  ["shares", m.shares],
                  ["saves", m.saves],
                ] as const)
                  .filter(([, v]) => v != null)
                  .map(([label, v]) => (
                    <span key={label}>
                      <strong style={{ fontFamily: "var(--font-heading)", fontWeight: 800 }}>{v}</strong> {label}
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
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
          <strong style={{ color: "var(--color-accent-700)" }}>No platform metrics yet.</strong> Reach,
          engagement, and follower numbers come from each platform&apos;s analytics API once real accounts are
          connected. Mock publishes never get metrics — this only shows numbers a platform actually reported.
        </div>
      )}
    </div>
  );
}
