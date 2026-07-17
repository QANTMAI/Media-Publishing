"use client";

import { usePortal } from "@/lib/store";
import { postColor } from "@/lib/platforms";

function formatWhen(iso: string | null): string {
  if (!iso) return "draft";
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

export function PostDialog() {
  const { posts, dialogId, lens, closeDialog, cancelTarget } = usePortal();
  const post = dialogId != null ? posts.find((p) => p.id === dialogId) : null;
  if (!post) return null;

  const cancellable = post.status === "draft" || post.status === "scheduled" || post.status === "failed";

  return (
    <div className="dialog-backdrop" onClick={closeDialog}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
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
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 17 }}>
            {post.account.name} · {formatWhen(post.scheduledAt)}
          </div>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ margin: "0 0 12px" }}>{post.caption}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="tag tag-outline">{post.category}</span>
            <span className="tag tag-neutral">{post.status}</span>
            <span className="tag tag-outline">{post.account.handle}</span>
          </div>
          {post.status === "published" && post.permalink && (
            <p style={{ fontSize: 13, margin: "12px 0 0" }}>
              Live at{" "}
              <a href={post.permalink} target="_blank" rel="noreferrer">
                {post.permalink}
              </a>
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
          <button className="btn btn-secondary" onClick={closeDialog}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
