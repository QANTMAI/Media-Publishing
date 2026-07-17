"use client";

import { useEffect, useRef } from "react";
import { usePortal } from "@/lib/store";
import { CATEGORIES, postColor } from "@/lib/platforms";

function formatWhen(iso: string | null): string {
  if (!iso) return "draft";
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

export function PostDialog() {
  const { posts, dialogId, lens, closeDialog, cancelTarget, setPostCategory } = usePortal();
  const post = dialogId != null ? posts.find((p) => p.id === dialogId) : null;
  const closeRef = useRef<HTMLButtonElement>(null);

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

  const cancellable = post.status === "draft" || post.status === "scheduled" || post.status === "failed";
  // Seeded/mock permalinks are demo artifacts, not live posts — label them.
  const mockLink = post.permalink?.includes("mock.qantm.local") ?? false;

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
          <span className="dot" style={{ width: 12, height: 12, background: postColor(post, lens) }} />
          <div id="post-dialog-title" style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 17 }}>
            {post.account.name} · {formatWhen(post.scheduledAt)}
          </div>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ margin: "0 0 12px" }}>{post.caption}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="tag tag-neutral">{post.status}</span>
            <span className="tag tag-outline">{post.account.handle}</span>
            {post.demo && <span className="tag tag-outline">demo data</span>}
          </div>
          {/* Reassign category — recolors the event live on the calendar. */}
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="post-category">Category</label>
            <select
              id="post-category"
              className="input"
              value={CATEGORIES.includes(post.category) ? post.category : ""}
              onChange={(e) => setPostCategory(post.postId, e.target.value)}
              style={{ maxWidth: 240 }}
            >
              {!CATEGORIES.includes(post.category) && <option value="">{post.category}</option>}
              {CATEGORIES.map((c) => (
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
          {cancellable && (
            <button className="btn btn-primary" onClick={() => cancelTarget(post.id)}>
              Cancel this post
            </button>
          )}
          <button ref={closeRef} className="btn btn-secondary" onClick={closeDialog}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
