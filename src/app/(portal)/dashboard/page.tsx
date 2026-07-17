"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePortal } from "@/lib/store";
import { postColor } from "@/lib/platforms";

/* Every number on this screen derives from real rows in the portal's own
 * database (posts/targets/accounts). Platform-side metrics (reach,
 * engagement) require the analytics API pulls, which are not built — nothing
 * here pretends otherwise. */

export default function DashboardPage() {
  const router = useRouter();
  const { posts, accounts, lens, openDialog } = usePortal();
  // Snapshot of "now" per mount — render math must stay pure.
  const [now] = useState(() => Date.now());

  // This week = Sunday through Saturday around today.
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const inWeek = (iso: string | null) => {
    if (!iso) return false;
    const t = new Date(iso);
    return t >= weekStart && t < weekEnd;
  };

  const goalTotal = 7; // default weekly target — a preference, not a measurement
  const goalDone = posts.filter(
    (p) => inWeek(p.scheduledAt) && (p.status === "published" || p.status === "scheduled" || p.status === "publishing"),
  ).length;
  const goalPct = Math.min(100, Math.round((goalDone / goalTotal) * 100));

  const publishedLast7 = posts.filter(
    (p) => p.status === "published" && p.scheduledAt && new Date(p.scheduledAt).getTime() > now - 7 * 24 * 60 * 60_000,
  ).length;
  const scheduledAhead = posts.filter(
    (p) => p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt).getTime() > now,
  ).length;
  const connectedAccounts = accounts.filter((a) => a.status === "connected").length;

  const failed = posts.filter((p) => p.status === "failed");
  const upcoming = [...posts]
    .filter((p) => p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt).getTime() > now)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))
    .slice(0, 4);

  return (
    <div>
      {/* Goal + real queue numbers */}
      <div
        className="stack stack-strong"
        style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", marginBottom: 20 }}
      >
        <div style={{ padding: "22px 24px" }}>
          <p className="kick">Weekly target (default {goalTotal})</p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 44, lineHeight: 1 }}>
              {goalDone}
            </span>
            <span style={{ fontSize: 16, color: "var(--color-neutral-600)" }}>/ {goalTotal} posts this week</span>
          </div>
          <div
            style={{
              height: 12,
              border: "2px solid var(--color-text)",
              marginTop: 14,
              background: "var(--color-bg)",
            }}
          >
            <div style={{ height: "100%", background: "var(--color-accent-2)", width: `${goalPct}%` }} />
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-neutral-700)" }}>
            Counts scheduled + published posts in this calendar week; failures don&apos;t count.
          </p>
        </div>
        <div style={{ padding: "22px 24px" }}>
          <p className="kick">Your queue · real counts</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 6 }}>
            {[
              { v: String(publishedLast7), n: "Published · last 7 days" },
              { v: String(scheduledAhead), n: "Scheduled ahead" },
              { v: String(connectedAccounts), n: "Connected accounts" },
            ].map((m) => (
              <div key={m.n}>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 28 }}>{m.v}</div>
                <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>{m.n}</div>
              </div>
            ))}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--color-neutral-600)" }}>
            Reach/engagement metrics arrive with the platform analytics pulls.
          </p>
        </div>
      </div>

      {/* Failed posts — surfaced here so a broken publish is never silent */}
      {failed.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p className="kick" style={{ color: "var(--color-accent-2-700)" }}>
            Needs attention · {failed.length} failed
          </p>
          <div className="stack">
            {failed.slice(0, 4).map((p) => (
              <button key={p.id} className="chip" onClick={() => openDialog(p.id)}>
                <span className="dot" style={{ width: 10, height: 10, background: "#ec3013" }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      display: "block",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.caption}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--color-accent-2-700)" }}>
                    {p.account.name} · {p.error ?? "publish failed"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24 }}>
        <div>
          <p className="kick" style={{ color: "var(--color-accent)" }}>
            Ideas
          </p>
          <div className="stack">
            {[
              {
                title: "Fill an empty day",
                body: "Compose something for a gap in this week's calendar.",
                cta: "Compose",
                on: () => router.push("/compose"),
              },
              {
                title: "Check the queue",
                body: "Review what's scheduled before it goes out.",
                cta: "Calendar",
                on: () => router.push("/calendar"),
              },
              {
                title: "Connect more accounts",
                body: `${connectedAccounts} connected — each one widens your reach.`,
                cta: "Accounts",
                on: () => router.push("/accounts"),
              },
            ].map((s) => (
              <div
                key={s.title}
                style={{
                  padding: "16px 18px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 15, marginBottom: 2 }}>
                    {s.title}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--color-neutral-700)" }}>{s.body}</div>
                </div>
                <button className="btn btn-secondary" onClick={s.on} style={{ flex: "none" }}>
                  {s.cta}
                </button>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--color-neutral-600)", marginTop: 8 }}>
            Performance-based recommendations arrive with the optimizer (needs analytics data).
          </p>
        </div>
        <div>
          <p className="kick">Upcoming</p>
          <div className="stack">
            {upcoming.length === 0 && (
              <div style={{ padding: "16px 18px", fontSize: 13, color: "var(--color-neutral-600)" }}>
                Nothing scheduled — compose a post to fill the queue.
              </div>
            )}
            {upcoming.map((p) => (
              <button key={p.id} className="chip" onClick={() => openDialog(p.id)}>
                <span className="dot" style={{ width: 10, height: 10, background: postColor(p, lens) }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      display: "block",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.caption}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--color-neutral-600)" }}>
                    {p.account.name} ·{" "}
                    {new Date(p.scheduledAt!).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                    {new Date(p.scheduledAt!).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
                    {p.demo ? " · demo" : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
