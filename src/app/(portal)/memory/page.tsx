"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Archive, BookOpen } from "lucide-react";
import { usePortal } from "@/lib/store";
import { MEMORY_LANES, MEMORY_LINK_KINDS, EVIDENCE_REQUIRED_LANES } from "@/lib/taxonomy";

interface Link {
  id?: string;
  kind: string;
  ref: string;
  note?: string | null;
}
interface Item {
  id: string;
  lane: string;
  title: string;
  body: string;
  status: string;
  confidence: number | null;
  tags: string[];
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  links: Link[];
  derived?: boolean;
}

interface Brief {
  generatedAt: string;
  counts: Record<string, number>;
  beliefs: Item[];
  procedures: Item[];
  concepts: Item[];
  semantic: Item[];
  distillates: Item[];
  recentActivity: Item[];
  outcomes: Item[];
}

const LANE_LABEL: Record<string, string> = {
  episodic: "Episodic",
  semantic: "Semantic",
  concept: "Concept",
  procedural: "Procedural",
  belief: "Belief",
  eval: "Eval",
  distillate: "Distillate",
};
const LANE_COLOR: Record<string, string> = {
  episodic: "#605d5d",
  semantic: "#2f54d1",
  concept: "#7c1405",
  procedural: "#ae1800",
  belief: "#ff563c",
  eval: "#2d7a2d",
  distillate: "#8a5a00",
};

const BLANK = { lane: "belief", title: "", body: "", tags: "", status: "active", linkKind: "doc", linkRef: "" };

