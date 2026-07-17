"use client";

import { useEffect, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { usePortal } from "@/lib/store";
import type { CategoryDef } from "@/lib/types";

interface CredentialView {
  provider: string;
  label: string;
  keyHint: string;
  where: string;
  set: boolean;
  hint: string | null;
  updatedAt: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
}

/* Settings (handoff #2 §7). Autopilot delivery mode, category management, and
 * encrypted API-key storage are real and persisted. Notification wiring lands
 * later — shown honestly as what's coming, not as a working control. */

type Mode = "review" | "auto";

export default function SettingsPage() {
  const notify = usePortal((s) => s.notify);
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings").then(async (res) => {
      if (cancelled || !res.ok) return;
      const d = await res.json();
      setMode(d.autopilotMode === "auto" ? "auto" : "review");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveMode = async (next: Mode) => {
    setMode(next);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autopilotMode: next }),
    });
    notify(res.ok ? `Autopilot set to ${next === "auto" ? "auto-schedule" : "review"}` : "Could not save");
  };

  return (
    <div style={{ maxWidth: "72ch", display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ── Autopilot ── */}
      <section>
        <p className="kick" style={{ color: "var(--color-accent)" }}>
          Autopilot
        </p>
        <div className="stack stack-strong" style={{ padding: "18px 20px" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
            When Autopilot drafts a post…
          </div>
          <div style={{ fontSize: 13, color: "var(--color-neutral-700)", marginBottom: 14 }}>
            Choose how AI-planned posts are delivered.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {([
              { v: "review", title: "Hold for review", body: "Drafts wait in the Dashboard review inbox — you approve each before it schedules." },
              { v: "auto", title: "Auto-schedule", body: "Drafts go straight onto the calendar. No per-post approval." },
            ] as const).map((opt) => {
              const active = mode === opt.v;
              return (
                <button
                  key={opt.v}
                  onClick={() => saveMode(opt.v)}
                  disabled={mode === null}
                  style={{
                    flex: 1,
                    minWidth: 200,
                    textAlign: "left",
                    padding: "12px 14px",
                    cursor: "pointer",
                    borderRadius: 12,
                    border: active ? "2px solid var(--color-accent)" : "1px solid var(--color-divider)",
                    background: active ? "var(--color-accent-100)" : "var(--color-bg)",
                    font: "inherit",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{opt.title}</div>
                  <div style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>{opt.body}</div>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--color-neutral-600)" }}>
            Trend &amp; news sources (which feeds Autopilot draws from, add-your-own RSS) arrive with the
            optimizer/growth engine.
          </div>
        </div>
      </section>

      {/* ── Categories ── */}
      <CategoriesCard />

      {/* ── Integrations / keys ── */}
      <IntegrationsCard />

      {/* ── Notifications (Phase B) ── */}
      <PlaceholderCard
        title="Notifications"
        lead="Choose when the portal alerts you — publish failures, expiring tokens, weekly summaries."
        note="Delivery wiring ships with the observability phase."
      />
    </div>
  );
}

/* Category management: create / rename / recolor / delete. Wired to the real
 * /api/categories endpoints via the store — a rename relabels existing posts,
 * a delete leaves history intact (posts keep the name, fall back to neutral),
 * and the last category can't be removed. */
function CategoriesCard() {
  const { categories, createCategory, updateCategory, deleteCategory } = usePortal();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#ff563c");

  const add = async () => {
    if (!name.trim()) return;
    const ok = await createCategory(name.trim(), color);
    if (ok) {
      setName("");
      setColor("#ff563c");
      setAdding(false);
    }
  };

  return (
    <section>
      <p className="kick">Categories</p>
      <div className="stack stack-strong" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 13, color: "var(--color-neutral-700)", marginBottom: 14 }}>
          Content categories used by the composer and the calendar&apos;s color lens. Renaming one relabels the
          posts that use it; deleting one leaves that history intact.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {categories.map((c) => (
            <CategoryRow
              key={c.id}
              cat={c}
              canDelete={categories.length > 1}
              onRecolor={(hex) => updateCategory(c.id, { color: hex })}
              onRename={(next) => updateCategory(c.id, { name: next })}
              onDelete={() => deleteCategory(c.id)}
            />
          ))}
        </div>

        {adding ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label="New category color"
              style={{ width: 34, height: 34, flex: "none", border: "1px solid var(--color-divider)", background: "none", cursor: "pointer" }}
            />
            <input
              className="input"
              autoFocus
              value={name}
              placeholder="Category name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
                if (e.key === "Escape") setAdding(false);
              }}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={add} style={{ flex: "none" }}>
              Add
            </button>
            <button className="btn btn-ghost" onClick={() => setAdding(false)} style={{ flex: "none" }}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn-secondary" onClick={() => setAdding(true)} style={{ marginTop: 12, alignSelf: "flex-start" }}>
            <Plus size={15} /> Add category
          </button>
        )}
      </div>
    </section>
  );
}

function CategoryRow({
  cat,
  canDelete,
  onRecolor,
  onRename,
  onDelete,
}: {
  cat: CategoryDef;
  canDelete: boolean;
  onRecolor: (hex: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(cat.name);
  const [syncedName, setSyncedName] = useState(cat.name);

  // Keep the field in sync if the category name changes underneath (e.g. a
  // refresh after a rename) — adjusted during render, not in an effect.
  if (cat.name !== syncedName) {
    setSyncedName(cat.name);
    setName(cat.name);
  }

  const commit = () => {
    const next = name.trim();
    if (next && next !== cat.name) onRename(next);
    else setName(cat.name);
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input
        type="color"
        value={cat.color}
        onChange={(e) => onRecolor(e.target.value)}
        aria-label={`${cat.name} color`}
        title="Recolor"
        style={{ width: 34, height: 34, flex: "none", border: "1px solid var(--color-divider)", background: "none", cursor: "pointer" }}
      />
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setName(cat.name);
        }}
        style={{ flex: 1 }}
      />
      <button
        className="btn btn-ghost"
        onClick={onDelete}
        disabled={!canDelete}
        title={canDelete ? "Delete category" : "Keep at least one category"}
        aria-label={`Delete ${cat.name}`}
        style={{ flex: "none", padding: "0 10px", opacity: canDelete ? 1 : 0.4 }}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

/* Integrations & keys: operator API keys, stored write-only in the AES-256-GCM
 * vault. The browser never receives a key or ciphertext — only whether one is
 * set and its last-4 hint. A "Test" button validates the key with a real
 * provider call. Honest status: keys are saved but not yet consumed (the AI
 * studio that will use them ships later). */
function IntegrationsCard() {
  const notify = usePortal((s) => s.notify);
  const [creds, setCreds] = useState<CredentialView[] | null>(null);

  const refresh = async () => {
    const res = await fetch("/api/credentials");
    if (res.ok) setCreds((await res.json()).credentials);
  };
  useEffect(() => {
    let cancelled = false;
    fetch("/api/credentials").then(async (res) => {
      if (cancelled || !res.ok) return;
      setCreds((await res.json()).credentials);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <p className="kick">Integrations &amp; keys</p>
      <div className="stack stack-strong" style={{ padding: "18px 20px" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
          AI model credentials
        </div>
        <div style={{ fontSize: 13, color: "var(--color-neutral-700)", marginBottom: 6 }}>
          Bring your own key. Every secret is stored <strong>encrypted in the vault</strong> (AES-256-GCM, the same
          as your OAuth tokens), shown masked, and never sent back to the browser once saved.
        </div>
        <div style={{ fontSize: 12, color: "var(--color-neutral-600)", marginBottom: 14 }}>
          Keys are saved now and used by AI captions when the AI studio ships — nothing calls them automatically
          before then. Use <strong>Test</strong> to confirm a key works.
        </div>

        {creds === null ? (
          <div style={{ fontSize: 13, color: "var(--color-neutral-600)" }}>Loading…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {creds.map((c) => (
              <CredentialRow key={c.provider} cred={c} notify={notify} onChange={refresh} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CredentialRow({
  cred,
  notify,
  onChange,
}: {
  cred: CredentialView;
  notify: (m: string) => void;
  onChange: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(!cred.set);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<null | "save" | "test" | "delete">(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; status: string } | null>(null);

  const save = async () => {
    if (!value.trim()) return;
    setBusy("save");
    const res = await fetch(`/api/credentials/${cred.provider}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: value }),
    });
    setBusy(null);
    if (res.ok) {
      setValue("");
      setEditing(false);
      setTestResult(null);
      await onChange();
      notify(`${cred.label} key saved`);
    } else {
      notify((await res.json().catch(() => ({}))).error ?? "Could not save key");
    }
  };

  const test = async () => {
    setBusy("test");
    const res = await fetch(`/api/credentials/${cred.provider}/test`, { method: "POST" });
    setBusy(null);
    const r = await res.json().catch(() => ({ ok: false, status: "Test failed" }));
    setTestResult(r);
    await onChange();
  };

  const remove = async () => {
    setBusy("delete");
    const res = await fetch(`/api/credentials/${cred.provider}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) {
      setTestResult(null);
      setEditing(true);
      await onChange();
      notify(`${cred.label} key removed`);
    } else {
      notify("Could not remove key");
    }
  };

  const lastTest =
    testResult ??
    (cred.lastTestOk == null ? null : { ok: cred.lastTestOk, status: cred.lastTestOk ? "Key is valid" : "Key was rejected" });

  return (
    <div style={{ border: "1px solid var(--color-divider)", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{cred.label}</div>
        <div style={{ fontSize: 11, color: "var(--color-neutral-600)" }}>{cred.where}</div>
      </div>

      {cred.set && !editing ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 13,
              padding: "5px 10px",
              border: "1px solid var(--color-divider)",
              borderRadius: 8,
              background: "var(--color-neutral-100)",
              letterSpacing: "0.08em",
            }}
          >
            ···· {cred.hint}
          </span>
          <span style={{ fontSize: 11, color: "var(--color-neutral-600)" }}>
            updated {cred.updatedAt ? new Date(cred.updatedAt).toLocaleDateString() : "—"}
          </span>
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            <button className="btn btn-secondary" onClick={test} disabled={busy !== null} style={{ fontSize: 12, padding: "5px 12px" }}>
              {busy === "test" ? "Testing…" : "Test"}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(true)} disabled={busy !== null} style={{ fontSize: 12, padding: "5px 12px" }}>
              Replace
            </button>
            <button
              className="btn btn-ghost"
              onClick={remove}
              disabled={busy !== null}
              aria-label={`Remove ${cred.label} key`}
              title="Remove key"
              style={{ fontSize: 12, padding: "5px 10px" }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={value}
            placeholder={cred.keyHint}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape" && cred.set) {
                setEditing(false);
                setValue("");
              }
            }}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={save} disabled={busy !== null || !value.trim()} style={{ flex: "none" }}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          {cred.set && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setEditing(false);
                setValue("");
              }}
              disabled={busy !== null}
              style={{ flex: "none" }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {lastTest && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 10,
            fontSize: 12,
            fontWeight: 600,
            color: lastTest.ok ? "var(--color-accent-700)" : "var(--color-accent-2-700)",
          }}
        >
          {lastTest.ok ? <Check size={14} /> : <X size={14} />}
          {lastTest.status}
          {cred.lastTestedAt && !testResult && (
            <span style={{ fontWeight: 400, color: "var(--color-neutral-600)" }}>
              · {new Date(cred.lastTestedAt).toLocaleString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PlaceholderCard({ title, lead, note }: { title: string; lead: string; note: string }) {
  return (
    <section>
      <p className="kick">{title}</p>
      <div className="stack stack-strong" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 13, color: "var(--color-neutral-700)" }}>{lead}</div>
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--color-neutral-600)" }}>{note}</div>
      </div>
    </section>
  );
}
