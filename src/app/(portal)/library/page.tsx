"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { usePortal } from "@/lib/store";
import { listAssets, uploadAsset, type AssetListItem } from "@/lib/upload";

export default function LibraryPage() {
  const notify = usePortal((s) => s.notify);
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const list = await listAssets();
    setAssets(list);
    setLoaded(true);
  }, []);

  // Canonical fetch-on-mount with a cancellation guard (react.dev pattern) —
  // state updates happen in the resolved continuation, not the effect body.
  useEffect(() => {
    let cancelled = false;
    listAssets().then((list) => {
      if (cancelled) return;
      setAssets(list);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll while any video is still transcoding so the tile flips to ready
  // without a manual reload.
  useEffect(() => {
    if (!assets.some((a) => a.status === "processing")) return;
    const t = setTimeout(refresh, 5000);
    return () => clearTimeout(t);
  }, [assets, refresh]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      try {
        await uploadAsset(file);
        notify(`Uploaded ${file.name}`);
      } catch (err) {
        notify(err instanceof Error ? err.message : `Upload failed: ${file.name}`);
      }
    }
    setBusy(false);
    refresh();
  };

  const onDelete = async (a: AssetListItem) => {
    const res = await fetch(`/api/assets/${a.id}`, { method: "DELETE" });
    notify(res.ok ? `Deleted ${a.filename}` : (await res.json()).error ?? "Delete failed");
    refresh();
  };

  const q = filter.trim().toLowerCase();
  const shown = q
    ? assets.filter((a) => a.filename.toLowerCase().includes(q) || (a.tags ?? "").toLowerCase().includes(q))
    : assets;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 16,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <p className="kick" style={{ margin: 0 }}>
          Asset library · signed private storage
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            className="input"
            placeholder="Filter by name or tag…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 220, padding: "7px 10px", fontSize: 13 }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
            multiple
            hidden
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload size={14} /> {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>

      {loaded && shown.length === 0 && (
        <div
          style={{
            border: "2px dashed var(--color-neutral-400)",
            background: "var(--color-neutral-100)",
            padding: "48px 20px",
            textAlign: "center",
            color: "var(--color-neutral-600)",
            fontSize: 14,
          }}
        >
          {assets.length === 0
            ? "No assets yet — upload images or video to build your library."
            : "Nothing matches that filter."}
        </div>
      )}

      {shown.length > 0 && (
        <div className="stack stack-strong" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
          {shown.map((a) => (
            <div key={a.id}>
              <div
                style={{
                  height: 130,
                  background: "var(--color-neutral-200)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--color-neutral-500)",
                  fontSize: 11,
                  overflow: "hidden",
                }}
              >
                {a.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.thumbUrl}
                    alt={a.filename}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  "VIDEO"
                )}
              </div>
              <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {a.filename}
                  </div>
                  <span
                    className={a.status === "failed" ? "tag tag-outline" : "tag tag-neutral"}
                    title={a.status === "failed" ? (a.error ?? undefined) : undefined}
                    style={{
                      marginTop: 4,
                      fontSize: 10,
                      ...(a.status === "failed" ? { color: "var(--color-accent-2-700)" } : {}),
                    }}
                  >
                    {a.status === "processing"
                      ? "processing…"
                      : a.status === "failed"
                        ? "failed"
                        : a.type === "video" && a.durationS
                          ? `video · ${Math.round(a.durationS)}s`
                          : a.width
                            ? `${a.width}×${a.height}`
                            : a.type}
                  </span>
                </div>
                <button
                  className="btn btn-ghost"
                  title={`Delete ${a.filename}`}
                  aria-label={`Delete ${a.filename}`}
                  onClick={() => onDelete(a)}
                  style={{ padding: "6px 8px", flex: "none" }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
