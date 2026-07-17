"use client";

import { LIBRARY_ASSETS } from "@/lib/store";

export default function LibraryPage() {
  return (
    <div>
      <p className="kick">Asset library · signed private storage</p>
      <div
        className="stack stack-strong"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}
      >
        {LIBRARY_ASSETS.map((m) => (
          <div key={m.name}>
            <div
              style={{
                height: 130,
                background: "var(--color-neutral-200)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-neutral-500)",
                fontSize: 11,
              }}
            >
              {m.type}
            </div>
            <div style={{ padding: "8px 10px" }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {m.name}
              </div>
              <span className="tag tag-neutral" style={{ marginTop: 4, fontSize: 10 }}>
                {m.tag}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