export default function MemoryPage() {
  const notify = usePortal((s) => s.notify);
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [lane, setLane] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);

  const openBrief = async () => {
    setBriefOpen(true);
    if (!brief) {
      const res = await fetch("/api/memory/brief");
      if (res.ok) setBrief((await res.json()).brief);
    }
  };

  const load = async (opts: { q?: string; lane?: string | null } = {}) => {
    const p = new URLSearchParams();
    if (opts.q?.trim()) p.set("q", opts.q.trim());
    if (opts.lane) p.set("lane", opts.lane);
    const res = await fetch(`/api/memory?${p}`);
    if (res.ok) {
      const d = await res.json();
      setItems(d.items);
      setCounts(d.counts);
    }
  };
  // Initial load — setState lives in the promise continuation (not synchronous
  // in the effect body), matching the rest of the app's mount-fetch pattern.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/memory")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && !cancelled) {
          setItems(d.items);
          setCounts(d.counts);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);

  const runSearch = () => load({ q, lane });
  const pickLane = (l: string | null) => {
    setLane(l);
    load({ q, lane: l });
  };

  const create = async () => {
    setSaving(true);
    const links = form.linkRef.trim() ? [{ kind: form.linkKind, ref: form.linkRef.trim() }] : [];
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lane: form.lane,
        title: form.title,
        body: form.body,
        status: form.status,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        links,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setCreating(false);
      setForm({ ...BLANK });
      notify("Memory saved");
      load({ q, lane });
    } else {
      notify((await res.json().catch(() => ({}))).error ?? "Could not save");
    }
  };

  const archive = async (id: string) => {
    const res = await fetch(`/api/memory/${id}`, { method: "DELETE" });
    if (res.ok) {
      notify("Archived");
      load({ q, lane });
    }
  };

  const evidenceRequired = (EVIDENCE_REQUIRED_LANES as readonly string[]).includes(form.lane);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <p className="kick">Organizational memory · {total} active across {Object.keys(counts).length} lanes</p>
        <button className="btn btn-secondary" onClick={openBrief} style={{ fontSize: 12 }}>
          <BookOpen size={14} /> Onboarding brief
        </button>
      </div>

      {/* Lane overview + filter */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button className={`btn ${lane === null ? "btn-primary" : "btn-secondary"}`} onClick={() => pickLane(null)} style={{ fontSize: 12 }}>
          All
        </button>
        {MEMORY_LANES.map((l) => (
          <button
            key={l}
            className={`btn ${lane === l ? "btn-primary" : "btn-secondary"}`}
            onClick={() => pickLane(l)}
            style={{ fontSize: 12 }}
          >
            <span className="dot" style={{ width: 8, height: 8, background: LANE_COLOR[l], marginRight: 6 }} />
            {LANE_LABEL[l]} {counts[l] ? `· ${counts[l]}` : ""}
          </button>
        ))}
      </div>

      {/* Search + new */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: 11, opacity: 0.5 }} />
          <input
            className="input"
            value={q}
            placeholder="Recall anything the org knows…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            style={{ paddingLeft: 32, width: "100%" }}
          />
        </div>
        <button className="btn btn-secondary" onClick={runSearch}>Search</button>
        <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
          <Plus size={15} /> New
        </button>
      </div>

      {/* New memory form */}
      {creating && (
        <div className="stack stack-strong" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <select className="input" value={form.lane} onChange={(e) => setForm({ ...form, lane: e.target.value })} style={{ maxWidth: 160 }}>
              {MEMORY_LANES.map((l) => (
                <option key={l} value={l}>{LANE_LABEL[l]}</option>
              ))}
            </select>
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={{ maxWidth: 120 }}>
              <option value="active">active</option>
              <option value="draft">draft</option>
            </select>
          </div>
          <input className="input" value={form.title} placeholder="Title" onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ marginBottom: 8 }} />
          <textarea className="input" value={form.body} placeholder="What do we know? (never store secrets)" onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} style={{ marginBottom: 8, resize: "vertical" }} />
          <input className="input" value={form.tags} placeholder="tags, comma, separated" onChange={(e) => setForm({ ...form, tags: e.target.value })} style={{ marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <select className="input" value={form.linkKind} onChange={(e) => setForm({ ...form, linkKind: e.target.value })} style={{ maxWidth: 110 }}>
              {MEMORY_LINK_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <input className="input" value={form.linkRef} placeholder={evidenceRequired ? "evidence (required for this lane)" : "evidence source (optional)"} onChange={(e) => setForm({ ...form, linkRef: e.target.value })} style={{ flex: 1 }} />
          </div>
          {evidenceRequired && (
            <div style={{ fontSize: 11, color: "var(--color-neutral-600)", marginBottom: 8 }}>
              A {LANE_LABEL[form.lane].toLowerCase()} must cite evidence to be active — the honesty rule.
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={create} disabled={saving || !form.title.trim() || !form.body.trim()}>
              {saving ? "Saving…" : "Save memory"}
            </button>
            <button className="btn btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Items */}
      {items === null ? (
        <div style={{ fontSize: 13, color: "var(--color-neutral-600)" }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: "22px 4px", fontSize: 13, color: "var(--color-neutral-600)" }}>
          {q ? `Nothing recalled for “${q}”.` : "No memory in this lane yet — add what the org knows."}
        </div>
      ) : (
        <div className="stack stack-strong">
          {items.map((it) => (
            <div key={it.id} style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span className="tag" style={{ background: LANE_COLOR[it.lane], color: "#fff", fontSize: 10 }}>{LANE_LABEL[it.lane]}</span>
                {it.derived && <span className="tag tag-outline" style={{ fontSize: 10 }} title="Derived live from the audit log / metrics">live</span>}
                {it.status !== "active" && <span className="tag tag-outline" style={{ fontSize: 10 }}>{it.status}</span>}
                <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{it.title}</span>
                {it.derived ? (
                  <span style={{ fontSize: 11, color: "var(--color-neutral-500)" }}>{new Date(it.updatedAt).toLocaleDateString()}</span>
                ) : (
                  <button className="btn btn-ghost" onClick={() => archive(it.id)} title="Archive" aria-label={`Archive ${it.title}`} style={{ padding: "2px 8px" }}>
                    <Archive size={14} />
                  </button>
                )}
              </div>
              <div style={{ fontSize: 13, color: "var(--color-neutral-800)", whiteSpace: "pre-wrap" }}>{it.body}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                {it.tags.map((t) => (
                  <span key={t} className="tag tag-outline" style={{ fontSize: 10 }}>{t}</span>
                ))}
                {it.links.map((l, i) => (
                  <span key={i} className="tag" style={{ fontSize: 10, background: "var(--color-neutral-200)" }} title={l.note ?? ""}>
                    ↳ {l.kind}: {l.ref.length > 46 ? l.ref.slice(0, 46) + "…" : l.ref}
                  </span>
                ))}
                {it.links.length === 0 && (EVIDENCE_REQUIRED_LANES as readonly string[]).includes(it.lane) && (
                  <span className="tag" style={{ fontSize: 10, background: "var(--color-accent-2-100)", color: "var(--color-accent-2-700)" }}>uncited</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Onboarding brief ── */}
      {briefOpen && (
        <div className="dialog-backdrop" onClick={() => setBriefOpen(false)}>
          <div
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: 720, width: "92%", maxHeight: "86vh", display: "flex", flexDirection: "column" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "2px solid var(--color-text)" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 17 }}>Onboarding brief</div>
              <button className="btn btn-ghost" onClick={() => setBriefOpen(false)}>Close</button>
            </div>
            <div style={{ overflowY: "auto", padding: 20 }}>
              {!brief ? (
                <div style={{ fontSize: 13, color: "var(--color-neutral-600)" }}>Composing from cited memory + live activity…</div>
              ) : (
                <>
                  <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-neutral-700)" }}>
                    Everything the org knows — drawn from cited memory and live activity. This is what onboards a new steward.
                  </p>
                  <BriefSection title="Beliefs — how we operate" items={brief.beliefs} />
                  <BriefSection title="Procedures — how we do it" items={brief.procedures} />
                  <BriefSection title="Concepts" items={brief.concepts} />
                  <BriefSection title="Facts" items={brief.semantic} />
                  <BriefSection title="Learnings (distilled)" items={brief.distillates} />
                  <BriefSection title="Outcomes" items={brief.outcomes} />
                  <BriefSection title="Recent activity" items={brief.recentActivity} compact />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BriefSection({ title, items, compact }: { title: string; items: Item[]; compact?: boolean }) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <p className="kick" style={{ marginBottom: 8 }}>{title}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 10 }}>
        {items.map((it) => (
          <div key={it.id}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{it.title}</div>
            {!compact && <div style={{ fontSize: 12.5, color: "var(--color-neutral-800)", whiteSpace: "pre-wrap" }}>{it.body}</div>}
            {!compact && it.links.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--color-neutral-600)", marginTop: 2 }}>
                cites: {it.links.map((l) => `${l.kind}:${l.ref}`).join(", ")}
              </div>
            )}
            {compact && <span style={{ fontSize: 11, color: "var(--color-neutral-500)", marginLeft: 8 }}>{it.body}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
