"use client";

import { useRouter } from "next/navigation";
import { usePortal } from "@/lib/store";

const METRICS = [
  { label: "Reach", value: "18.4k", note: "▲ 12% vs last week" },
  { label: "Engagement rate", value: "6.1%", note: "▲ 3%" },
  { label: "Link clicks", value: "742", note: "▲ 8%" },
  { label: "New followers", value: "+214", note: "best: Instagram" },
];

export default function AnalyticsPage() {
  const router = useRouter();
  const notify = usePortal((s) => s.notify);

  const insights = [
    {
      text: "Your posts do 40% better on Tuesdays at 6pm — want future posts to default there?",
      cta: "Apply",
      on: () => notify("Default time set to Tue 6pm"),
    },
    {
      text: "Photo posts beat text posts 3-to-1 — lead with an image.",
      cta: "Compose",
      on: () => router.push("/compose"),
    },
    {
      text: "Captions with a question get 2× the comments — the AI can add one.",
      cta: "Try it",
      on: () => router.push("/compose"),
    },
    {
      text: "This post is your top performer this month — recycle it next month?",
      cta: "Requeue",
      on: () => notify("Added to recycle queue"),
    },
  ];

  return (
    <div>
      <div
        className="stack stack-strong"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}
      >
        {METRICS.map((m) => (
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
        What your numbers are telling you
      </p>
      <div className="stack">
        {insights.map((i) => (
          <div
            key={i.text}
            style={{
              padding: "16px 18px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div style={{ fontSize: 14, maxWidth: "70ch" }}>{i.text}</div>
            <button className="btn btn-secondary" onClick={i.on} style={{ flex: "none" }}>
              {i.cta}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
