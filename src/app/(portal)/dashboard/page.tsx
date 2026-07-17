"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { usePortal, categoryColorResolver } from "@/lib/store";
import { postColor } from "@/lib/platforms";
import { AnalyticsSection } from "@/components/AnalyticsSection";

/* Handoff #2 dashboard: KPI row → Autopilot strip → Review inbox + Upcoming →
 * Analytics section. Every number is real (from the portal's own records) or
 * an explicit "not connected yet" — platform metrics only appear once real
 * insight pulls run. */

interface MetricTotals {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const { posts, accounts, categories, lens, openDialog, autopilot, toggleAutopilot, approveDraft, discardDraft } =
    usePortal();
  const colorFor = categoryColorResolver(categories);
  const [now] = useState(() => Date.now());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [totals, setTotals] = useState<MetricTotals | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/metrics").then(async (res) => {
      if (cancelled || !res.ok) return;
      setTotals((await res.json()).totals ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const goalTotal = 7;
  const goalDone = posts.filter(
    (p) => inWeek(p.scheduledAt) && (p.status === "published" || p.status === "scheduled" || p.status === "publishing"),
  ).length;
  const goalPct = Math.min(100, Math.round((goalDone / goalTotal) * 100));

  const failed = posts.filter((p) => p.status === "failed");
  const upcoming = [...posts]
    .filter((p) => p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt).getTime() > now)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))
    .slice(0, 5);

  // Autopilot review drafts land here (Phase B wires the real queue). For now
  // the empty state explains the drafts → review → approve flow honestly.
  const reviewDrafts = posts.filter((p) => p.autopilot && p.status === "draft");

  const metric = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString());

  return (
    <div>
      {/* ── KPI row ── */}
      <div
        className="stack stack-strong"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 20 }}
      >
        <div style={{ padding: "18px 20px" }}>
          <p className="kick" style={{ margin: "0 0 6px" }}>
            This week&apos;s goal
          </p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 30 }}>{goalDone}</span>
            <span style={{ fontSize: 14, color: "var(--color-neutral-600)" }}>/ {goalTotal} posts</span>
          </div>
          <div style={{ height: 10, border: "2px solid var(--color-text)", marginTop: 10, background: "var(--color-bg)" }}>
            <div style={{ height: "100%", background: "var(--color-accent-2)", width: `${goalPct}%` }} />
          </div>
        </div>
        {[
          { label: "Reach · 7d", value: metric(totals?.reach) },
          { label: "Engagement", value: metric(totals?.likes != null ? (totals.likes + (totals.comments ?? 0) + (totals.shares ?? 0)) : null) },
          { label: "New followers", value: "—" },
        ].map((m) => (
          <div key={m.label} style={{ padding: "18px 20px" }}>
            <p className="kick" style={{ margin: "0 0 6px" }}>
              {m.label}
            </p>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 30 }}>{m.value}</div>
            <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>
              {m.value === "—" ? "connect analytics" : "from platform insights"}
            </div>
          </div>
        ))}
      </div>

      {/* ── Autopilot status strip ── */}
      <div
        className="stack stack-strong"
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 14, padding: "14px 18px", marginBottom: 20 }}
      >
        <span
          className="dot"
          style={{ width: 12, height: 12, background: autopilot ? "var(--color-accent-2)" : "var(--color-neutral-400)" }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 15 }}>
            Autopilot is {autopilot ? "on" : "off"}
          </div>
          <div style={{ fontSize: 13, color: "var(--color-neutral-700)" }}>
            {autopilot
              ? "AI is planning posts. Drafts wait in your review inbox below. Mode & sources live in Settings."
              : "Turn it on to have AI draft a week of posts for your review. Configure it in Settings."}
          </div>
        </div>
        <button
          className="btn"
          onClick={() => toggleAutopilot()}
          style={
            autopilot
              ? { background: "var(--color-accent-2)", border: "2px solid var(--color-accent-2)", color: "#201e1d" }
              : { background: "transparent", border: "2px solid var(--color-text)", color: "var(--color-text)" }
          }
        >
          <Sparkles size={14} /> Autopilot: {autopilot ? "On" : "Off"}
        </button>
      </div>

      {/* ── Failed posts — surfaced so a broken publish is never silent ── */}
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
                  <span style={{ fontWeight: 600, fontSize: 13, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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

      {/* ── Review inbox + Upcoming ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 24, marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <p className="kick" style={{ color: "var(--color-accent)" }}>
              Needs your review{reviewDrafts.length > 0 ? ` · ${reviewDrafts.length}` : ""}
            </p>
            {reviewDrafts.length > 1 && (
              <button
                className="btn btn-ghost"
                disabled={bulkBusy}
                onClick={async () => {
                  setBulkBusy(true);
                  // Sequential, not parallel — each approval schedules real
                  // jobs; a burst of concurrent writes isn't worth the risk.
                  for (const p of reviewDrafts) await approveDraft(p.postId);
                  setBulkBusy(false);
                }}
                style={{ fontSize: 12, padding: "4px 10px" }}
              >
                {bulkBusy ? "Approving…" : "Approve all"}
              </button>
            )}
          </div>
          {reviewDrafts.length === 0 ? (
            <div
              style={{
                border: "2px solid var(--color-divider)",
                background: "var(--color-bg)",
                padding: "20px",
                fontSize: 13,
                color: "var(--color-neutral-700)",
              }}
            >
              Nothing to review. When Autopilot is on (review mode), the posts it drafts land here — you approve,
              edit, or discard each before anything is scheduled. Set the mode and trend sources in{" "}
              <button
                onClick={() => router.push("/settings")}
                style={{ border: 0, background: "none", padding: 0, color: "var(--color-accent-700)", cursor: "pointer", font: "inherit", textDecoration: "underline" }}
              >
                Settings
              </button>
              .
            </div>
          ) : (
            <div className="stack">
              {reviewDrafts.map((p) => (
                <div key={p.id} style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="dot" style={{ width: 10, height: 10, background: postColor(p, lens, colorFor) }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.caption}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-neutral-600)" }}>
                      {p.account.name} · {p.category}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flex: "none" }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => approveDraft(p.postId)}
                      disabled={bulkBusy}
                      style={{ fontSize: 12, padding: "5px 10px" }}
                    >
                      Approve
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => openDialog(p.id)}
                      disabled={bulkBusy}
                      style={{ fontSize: 12, padding: "5px 10px" }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => discardDraft(p.postId)}
                      disabled={bulkBusy}
                      aria-label="Discard draft"
                      style={{ fontSize: 12, padding: "5px 10px" }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                <span className="dot" style={{ width: 10, height: 10, background: postColor(p, lens, colorFor) }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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

      {/* ── Analytics (moved in from its old tab) ── */}
      <p className="kick" style={{ fontSize: 13, marginBottom: 12 }}>
        Analytics
      </p>
      <AnalyticsSection />
    </div>
  );
}
