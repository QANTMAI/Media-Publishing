"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  CalView,
  Category,
  Lens,
  PostType,
  PostView,
  SocialAccount,
} from "./types";
import { MARK_TO_PLATFORM } from "./platforms";

/* Server truth: auth (httpOnly cookies), accounts (/api/accounts), posts and
 * jobs (/api/posts), kill switch + autopilot (/api/settings). This store is a
 * client cache of those plus composer/view preferences; only the preferences
 * are persisted locally. */

interface PortalState {
  // composer preferences
  caption: string;
  category: Category;
  postType: PostType;
  activeTab: string;
  selAccts: string[];
  date: string;
  time: string;
  tz: string;

  // view preferences
  calView: CalView;
  lens: Lens;

  // server-cached data
  posts: PostView[];
  accounts: SocialAccount[];
  killOn: boolean;
  autopilot: boolean;

  // transient ui
  dialogId: string | null;
  toast: string;

  // actions
  setComposer: (patch: Partial<Pick<PortalState, "caption" | "category" | "postType" | "activeTab" | "date" | "time" | "tz">>) => void;
  toggleAccount: (id: string) => void;
  addHashtag: (tag: string) => void;
  setAccounts: (accounts: SocialAccount[]) => void;
  refreshPosts: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  toggleKill: () => Promise<void>;
  toggleAutopilot: () => Promise<boolean>;
  cancelTarget: (id: string) => Promise<boolean>;
  rescheduleTarget: (id: string, scheduledAtIso: string) => Promise<boolean>;
  setCalView: (v: CalView) => void;
  setLens: (l: Lens) => void;
  openDialog: (id: string) => void;
  closeDialog: () => void;
  notify: (msg: string) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function defaultScheduleDate(): string {
  // Local calendar date, not UTC — toISOString() lands evening users west of
  // UTC on the wrong day.
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Shared fetch wrapper: expired sessions bounce to sign-in instead of
 * silently degrading; network failures surface as a toast, not an unhandled
 * rejection. Returns null on any failure. */
async function apiFetch(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    const res = await fetch(path, init);
    if (res.status === 401) {
      window.location.assign("/login");
      return null;
    }
    return res;
  } catch {
    usePortal.getState().notify("Network error — check your connection and retry");
    return null;
  }
}

export const usePortal = create<PortalState>()(
  persist(
    (set, get) => ({
      caption: "",
      category: "Promo",
      postType: "image",
      activeTab: "instagram",
      selAccts: [],
      date: defaultScheduleDate(),
      time: "18:00",
      tz: "ET (Eastern)",

      calView: "month",
      lens: "category",

      posts: [],
      accounts: [],
      killOn: false,
      autopilot: false,

      dialogId: null,
      toast: "",

      setComposer: (patch) => set(patch),

      toggleAccount: (id) =>
        set((s) => ({
          selAccts: s.selAccts.includes(id)
            ? s.selAccts.filter((x) => x !== id)
            : [...s.selAccts, id],
        })),

      addHashtag: (tag) =>
        set((s) => {
          const c = s.caption ?? "";
          if (c.includes(tag)) return {};
          return { caption: (c.trim() ? c.trim() + " " : "") + tag };
        }),

      setAccounts: (accounts) =>
        set((s) => {
          // Reconcile the composer selection with server truth; default to
          // connected Instagram + X accounts when nothing valid is selected.
          const connectable = accounts.filter(
            (a) => a.status !== "disconnected" && MARK_TO_PLATFORM[a.mark],
          );
          let selAccts = s.selAccts.filter((id) => connectable.some((a) => a.id === id));
          if (!selAccts.length) {
            selAccts = connectable
              .filter((a) => a.platform === "instagram" || a.platform === "x")
              .slice(0, 3)
              .map((a) => a.id);
          }
          return { accounts, selAccts };
        }),

      refreshPosts: async () => {
        const res = await apiFetch("/api/posts");
        if (res?.ok) set({ posts: (await res.json()).targets });
      },

      refreshSettings: async () => {
        const res = await apiFetch("/api/settings");
        if (res?.ok) {
          const d = await res.json();
          set({ killOn: d.killOn, autopilot: d.autopilot });
        }
      },

      toggleKill: async () => {
        const next = !get().killOn;
        const res = await apiFetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ killOn: next }),
        });
        if (res?.ok) {
          set({ killOn: next });
          get().notify(next ? "All publishing paused" : "Publishing resumed");
        } else if (res) {
          get().notify("Could not update the kill switch");
        }
      },

