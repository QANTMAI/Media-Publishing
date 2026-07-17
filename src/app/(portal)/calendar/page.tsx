"use client";

import { useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, EventDropArg } from "@fullcalendar/core";
import { usePortal } from "@/lib/store";
import { CATEGORY_COLORS, PLATFORM_COLORS, STATUS_COLORS, postColor } from "@/lib/platforms";
import type { CalView, Lens } from "@/lib/types";

const FC_VIEWS: Record<CalView, string> = {
  month: "dayGridMonth",
  week: "timeGridWeek",
  list: "listWeek",
};

export default function CalendarPage() {
  const { posts, lens, calView, setCalView, setLens, openDialog, rescheduleTarget } = usePortal();

  const events = useMemo(
    () =>
      posts
        .filter((p) => p.scheduledAt)
        .map((p) => {
          const c = postColor(p, lens);
          return {
            id: p.id,
            title: `${p.account.mark} · ${p.caption}`,
            start: p.scheduledAt!,
            allDay: false,
            backgroundColor: c + "22",
            borderColor: c,
            textColor: "#201e1d",
          };
        }),
    [posts, lens],
  );

  const legend = useMemo(() => {
    const map: Record<string, string> =
      lens === "category"
        ? CATEGORY_COLORS
        : lens === "status"
          ? STATUS_COLORS
          : {
              Instagram: PLATFORM_COLORS.IG,
              Facebook: PLATFORM_COLORS.FB,
              X: PLATFORM_COLORS.X,
              LinkedIn: PLATFORM_COLORS.IN,
              YouTube: PLATFORM_COLORS.YT,
              TikTok: PLATFORM_COLORS.TT,
            };
    return Object.entries(map).map(([label, color]) => ({ label, color }));
  }, [lens]);

  const rangeLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const onEventClick = (info: EventClickArg) => openDialog(info.event.id);
  const onEventDrop = (info: EventDropArg) => {
    const d = info.event.start;
    if (!d) {
      info.revert();
      return;
    }
    rescheduleTarget(info.event.id, d.toISOString()).then((ok) => {
      if (!ok) info.revert();
    });
  };

  return (
    <div>
      {/* Controls */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 22 }}>{rangeLabel}</div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div className="seg">
            {(["month", "week", "list"] as CalView[]).map((v) => (
              <button key={v} className={calView === v ? "on" : ""} onClick={() => setCalView(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--color-neutral-600)",
              }}
            >
              Color by
            </span>
            <div className="seg">
              {(["category", "platform", "status"] as Lens[]).map((l) => (
                <button key={l} className={lens === l ? "on" : ""} onClick={() => setLens(l)}>
                  {l[0].toUpperCase() + l.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
        {legend.map((l) => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span className="dot" style={{ background: l.color }} />
            {l.label}
          </div>
        ))}
      </div>

      {/* Calendar */}
      <div style={{ border: "2px solid var(--color-text)", background: "var(--color-bg)", padding: 10 }}>
        <FullCalendar
          key={calView}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={FC_VIEWS[calView]}
          headerToolbar={false}
          height="auto"
          editable
          dayMaxEvents={4}
          nowIndicator={false}
          firstDay={0}
          events={events}
          eventClick={onEventClick}
          eventDrop={onEventDrop}
        />
      </div>
      <p style={{ fontSize: 12, color: "var(--color-neutral-600)", marginTop: 10 }}>
        Runs on FullCalendar (MIT). Drag any event to reschedule · click to open · switch views and color lens above.
      </p>
    </div>
  );
}
