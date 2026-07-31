"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ExternalLink, Heart, MessageCircle, Plus, RefreshCw, Share, Sparkles, TrendingUp, X as XIcon } from "lucide-react";
import { usePortal, selectableAccounts } from "@/lib/store";
import { uploadAsset, type UploadedAsset } from "@/lib/upload";
import { DatePicker } from "@/components/DatePicker";
import { TimePicker } from "@/components/TimePicker";
import { trendingHashtags } from "@/lib/trending-tags";
import {
  BRAND_HASHTAGS,
  COMPOSER_PLATFORMS,
  MARK_TO_PLATFORM,
  PLATFORM_COLORS,
  PLATFORM_RULES,
} from "@/lib/platforms";

const TIMEZONES = ["ET (Eastern)", "CT (Central)", "MT (Mountain)", "PT (Pacific)", "UTC", "GMT (London)"];

function feedTimeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ComposePage() {
  const router = useRouter();
  const s = usePortal();
  const fileRef = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<UploadedAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [acctMenu, setAcctMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [newCat, setNewCat] = useState<string | null>(null); // inline ＋New name, null = closed
  const [feedBusy, setFeedBusy] = useState(false);
  const [aiItemId, setAiItemId] = useState<string | null>(null); // feed item being AI-drafted
  const [imgItemId, setImgItemId] = useState<string | null>(null); // feed item having its image fetched
  const [suggestedImage, setSuggestedImage] = useState<{ dataUrl: string; publisher: string } | null>(null);
  const [polishing, setPolishing] = useState(false); // "Write with AI" in flight

  // Pull the operator's trending items for the assist rail.
  useEffect(() => {
    s.refreshFeedItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // The base caption must fit EVERY selected platform, so validate against the
  // tightest limit among them — not just the active tab (which could be roomy
  // while another selected platform is over).
  const tightest = selPlatforms.reduce<{ name: string; limit: number }>(
    (min, p) => {
      const r = PLATFORM_RULES[p];
      return r && r.limit < min.limit ? { name: r.name, limit: r.limit } : min;
    },
    { name: rules.name, limit: rules.limit },
  );
  const over = preview.length > tightest.limit;
  const charStyle: React.CSSProperties = over
    ? { color: "var(--color-accent-2-700)", fontWeight: 600 }
    : { color: "var(--color-neutral-600)" };

  const categoryNames = s.categories.map((c) => c.name);
  const activeCat = s.categories.find((c) => c.name === s.category);
  // Prefer hashtags derived from the ACTUAL trending feed titles; fall back to
  // the category's starter tags when the feed is empty.
  const trendTags = trendingHashtags(s.feedItems.map((it) => it.title));
  const hashtagsFromTrends = trendTags.length > 0;
  const hashtags = (hashtagsFromTrends ? [...trendTags, ...BRAND_HASHTAGS.slice(0, 2)] : [...(activeCat?.hashtags ?? []), ...BRAND_HASHTAGS])
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

  const submit = async (mode: "schedule" | "draft" | "now") => {
    if (!s.caption.trim()) {
      s.notify("Write a caption first");
      return;
    }
    if (!selAccts.length) {
      s.notify("Select at least one account");
      return;
    }
    if (saving || publishing || scheduling) return; // guard against double-submit
    if (mode === "draft") setSaving(true);
    if (mode === "now") setPublishing(true);
    if (mode === "schedule") setScheduling(true);
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
        publishNow: mode === "now",
      }),
    });
    if (mode === "draft") setSaving(false);
    if (mode === "now") setPublishing(false);
    if (mode === "schedule") setScheduling(false);
    if (res.ok) {
      const d = await res.json();
      s.setComposer({ caption: "" });
      setAttached(null);
      await s.refreshPosts();
      if (mode === "draft") {
        s.notify(`Saved ${d.targetCount} draft${d.targetCount > 1 ? "s" : ""} — nothing published`);
      } else if (mode === "now") {
        s.notify(`Publishing now to ${d.targetCount} account${d.targetCount > 1 ? "s" : ""} — landing shortly`);
        router.push("/dashboard");
      } else {
        s.notify(`Scheduled ${d.targetCount} post${d.targetCount > 1 ? "s" : ""} · ${s.time} ${s.tz.split(" ")[0]}`);
        router.push("/calendar");
      }
    } else {
      s.notify(
        (await res.json()).error ??
          (mode === "draft" ? "Save failed" : mode === "now" ? "Publish failed" : "Scheduling failed"),
      );
    }
  };

  // AI caption from a trending item: source-grounded, brand-voice, sized to the
  // tightest selected platform so the base caption fits everywhere. Seeds the
  // composer as an editable draft — never auto-publishes.
  const aiDraftFromFeed = async (it: { id: string }) => {
    setAiItemId(it.id);
    const maxChars = selPlatforms.length
      ? Math.min(...selPlatforms.map((p) => PLATFORM_RULES[p]?.limit ?? 280))
      : 280;
    let res: Response;
    try {
      res = await fetch("/api/feeds/caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedItemId: it.id, maxChars }),
      });
    } catch {
      setAiItemId(null);
      s.notify("Couldn't reach the server");
      return;
    }
    setAiItemId(null);
    const d = await res.json().catch(() => ({}));
    if (d.ok) {
      const hasTrend = s.categories.some((c) => c.name === "Trend");
      s.setComposer({ caption: d.caption, ...(hasTrend ? { category: "Trend" } : {}) });
      s.notify(
        d.overLimit
          ? `AI caption ready — ${d.caption.length}/${d.maxChars}, trim to fit`
          : "AI caption ready — review & edit before scheduling",
      );
    } else if (d.reason === "no_anthropic_key") {
      s.notify("Add your Anthropic key in Settings → Integrations & keys to use AI captions");
    } else if (d.reason === "rate_limited") {
      s.notify("Too many AI drafts — try again shortly");
    } else if (d.reason === "no_item") {
      s.notify("Refresh the feed and try again");
    } else if (d.reason === "api_error") {
      s.notify(`AI draft failed: ${d.status ?? "provider error"}`);
    } else {
      s.notify("Could not generate a caption");
    }
  };

  // Suggest (never auto-attach) the story's image. Fetches the og:image as a
  // preview; the operator decides whether to attach it (they own the rights).
  const suggestImage = async (it: { id: string }) => {
    setImgItemId(it.id);
    let res: Response;
    try {
      res = await fetch("/api/feeds/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedItemId: it.id }),
      });
    } catch {
      setImgItemId(null);
      s.notify("Couldn't reach the server");
      return;
    }
    setImgItemId(null);
    const d = await res.json().catch(() => ({}));
    if (d.ok) {
      setSuggestedImage({ dataUrl: d.dataUrl, publisher: d.publisher || "the source" });
      s.notify("Found a story image — review the rights before attaching");
    } else if (d.reason === "no_link") {
      s.notify("No clean article link to pull an image from");
    } else if (d.reason === "no_image") {
      s.notify("No image found on that story");
    } else if (d.reason === "rate_limited") {
      s.notify("Too many image lookups — try again shortly");
    } else {
      s.notify("Could not fetch a story image");
    }
  };

  // Attach the suggested image: turn the data URL into a File and run it through
  // the normal upload pipeline (validation + variants). Explicit operator action.
  const attachSuggested = async () => {
    if (!suggestedImage) return;
    try {
      // Decode the data URL by hand — fetch() on a data: URL is blocked by our
      // CSP (connect-src 'self'); the <img> preview works only because img-src
      // allows data:. atob → bytes → File, then the normal upload pipeline.
      const [head, b64] = suggestedImage.dataUrl.split(",");
      const mime = head.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ext = (mime.split("/")[1] || "jpg").replace("jpeg", "jpg");
      await attachFile(new File([bytes], `story-image.${ext}`, { type: mime }));
      setSuggestedImage(null);
    } catch {
      s.notify("Couldn't attach that image");
    }
  };

  // Rewrite the current draft into a brand-voice caption via the operator's
  // Anthropic key. Sized to the tightest selected platform; draft-only.
  const polishWithAI = async () => {
    if (!s.caption.trim()) {
      s.notify("Type a rough idea first — I'll rewrite it in your voice");
      return;
    }
    setPolishing(true);
    const maxChars = selPlatforms.length
      ? Math.min(...selPlatforms.map((p) => PLATFORM_RULES[p]?.limit ?? 280))
      : 280;
    let res: Response;
    try {
      res = await fetch("/api/compose/caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: s.caption, maxChars }),
      });
    } catch {
      setPolishing(false);
      s.notify("Couldn't reach the server");
      return;
    }
    setPolishing(false);
    const d = await res.json().catch(() => ({}));
    if (d.ok) {
      s.setComposer({ caption: d.caption });
      s.notify(d.overLimit ? `Rewritten — ${d.caption.length}/${d.maxChars}, trim to fit` : "Rewritten in your brand voice");
    } else if (d.reason === "no_anthropic_key") {
      s.notify("Add your Anthropic key in Settings → Integrations & keys");
    } else if (d.reason === "no_text") {
      s.notify("Type a rough idea first");
    } else if (d.reason === "rate_limited") {
      s.notify("Too many AI rewrites — try again shortly");
    } else {
      s.notify(`AI rewrite failed: ${d.status ?? "provider error"}`);
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
        {suggestedImage && (
          <div
            style={{
              border: "2px solid var(--color-accent)",
              background: "var(--color-accent-100, #eef4ff)",
              padding: 10,
              marginBottom: 16,
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={suggestedImage.dataUrl}
              alt="Suggested story image"
              style={{ width: 96, height: 96, objectFit: "cover", flex: "none", borderRadius: 6 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Suggested image</div>
              <div style={{ fontSize: 11.5, color: "var(--color-neutral-700)", marginBottom: 8 }}>
                From <strong>{suggestedImage.publisher}</strong>. You&apos;re responsible for the rights to reuse this
                image — attach it only if you have permission.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-primary" onClick={attachSuggested} disabled={uploading} style={{ fontSize: 12, padding: "4px 10px" }}>
                  {uploading ? "Attaching…" : "Attach image"}
                </button>
                <button className="btn btn-ghost" onClick={() => setSuggestedImage(null)} style={{ fontSize: 12, padding: "4px 10px" }}>
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}
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
            onClick={polishWithAI}
            disabled={polishing}
            title="Rewrite your draft in your brand voice (uses your Anthropic key)"
            style={{ border: "2px solid var(--color-accent-300)" }}
          >
            <Sparkles size={14} /> {polishing ? "Writing…" : "Write with AI"}
          </button>
          <span style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>
            Rewrites your draft in your brand voice · needs your Anthropic key
          </span>
        </div>

        {/* ── Hashtag suggestions ── */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <p className="kick" style={{ margin: 0 }}>
            Suggested hashtags
          </p>
          <span style={{ fontSize: 11, color: "var(--color-neutral-600)" }}>
            {hashtagsFromTrends ? "from your trending feeds · tap to add" : `for ${s.category} · tap to add`}
          </span>
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
            {/* Collapsed by default — the live char counter below is the
                always-on feedback; full rules are one click away. */}
            <details style={{ fontSize: 12.5, marginBottom: 10 }}>
              <summary
                style={{ cursor: "pointer", fontSize: 12, color: "var(--color-neutral-600)", padding: "1px 0" }}
              >
                {rules.name} rules · {rules.limit.toLocaleString()} chars · {rules.img.split("·")[0].trim()}
                {rules.vid.toLowerCase().includes("not") ? " · no video" : " · video ok"}
              </summary>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 18px", margin: "10px 0 2px" }}>
                {[
                  ["Caption limit", `${rules.limit.toLocaleString()} chars`],
                  ["Hashtags", rules.tags],
                  ["Image", rules.img],
                  ["Video", rules.vid],
                  ["Best aspect ratio", rules.best],
                ].map(([label, val]) => (
                  <div key={label} style={label === "Best aspect ratio" ? { gridColumn: "1/-1" } : undefined}>
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
              </div>
              <p style={{ fontSize: 11.5, color: "var(--color-neutral-500)", margin: "6px 0 0" }}>
                Base caption is validated live. Per-platform overrides ship later.
              </p>
            </details>
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
                {over
                  ? `${preview.length - tightest.limit} over the ${tightest.name} limit`
                  : `Within ${tightest.name} limits`}
              </span>
              <span style={charStyle}>
                {preview.length} / {tightest.limit.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* ── Schedule controls ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="date">Date</label>
              <DatePicker id="date" value={s.date} onChange={(v) => s.setComposer({ date: v })} />
            </div>
            <div className="field" style={{ width: 130 }}>
              <label htmlFor="time">Time</label>
              <TimePicker id="time" value={s.time} onChange={(v) => s.setComposer({ time: v })} />
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
              disabled={saving || publishing || scheduling}
              style={{ height: 42, whiteSpace: "nowrap" }}
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => submit("schedule")}
              disabled={saving || publishing || scheduling}
              style={{ height: 42, whiteSpace: "nowrap" }}
            >
              {scheduling ? "Scheduling…" : "Schedule post"}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => submit("now")}
              disabled={saving || publishing || scheduling}
              style={{ height: 42, whiteSpace: "nowrap" }}
              title="Publish immediately (lands within ~15s)"
            >
              {publishing ? "Publishing…" : "Publish now"}
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

        {/* ── Trending & breaking (assist rail) ── */}
        <div style={{ marginTop: 20, border: "2px solid var(--color-divider)", background: "var(--color-bg)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "12px 14px",
              borderBottom: "2px solid var(--color-divider)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 14 }}>
              <TrendingUp size={15} /> Trending &amp; breaking
            </span>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                setFeedBusy(true);
                const n = await s.pollFeeds();
                setFeedBusy(false);
                s.notify(n === 0 ? "Add RSS feeds in Settings" : `Refreshed ${n} feed${n > 1 ? "s" : ""}`);
              }}
              disabled={feedBusy}
              title="Refresh feeds now"
              aria-label="Refresh feeds now"
              style={{ flex: "none", padding: "5px 8px" }}
            >
              <RefreshCw size={14} style={feedBusy ? { opacity: 0.5 } : undefined} />
            </button>
          </div>
          <div style={{ padding: "6px 14px", borderBottom: "1px solid var(--color-divider)", background: "var(--color-neutral-100)", fontSize: 11, color: "var(--color-neutral-600)" }}>
            From your RSS feeds · auto-refreshes every 3h
          </div>
          {s.feedItems.length === 0 ? (
            <div style={{ padding: "16px 14px", fontSize: 12.5, color: "var(--color-neutral-600)" }}>
              No trending items yet. Add RSS/Atom feeds under{" "}
              <button
                onClick={() => router.push("/settings")}
                style={{ border: 0, background: "none", padding: 0, color: "var(--color-accent-700)", cursor: "pointer", font: "inherit", textDecoration: "underline" }}
              >
                Settings → Trend sources
              </button>
              .
            </div>
          ) : (
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {s.feedItems.map((it) => (
                <div key={it.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-divider)" }}>
                  <a
                    href={it.link}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "inline-flex", alignItems: "baseline", gap: 4, fontWeight: 600, fontSize: 13, color: "var(--color-text)", textDecoration: "none" }}
                  >
                    {it.title}
                    <ExternalLink size={11} style={{ flex: "none", opacity: 0.6, alignSelf: "center" }} />
                  </a>
                  <div style={{ fontSize: 11, color: "var(--color-neutral-600)", margin: "3px 0 8px" }}>
                    {it.sourceTitle}
                    {it.publishedAt ? ` · ${feedTimeAgo(it.publishedAt)}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => s.draftFromFeed(it)}
                      style={{ fontSize: 12, padding: "4px 10px" }}
                    >
                      Draft a post
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => aiDraftFromFeed(it)}
                      disabled={aiItemId === it.id}
                      title="Write a caption from this story in your brand voice (uses your Anthropic key)"
                      style={{ fontSize: 12, padding: "4px 10px" }}
                    >
                      <Sparkles size={13} /> {aiItemId === it.id ? "Writing…" : "AI draft"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => suggestImage(it)}
                      disabled={imgItemId === it.id}
                      title="Suggest the story's image (you decide whether the rights allow reuse)"
                      style={{ fontSize: 12, padding: "4px 10px" }}
                    >
                      {imgItemId === it.id ? "Finding…" : "🖼 Image"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
