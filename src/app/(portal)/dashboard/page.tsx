"use client";

import { useRouter } from "next/navigation";
import { usePortal } from "@/lib/store";
import { postColor } from "@/lib/platforms";

export default function DashboardPage() {
  const router = useRouter();
  const { posts, lens, openDialog, setComposer, notify } = usePortal();

  // This week = Sunday through Saturday around today.
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const goalTotal = 7;
  const goalDone = posts.filter((p) => {
    if (!p.scheduledAt) return false;
    const t = new Date(p.scheduledAt);
    return t >= weekStart && t < weekEnd && p.status !== "draft";
  }).length;
  const goalPct = Math.min(100, Math.round((goalDone / goalTotal) * 100));
  const goalNote =
    goalDone >= goalTotal
      ? "Goal hit — nice work."
      : `On track — ${goalTotal - goalDone} to go this week.`;

  const upcoming = [...posts]
    .filter((p) => p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt) > new Date())
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))
    .slice(0, 4);

  const suggestions = [
    {
      title: "Post Tuesday 6pm",
      body: "Your posts do 40% better in that slot.",
      cta: "Schedule",
      on: () => router.push("/compose"),
    },
    {
      title: "Lead with an image",
      body: "Photo posts beat text 3-to-1 for you.",
      cta: "Compose",
      on: () => router.push("/compose"),
    },
    {
      title: "Recycle top post",
      body: "“Summer capsule drop” was your best this month.",
      cta: "Requeue",
      on: () => {
        setComposer({ caption: "Summer capsule drop — link in bio", category: "Promo" });
        notify("Loaded into composer");
        router.push("/compose");
      },
    },
  ];

  return (
    <div>
      {/* Goal + quick numbers */}
      <div
        className="stack stack-strong"
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr",
          marginBottom: 20,
        }}
      >
        <div style={{ padding: "22px 24px" }}>
          <p className="kick">This week&apos;s goal</p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 44, lineHeight: 1 }}>
              {goalDone}
            </span>
            <span style={{ fontSize: 16, color: "var(--color-neutral-600)" }}>/ {goalTotal} posts</span>
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
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-neutral-700)" }}>{goalNote}</p>
        </div>
        <div style={{ padding: "22px 24px" }}>
          <p className="kick">Quick numbers · last 7 days</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 6 }}>
            {[
              { v: "18.4k", n: "Reach ▲ 12%" },
              { v: "6.1%", n: "Engagement ▲ 3%" },
              { v: "+214", n: "Followers ▲" },
            ].map((m) => (
              <div key={m.n}>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 28 }}>{m.v}</div>
                <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>{m.n}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Optimizer + upcoming */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24 }}>
        <div>
          <p className="kick" style={{ color: "var(--color-accent)" }}>
            Optimizer · do this next
          </p>
          <div className="stack">
            {suggestions.map((s) => (
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
        </div>
        <div>
          <p className="kick">Upcoming</p>
          <div className="stack">
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
