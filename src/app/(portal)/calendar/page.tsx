"use client";

import { useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg, EventDropArg } from "@fullcalendar/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePortal, categoryColorResolver } from "@/lib/store";
import { PLATFORM_COLORS, STATUS_COLORS, postColor } from "@/lib/platforms";
import type { CalView, Lens } from "@/lib/types";

const FC_VIEWS: Record<CalView, string> = {
  month: "dayGridMonth",
  week: "timeGridWeek",
  list: "listWeek",
};

const DRAGGABLE_STATES = new Set(["draft", "scheduled", "failed"]);

export default function CalendarPage() {
  const { posts, categories, lens, calView, setCalView, setLens, openDialog, rescheduleTarget } = usePortal();
  const calRef = useRef<FullCalendar>(null);
  const [rangeLabel, setRangeLabel] = useState("");
  const colorFor = useMemo(() => categoryColorResolver(categories), [categories]);

  const events = useMemo(
    () =>
      posts
        .filter((p) => p.scheduledAt)
        .map((p) => {
          const c = postColor(p, lens, colorFor);
          const statusWord = lens === "status" ? ` · ${p.status}` : "";
          return {
            id: p.id,
            title: `${p.account.mark}${statusWord} · ${p.caption}`,
            start: p.scheduledAt!,
            allDay: false,
            backgroundColor: c + "22",
            borderColor: c,
            textColor: "#201e1d",
            // Published / mid-publish posts are locked server-side; don't
            // offer a drag that can only bounce.
            editable: DRAGGABLE_STATES.has(p.status),
          };
        }),
    [posts, lens, colorFor],
  );

  const legend = useMemo(() => {
    if (lens === "category") {
      return categories.map((c) => ({ label: c.name, color: c.color }));
    }
    const map: Record<string, string> =
      lens === "status"
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
  }, [lens, categories]);

  const nav = (dir: "prev" | "next" | "today") => {
    const api = calRef.current?.getApi();
    if (!api) return;
    if (dir === "prev") api.prev();
    else if (dir === "next") api.next();
    else api.today();
  };

  const onEventClick = (info: EventClickArg) => openDialog(info.event.id);
  const onEventDrop = (info: EventDropArg) => {
    const d = info.event.start;
    if (!d) {
      info.revert();
      return;
    }
    rescheduleTarget(info.event.id, d.toISOString())
      .then((ok) => {
        if (!ok) info.revert();
      })
      .catch(() => info.revert());
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="seg">
            <button onClick={() => nav("prev")} aria-label="Previous period" style={{ padding: "8px 10px" }}>
              <ChevronLeft size={15} />
            </button>
            <button onClick={() => nav("today")}>Today</button>
            <button onClick={() => nav("next")} aria-label="Next period" style={{ padding: "8px 10px" }}>
              <ChevronRight size={15} />
            </button>
          </div>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 22 }}>{rangeLabel}</div>
        </div>
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
          ref={calRef}
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
          datesSet={(arg: DatesSetArg) => setRangeLabel(arg.view.title)}
        />
      </div>
      <p style={{ fontSize: 12, color: "var(--color-neutral-600)", marginTop: 10 }}>
        Runs on FullCalendar (MIT). Drag a draft/scheduled/failed event to reschedule · published posts are locked ·
        click to open.
      </p>
    </div>
  );
}