      /** Returns true when autopilot was turned ON (caller jumps to calendar). */
      toggleAutopilot: async () => {
        const next = !get().autopilot;
        const res = await apiFetch("/api/autopilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ on: next }),
        });
        if (!res?.ok) {
          if (res) get().notify("Autopilot update failed");
          return false;
        }
        const d = await res.json();
        set({ autopilot: d.autopilot });
        await get().refreshPosts();
        get().notify(
          d.autopilot
            ? `Autopilot on — planned ${d.planned} posts this week`
            : `Autopilot paused — ${d.removed} AI-planned posts removed`,
        );
        return d.autopilot === true;
      },

      cancelTarget: async (id) => {
        const res = await apiFetch(`/api/targets/${id}/cancel`, { method: "POST" });
        if (res?.ok) {
          set({ dialogId: null });
          await get().refreshPosts();
          get().notify("Post cancelled — moved to drafts");
          return true;
        }
        if (res) {
          const body = await res.json().catch(() => ({}));
          get().notify(body.error ?? "Cancel failed");
        }
        return false;
      },

      rescheduleTarget: async (id, scheduledAtIso) => {
        const res = await apiFetch(`/api/targets/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduledAt: scheduledAtIso }),
        });
        if (res?.ok) {
          await get().refreshPosts();
          const d = new Date(scheduledAtIso);
          get().notify(
            `Rescheduled to ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}`,
          );
          return true;
        }
        if (res) {
          const body = await res.json().catch(() => ({}));
          get().notify(body.error ?? "Reschedule failed");
        }
        await get().refreshPosts(); // snap the calendar back
        return false;
      },

      setCalView: (v) => set({ calView: v }),
      setLens: (l) => set({ lens: l }),
      openDialog: (id) => set({ dialogId: id }),
      closeDialog: () => set({ dialogId: null }),

      notify: (msg) => {
        set({ toast: msg });
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => set({ toast: "" }), 3200);
      },
    }),
    {
      name: "qantm-portal",
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true,
      // Only local preferences persist; data is refetched from the API.
      partialize: (s) => ({
        caption: s.caption,
        category: s.category,
        postType: s.postType,
        activeTab: s.activeTab,
        selAccts: s.selAccts,
        date: s.date,
        time: s.time,
        tz: s.tz,
        calView: s.calView,
        lens: s.lens,
      }),
    },
  ),
);

/** Rehydrate the persisted store after mount; returns true once ready.
 * Subscription-based: the flag flips in persist's onFinishHydration callback
 * (an external-system event), never synchronously inside the effect body. */
export function useStoreHydration() {
  const [hydrated, setHydrated] = useState(() => usePortal.persist.hasHydrated());
  useEffect(() => {
    const unsub = usePortal.persist.onFinishHydration(() => setHydrated(true));
    usePortal.persist.rehydrate();
    return unsub;
  }, []);
  return hydrated;
}

/** Selected accounts that map to a composer-supported platform and are connected. */
export function selectableAccounts(s: Pick<PortalState, "selAccts" | "accounts">) {
  return s.selAccts.filter((id) =>
    s.accounts.some(
      (a) => a.id === id && MARK_TO_PLATFORM[a.mark] && a.status !== "disconnected",
    ),
  );
}
