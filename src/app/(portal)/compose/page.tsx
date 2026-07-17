"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Check, ChevronDown, Heart, MessageCircle, Plus, Share, Sparkles, X as XIcon } from "lucide-react";
import { usePortal, selectableAccounts } from "@/lib/store";
import { uploadAsset, type UploadedAsset } from "@/lib/upload";
import {
  BRAND_HASHTAGS,
  COMPOSER_PLATFORMS,
  MARK_TO_PLATFORM,
  PLATFORM_COLORS,
  PLATFORM_RULES,
} from "@/lib/platforms";

const TIMEZONES = ["ET (Eastern)", "CT (Central)", "MT (Mountain)", "PT (Pacific)", "UTC", "GMT (London)"];

export default function ComposePage() {
  const router = useRouter();
  const s = usePortal();
  const fileRef = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<UploadedAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [acctMenu, setAcctMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState<string | null>(null); // inline ＋New name, null = closed

  const attachFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const asset = await uploadAsset(file, s.category);
      setAttached(asset);
      s.setComposer({ postType: asset.type });
      s.notify(`Attached ${asset.filename}`);
    } catch (err) {
      s.notify(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const selAccts = selectableAccounts(s);
  const selPlatforms: string[] = [];
  selAccts.forEach((id) => {
    const a = s.accounts.find((x) => x.id === id)!;
    const p = MARK_TO_PLATFORM[a.mark];
    if (p && !selPlatforms.includes(p)) selPlatforms.push(p);
  });
  const active = selPlatforms.includes(s.activeTab) ? s.activeTab : (selPlatforms[0] ?? "instagram");
  const rules = PLATFORM_RULES[active] ?? PLATFORM_RULES.instagram;
  const activeAccount =
    s.accounts.find((a) => selAccts.includes(a.id) && MARK_TO_PLATFORM[a.mark] === active) ??
    s.accounts.find((a) => a.id === active);

  const preview = s.caption.trim();
  const over = preview.length > rules.limit;
  const charStyle: React.CSSProperties = over
    ? { color: "var(--color-accent-2-700)", fontWeight: 600 }
    : { color: "var(--color-neutral-600)" };

  const categoryNames = s.categories.map((c) => c.name);
  const activeCat = s.categories.find((c) => c.name === s.category);
  const hashtags = [...(activeCat?.hashtags ?? []), ...BRAND_HASHTAGS]
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 8);

  const addCategory = async () => {
    const name = newCat?.trim();
    if (!name) {
      setNewCat(null);
      return;
    }
    const ok = await s.createCategory(name);
    if (ok) s.setComposer({ category: name });
    setNewCat(null);
  };

  const accountGroups = COMPOSER_PLATFORMS.map((pid) => ({
    rules: PLATFORM_RULES[pid],
    items: s.accounts.filter((a) => MARK_TO_PLATFORM[a.mark] === pid && a.status !== "disconnected"),
  })).filter((g) => g.items.length > 0);

  const submit = async (mode: "schedule" | "draft") => {
    if (!s.caption.trim()) {
      s.notify("Write a caption first");
      return;
    }
    if (!selAccts.length) {
      s.notify("Select at least one account");
      return;
    }
    if (mode === "draft") setSaving(true);
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseCaption: s.caption,
        category: s.category,
        accountIds: selAccts,
        assetIds: attached ? [attached.id] : [],
        date: s.date,
        time: s.time,
        tz: s.tz,
        draft: mode === "draft",
      }),
    });
    if (mode === "draft") setSaving(false);
    if (res.ok) {
      const d = await res.json();
      s.setComposer({ caption: "" });
      setAttached(null);
      await s.refreshPosts();
      if (mode === "draft") {
        s.notify(`Saved ${d.targetCount} draft${d.targetCount > 1 ? "s" : ""} — nothing published`);
      } else {
        s.notify(`Scheduled ${d.targetCount} post${d.targetCount > 1 ? "s" : ""} · ${s.time} ${s.tz.split(" ")[0]}`);
        router.push("/calendar");
      }
    } else {
      s.notify((await res.json()).error ?? (mode === "draft" ? "Save failed" : "Scheduling failed"));
    }
  };

  return (
    <div className="composeGrid">
      <div>
        {/* ── Media ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <p className="kick" style={{ margin: 0 }}>
            Media
          </p>
          <div className="seg">
            <button className={s.postType === "image" ? "on" : ""} onClick={() => s.setComposer({ postType: "image" })}>
              Image
            </button>
            <button className={s.postType === "video" ? "on" : ""} onClick={() => s.setComposer({ postType: "video" })}>
              Video
            </button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={s.postType === "video" ? "video/mp4,video/quicktime" : "image/jpeg,image/png,image/webp,image/gif"}
          hidden
          onChange={(e) => {
            attachFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {attached ? (
          <div
            style={{
              border: "2px solid var(--color-text)",
              background: "var(--color-bg)",
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: 10,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                width: 120,
                height: 120,
                background: "var(--color-neutral-200)",
                flex: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                color: "var(--color-neutral-500)",
                overflow: "hidden",
              }}
            >
              {attached.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={attached.thumbUrl}
                  alt={attached.filename}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                "VIDEO"
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {attached.filename}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>
                {attached.type === "image"
                  ? "Variants generated: 1:1 · 4:5 · 16:9 · thumbnail. Instagram publishes the 4:5 crop."
                  : attached.status === "processing"
                    ? "Transcoding renditions (9:16 · 1:1 · 16:9 · X-fit) + cover frame…"
                    : "Renditions ready: 9:16 · 1:1 · 16:9 · X-fit + cover frame"}
              </div>
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => setAttached(null)}
              title="Remove attachment"
              aria-label="Remove attachment"
              style={{ flex: "none", padding: "6px 8px" }}
            >
              <XIcon size={15} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              attachFile(e.dataTransfer.files?.[0]);
            }}
            disabled={uploading}
            style={{
              width: "100%",
              border: "2px dashed var(--color-neutral-400)",
              background: "var(--color-neutral-100)",
              height: 150,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginBottom: 16,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 15 }}>
              {uploading ? "Uploading…" : s.postType === "video" ? "Drop or pick a video" : "Drop or pick an image"}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>
              {s.postType === "video"
                ? "MP4/MOV · stored privately, served via signed URLs"
                : "Auto-generates 1:1 · 4:5 · 16:9 variants per platform"}
            </div>
          </button>
        )}

        {s.postType === "video" && (
          <div
            style={{
              border: "2px solid var(--color-divider)",
              background: "var(--color-bg)",
              padding: "14px 16px",
              marginBottom: 20,
            }}
          >
            <div className="kick" style={{ margin: "0 0 8px" }}>
              How your video publishes
            </div>
            <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 13, color: "var(--color-neutral-800)" }}>
              <li>
                <strong>Renditions</strong> — one upload transcodes to 9:16 (blurred-pad), 1:1, 16:9, and a
                720×1280 X-fit export, plus a scene-picked cover frame.
              </li>
              <li>
                <strong>Instagram</strong> — publishes as a Reel (9:16) via Meta&apos;s container flow with the
                cover frame attached.
              </li>
              <li>
                <strong>Platform limits</strong> — checked at scheduling against each network&apos;s current
                documented spec (duration, aspect, size).
              </li>
            </ul>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span className="tag tag-outline">✓ 9:16 · 1:1 · 16:9 · X-fit</span>
              <span className="tag tag-outline">✓ Auto cover frame</span>
              <span className="tag tag-neutral">Auto-captions: coming with speech-to-text</span>
            </div>
          </div>
        )}

        {/* ── Publish to — account-picker dropdown (handoff #2) ── */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <p className="kick" style={{ margin: 0 }}>
            Publish to
          </p>
          <span style={{ fontSize: 12, color: "var(--color-accent-700)", fontWeight: 600 }}>
            {selAccts.length} selected
          </span>
        </div>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <button
            className="btn btn-secondary"
            onClick={() => setAcctMenu((v) => !v)}
            disabled={accountGroups.length === 0}
            style={{ width: "100%", justifyContent: "space-between" }}
          >
            <span>{accountGroups.length === 0 ? "No connectable accounts — connect on Accounts" : "Add accounts"}</span>
            <ChevronDown size={15} />
          </button>
          {acctMenu && accountGroups.length > 0 && (
            <>
              {/* click-away catcher */}
              <div style={{ position: "fixed", inset: 0, zIndex: 20 }} onClick={() => setAcctMenu(false)} />
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0,
                  right: 0,
                  zIndex: 21,
                  maxHeight: 320,
                  overflowY: "auto",
                  border: "2px solid var(--color-divider)",
                  background: "var(--color-bg)",
                  boxShadow: "var(--shadow-lg)",
                }}
              >
                {accountGroups.map((g) => (
                  <div key={g.rules.id}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 14px",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--color-neutral-700)",
                        fontWeight: 600,
                        borderBottom: "1px solid var(--color-divider)",
                      }}
                    >
                      <span style={{ width: 8, height: 8, background: PLATFORM_COLORS[g.rules.mark] }} />
                      {g.rules.name}
                    </div>
                    {g.items.map((a) => {
                      const on = selAccts.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          onClick={() => {
                            s.toggleAccount(a.id);
                            setAcctMenu(false);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            width: "100%",
                            padding: "10px 14px",
                            border: 0,
                            borderBottom: "1px solid var(--color-divider)",
                            background: on ? "var(--color-accent-100)" : "transparent",
                            cursor: "pointer",
                            font: "inherit",
                            textAlign: "left",
                          }}
                        >
                          <span
                            style={{
                              width: 16,
                              height: 16,
                              flex: "none",
                              border: `1px solid ${on ? "var(--color-accent)" : "var(--color-neutral-400)"}`,
                              background: on ? "var(--color-accent)" : "transparent",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#fff",
                            }}
                          >
                            {on && <Check size={12} />}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{a.handle}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        {/* selected accounts as removable chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20, minHeight: 4 }}>
          {selAccts.map((id) => {
            const a = s.accounts.find((x) => x.id === id);
            if (!a) return null;
            return (
              <span
                key={id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 6px 5px 10px",
                  borderRadius: 980,
                  border: "1px solid var(--color-accent-300)",
                  background: "var(--color-accent-100)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--color-accent-700)",
                }}
              >
                {a.handle}
                <button
                  onClick={() => s.toggleAccount(id)}
                  aria-label={`Remove ${a.handle}`}
                  style={{ border: 0, background: "none", padding: 0, display: "flex", cursor: "pointer", color: "var(--color-accent-700)" }}
                >
                  <XIcon size={13} />
                </button>
              </span>
            );
          })}
        </div>

        {/* ── Base caption ── */}
        <p className="kick">Base caption</p>
        <textarea
          className="input"
          value={s.caption}
          onChange={(e) => s.setComposer({ caption: e.target.value })}
          placeholder="Write once — then tailor per platform below…"
          style={{ minHeight: 120, resize: "vertical", marginBottom: 6 }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              s.setComposer({
                caption:
                  "Behind every drop is a long studio day ☕ — here's a peek at how this week's capsule came together. Which piece is your favourite?",
              });
              s.notify("Example caption inserted");
            }}
            style={{ border: "2px solid var(--color-accent-300)" }}
          >
            <Sparkles size={14} /> Insert example caption
          </button>
          <span style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>
            AI captions land with the AI studio (bring-your-own-key)
          </span>
        </div>

        {/* ── Hashtag suggestions ── */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <p className="kick" style={{ margin: 0 }}>
            Suggested hashtags
          </p>
          <span style={{ fontSize: 11, color: "var(--color-neutral-600)" }}>for {s.category} · tap to add</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {hashtags.map((t) => {
            const added = s.caption.includes(t);
            return (
              <button
                key={t}
                onClick={() => s.addHashtag(t)}
                style={{
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "5px 12px",
                  border: `1px solid ${added ? "transparent" : "var(--color-accent-300)"}`,
                  background: added ? "var(--color-accent)" : "var(--color-accent-100)",
                  color: added ? "#fff" : "var(--color-accent-700)",
                }}
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* ── Per-platform tabs + rules ── */}
        <p className="kick">Per-platform tabs</p>
        <div style={{ border: "2px solid var(--color-divider)" }}>
          <div style={{ display: "flex", borderBottom: "2px solid var(--color-divider)", flexWrap: "wrap" }}>
            {selPlatforms.map((pid) => {
              const r = PLATFORM_RULES[pid];
              const on = pid === active;
              return (
                <button
                  key={pid}
                  onClick={() => s.setComposer({ activeTab: pid })}
                  style={{
                    padding: "10px 16px",
                    border: 0,
                    borderRight: "2px solid var(--color-divider)",
                    cursor: "pointer",
                    fontFamily: "var(--font-heading)",
                    fontWeight: 800,
                    fontSize: 13,
                    background: on ? "var(--color-accent)" : "var(--color-bg)",
                    color: on ? "#fff" : "var(--color-text)",
                  }}
                >
                  {r.mark}
                </button>
              );
            })}
          </div>
          <div style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 13, color: "var(--color-neutral-700)", marginBottom: 10 }}>
              <strong>{rules.name}</strong>&apos;s publishing rules — your base caption is validated against them
              live. (Per-platform caption overrides ship with a later phase.)
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "7px 18px",
                fontSize: 12.5,
                marginBottom: 12,
              }}
            >
              {[
                ["Caption limit", `${rules.limit.toLocaleString()} chars`],
                ["Hashtags", rules.tags],
                ["Image", rules.img],
                ["Video", rules.vid],
              ].map(([label, val]) => (
                <div key={label}>
                  <span
                    style={{
                      color: "var(--color-neutral-600)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      fontSize: 10,
                      display: "block",
                    }}
                  >
                    {label}
                  </span>
                  {val}
                </div>
              ))}
              <div style={{ gridColumn: "1/-1" }}>
                <span
                  style={{
                    color: "var(--color-neutral-600)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    fontSize: 10,
                    display: "block",
                  }}
                >
                  Best aspect ratio
                </span>
                {rules.best}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                borderTop: "2px solid var(--color-divider)",
                paddingTop: 8,
              }}
            >
              <span style={charStyle}>
                {over ? `${preview.length - rules.limit} over the ${rules.name} limit` : `Within ${rules.name} limits`}
              </span>
              <span style={charStyle}>
                {preview.length} / {rules.limit.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* ── Schedule controls ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="date">Date</label>
              <input
                id="date"
                className="input"
                type="date"
                value={s.date}
                onChange={(e) => s.setComposer({ date: e.target.value })}
              />
            </div>
            <div className="field" style={{ width: 110 }}>
              <label htmlFor="time">Time</label>
              <input
                id="time"
                className="input"
                type="time"
                value={s.time}
                onChange={(e) => s.setComposer({ time: e.target.value })}
              />
            </div>
            <div className="field" style={{ width: 160 }}>
              <label htmlFor="tz">Time zone</label>
              <select id="tz" className="input" value={s.tz} onChange={(e) => s.setComposer({ tz: e.target.value })}>
                {TIMEZONES.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "end" }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="category">Category</label>
              {newCat === null ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <select
                    id="category"
                    className="input"
                    value={categoryNames.includes(s.category) ? s.category : ""}
                    onChange={(e) => s.setComposer({ category: e.target.value })}
                    style={{ flex: 1 }}
                  >
                    {!categoryNames.includes(s.category) && <option value="">{s.category || "Select…"}</option>}
                    {s.categories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setNewCat("")}
                    title="Add a category"
                    aria-label="Add a category"
                    style={{ flex: "none", padding: "0 10px" }}
                  >
                    <Plus size={15} /> New
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="input"
                    autoFocus
                    value={newCat}
                    placeholder="New category name"
                    onChange={(e) => setNewCat(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addCategory();
                      if (e.key === "Escape") setNewCat(null);
                    }}
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-primary" onClick={addCategory} style={{ flex: "none", padding: "0 12px" }}>
                    Add
                  </button>
                  <button className="btn btn-ghost" onClick={() => setNewCat(null)} style={{ flex: "none", padding: "0 10px" }}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => submit("draft")}
              disabled={saving}
              style={{ height: 42, whiteSpace: "nowrap" }}
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button className="btn btn-primary" onClick={() => submit("schedule")} style={{ height: 42, whiteSpace: "nowrap" }}>
              Schedule post
            </button>
          </div>
        </div>
      </div>

      {/* ── Live preview ── */}
      <div style={{ position: "sticky", top: 100 }}>
        <p className="kick">Live preview · {rules.name}</p>
        <div style={{ border: "2px solid var(--color-text)", background: "var(--color-bg)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              borderBottom: "2px solid var(--color-divider)",
            }}
          >
            <div className="mark">{rules.mark}</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{activeAccount?.handle ?? "@qantmmedia"}</div>
              <div style={{ fontSize: 11, color: "var(--color-neutral-600)" }}>Sponsored · now</div>
            </div>
          </div>
          <div
            style={{
              height: 200,
              background: "var(--color-neutral-200)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-neutral-500)",
              fontSize: 12,
              overflow: "hidden",
            }}
          >
            {attached?.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={attached.thumbUrl}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              "image / video"
            )}
          </div>
          <div style={{ padding: "12px 14px", fontSize: 13, lineHeight: 1.5, minHeight: 60 }}>
            {preview || "Your caption preview appears here as you type…"}
          </div>
          <div
            style={{
              display: "flex",
              gap: 18,
              padding: "10px 14px",
              borderTop: "2px solid var(--color-divider)",
              fontSize: 12,
              color: "var(--color-neutral-600)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Heart size={13} /> Like
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <MessageCircle size={13} /> Comment
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Share size={13} /> Share
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
