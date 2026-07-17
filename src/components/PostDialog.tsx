"use client";

import { useEffect, useRef, useState } from "react";
import { usePortal, categoryColorResolver } from "@/lib/store";
import { postColor } from "@/lib/platforms";

function formatWhen(iso: string | null): string {
  if (!iso) return "draft";
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

export function PostDialog() {
  const { posts, categories, dialogId, lens, closeDialog, cancelTarget, setPostCategory, editPostCaption, approveDraft, discardDraft } =
    usePortal();
  const post = dialogId != null ? posts.find((p) => p.id === dialogId) ?? null : null;
  const closeRef = useRef<HTMLButtonElement>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDraft = post?.status === "draft";

  // Seed the editable caption when a new dialog opens — done during render
  // (the recommended "adjust state when a prop changes" pattern) rather than
  // in an effect, so there's no cascading re-render.
  if (post && post.id !== seededFor) {
    setSeededFor(post.id);
    setDraftCaption(post.caption);
  }

  // Keyboard accessibility: focus moves into the dialog on open; Escape closes.
  useEffect(() => {
    if (!post) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [post, closeDialog]);

  if (!post) return null;

  const categoryNames = categories.map((c) => c.name);
  const colorFor = categoryColorResolver(categories);
  const cancellable = post.status === "scheduled" || post.status === "failed";
  // Seeded/mock permalinks are demo artifacts, not live posts — label them.
  const mockLink = post.permalink?.includes("mock.qantm.local") ?? false;

  const approve = async () => {
    setBusy(true);
    // Persist a caption edit first, then schedule — so the approved post
    // carries what the operator sees.
    if (draftCaption.trim() && draftCaption.trim() !== post.caption) {
      const ok = await editPostCaption(post.postId, draftCaption);
      if (!ok) {
        setBusy(false);
        return;
      }
    }
    await approveDraft(post.postId);
    setBusy(false);
  };

  return (
    <div className="dialog-backdrop" onClick={closeDialog}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-dialog-title"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 20px",
            borderBottom: "2px solid var(--color-text)",
          }}
        >
          <span className="dot" style={{ width: 12, height: 12, background: postColor(post, lens, colorFor) }} />
          <div id="post-dialog-title" style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 17 }}>
            {post.account.name} · {formatWhen(post.scheduledAt)}
          </div>
        </div>
        <div style={{ padding: 20 }}>
          {isDraft ? (
            // Drafts are editable in place — this is the review-inbox editor.
            <div className="field" style={{ marginBottom: 12 }}>
              <label htmlFor="draft-caption">Caption</label>
              <textarea
                id="draft-caption"
                className="input"
                value={draftCaption}
                onChange={(e) => setDraftCaption(e.target.value)}
                style={{ minHeight: 90, resize: "vertical" }}
              />
            </div>
          ) : (
            <p style={{ margin: "0 0 12px" }}>{post.caption}</p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="tag tag-neutral">{post.status}</span>
            <span className="tag tag-outline">{post.account.handle}</span>
            {post.autopilot && <span className="tag tag-outline">autopilot</span>}
            {post.demo && <span className="tag tag-outline">demo data</span>}
          </div>
          {/* Reassign category — recolors the event live on the calendar. */}
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="post-category">Category</label>
            <select
              id="post-category"
              className="input"
              value={categoryNames.includes(post.category) ? post.category : ""}
              onChange={(e) => setPostCategory(post.postId, e.target.value)}
              style={{ maxWidth: 240 }}
            >
              {!categoryNames.includes(post.category) && <option value="">{post.category}</option>}
              {categoryNames.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {post.status === "published" && post.permalink && (
            <p style={{ fontSize: 13, margin: "12px 0 0" }}>
              {mockLink ? (
                <span style={{ color: "var(--color-neutral-600)" }}>
                  Mock publish (no real platform call): <code>{post.permalink}</code>
                </span>
              ) : (
                <>
                  Live at{" "}
                  <a href={post.permalink} target="_blank" rel="noreferrer">
                    {post.permalink}
                  </a>
                </>
              )}
            </p>
          )}
          {post.status === "failed" && post.error && (
            <p
              style={{
                fontSize: 13,
                margin: "12px 0 0",
                color: "var(--color-accent-2-700)",
                fontWeight: 600,
              }}
            >
              Failed: {post.error}
            </p>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "16px 20px",
            borderTop: "2px solid var(--color-divider)",
          }}
        >
          {isDraft ? (
            <>
              <button className="btn btn-primary" onClick={approve} disabled={busy}>
                {busy ? "Scheduling…" : "Approve & schedule"}
              </button>
              <button className="btn btn-ghost" onClick={() => discardDraft(post.postId)} disabled={busy}>
                Discard
              </button>
            </>
          ) : (
            cancellable && (
              <button className="btn btn-primary" onClick={() => cancelTarget(post.id)}>
                Cancel this post
              </button>
            )
          )}
          <button ref={closeRef} className="btn btn-secondary" onClick={closeDialog}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
