"use client";

/* A self-contained date picker that replaces the native <input type="date">.
 * The native popup is drawn by the browser and gets clipped at the viewport
 * edge in embedded/webview contexts. This one renders into a portal on
 * document.body with fixed positioning, flips above the field when there isn't
 * room below, and clamps to the viewport — so it can never be cut off. Value is
 * an ISO "YYYY-MM-DD" string (same as the native input), so callers are
 * unchanged. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { parseISO, toISO, daysInMonth } from "@/lib/date-util";

const WD = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function label(v: string | undefined): string {
  const p = parseISO(v);
  if (!p) return "Select date";
  return new Date(p.y, p.m, p.d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function DatePicker({
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

  const selected = parseISO(value);
  const today = new Date();
  const [view, setView] = useState(() =>
    selected ? { y: selected.y, m: selected.m } : { y: today.getFullYear(), m: today.getMonth() },
  );

  // Open the popover, re-centering the calendar on the selected month. Done in
  // the handler (not an effect) so we never setState synchronously in an effect.
  const toggle = () => {
    const next = !open;
    if (next && selected) setView({ y: selected.y, m: selected.m });
    setOpen(next);
  };

  // Position after render: prefer below, flip above if it would overflow, then
  // clamp into the viewport. Measured, so it adapts to the real popover size.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const h = popRef.current?.offsetHeight ?? 330;
    const w = popRef.current?.offsetWidth ?? 288;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    setPos({ top, left });
  }, [open, view]);

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

  const nDays = daysInMonth(view.y, view.m);
  const firstWd = new Date(view.y, view.m, 1).getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWd; i++) cells.push(null);
  for (let d = 1; d <= nDays; d++) cells.push(d);

  const isToday = (d: number) =>
    view.y === today.getFullYear() && view.m === today.getMonth() && d === today.getDate();
  const isSel = (d: number) => !!selected && view.y === selected.y && view.m === selected.m && d === selected.d;

  const prev = () => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const next = () => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));
  const pick = (d: number) => {
    onChange(toISO(view.y, view.m, d));
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        id={id}
        ref={btnRef}
        className="input"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{ textAlign: "left", cursor: "pointer", width: "100%" }}
      >
        {label(value)}
      </button>
      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="Choose date"
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              zIndex: 1000,
              width: 288,
              background: "var(--color-bg)",
              border: "2px solid var(--color-text)",
              borderRadius: 12,
              padding: 12,
              boxShadow: "0 12px 34px rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={prev} aria-label="Previous month" style={{ padding: "2px 8px" }}>
                <ChevronLeft size={16} />
              </button>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {MONTHS[view.m]} {view.y}
              </div>
              <button type="button" className="btn btn-ghost" onClick={next} aria-label="Next month" style={{ padding: "2px 8px" }}>
                <ChevronRight size={16} />
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
              {WD.map((w) => (
                <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--color-neutral-500)", padding: "2px 0" }}>
                  {w}
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
              {cells.map((d, i) =>
                d === null ? (
                  <div key={i} />
                ) : (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pick(d)}
                    aria-label={`${MONTHS[view.m]} ${d}, ${view.y}`}
                    aria-current={isToday(d) ? "date" : undefined}
                    style={{
                      aspectRatio: "1",
                      border: isSel(d) ? "2px solid var(--color-accent)" : "1px solid transparent",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: isSel(d) ? "var(--color-accent-100, #e7efff)" : "transparent",
                      fontWeight: isToday(d) ? 800 : 500,
                      fontSize: 13,
                      color: "var(--color-text)",
                    }}
                  >
                    {d}
                  </button>
                ),
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "4px 8px" }}
                onClick={() => {
                  const t = new Date();
                  onChange(toISO(t.getFullYear(), t.getMonth(), t.getDate()));
                  setOpen(false);
                }}
              >
                Today
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
