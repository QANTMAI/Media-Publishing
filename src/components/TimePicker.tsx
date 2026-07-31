"use client";

/* Clip-proof time picker (companion to DatePicker). Replaces the native
 * <input type="time"> whose popup clips at the viewport edge in embedded views.
 * Renders a scrollable list of times into a portal on document.body with fixed
 * positioning, flips above the field when there's no room below, and clamps to
 * the viewport. Value stays "HH:MM" (24h), same as the native input, so callers
 * are unchanged. Times snap to a 15-minute grid. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format12h, timeOptions } from "@/lib/date-util";

const OPTIONS = timeOptions(15);

export function TimePicker({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const h = popRef.current?.offsetHeight ?? 260;
    const w = popRef.current?.offsetWidth ?? 160;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    setPos({ top, left });
    // Bring the selected time into view within the scroll list.
    popRef.current?.querySelector<HTMLElement>('[data-sel="1"]')?.scrollIntoView({ block: "center" });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (t: string) => {
    onChange(t);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        id={id}
        ref={btnRef}
        className="input"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{ textAlign: "left", cursor: "pointer", width: "100%" }}
      >
        {format12h(value) || "Select time"}
      </button>
      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            aria-label="Choose time"
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              zIndex: 1000,
              width: 160,
              maxHeight: 260,
              overflowY: "auto",
              background: "var(--color-bg)",
              border: "2px solid var(--color-text)",
              borderRadius: 12,
              padding: 6,
              boxShadow: "0 12px 34px rgba(0,0,0,0.18)",
            }}
          >
            {OPTIONS.map((t) => {
              const sel = t === value;
              return (
                <button
                  key={t}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  data-sel={sel ? "1" : undefined}
                  onClick={() => pick(t)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    border: 0,
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: sel ? 800 : 500,
                    background: sel ? "var(--color-accent-100, #e7efff)" : "transparent",
                    color: "var(--color-text)",
                  }}
                >
                  {format12h(t)}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
