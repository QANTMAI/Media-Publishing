"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  CalView,
  Category,
  CategoryDef,
  Lens,
  PostType,
  PostView,
  SocialAccount,
} from "./types";
import { CATEGORY_COLORS, CATEGORY_FALLBACK_COLOR, MARK_TO_PLATFORM } from "./platforms";

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
  categories: CategoryDef[];
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
  refreshCategories: () => Promise<void>;
  createCategory: (name: string, color?: string) => Promise<boolean>;
  updateCategory: (id: string, patch: { name?: string; color?: string; hashtags?: string[] }) => Promise<boolean>;
  deleteCategory: (id: string) => Promise<boolean>;
  toggleKill: () => Promise<void>;
  toggleAutopilot: () => Promise<boolean>;
  cancelTarget: (id: string) => Promise<boolean>;
  rescheduleTarget: (id: string, scheduledAtIso: string) => Promise<boolean>;
  setPostCategory: (postId: string, category: string) => Promise<void>;
  editPostCaption: (postId: string, caption: string) => Promise<boolean>;
  approveDraft: (postId: string) => Promise<boolean>;
  discardDraft: (postId: string) => Promise<boolean>;
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
      categories: [],
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

      refreshCategories: async () => {
        const res = await apiFetch("/api/categories");
        if (res?.ok) set({ categories: (await res.json()).categories });
      },

      createCategory: async (name, color) => {
        const res = await apiFetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, ...(color ? { color } : {}) }),
        });
        if (res?.ok) {
          await get().refreshCategories();
          get().notify(`Category “${name}” added`);
          return true;
        }
        if (res) get().notify((await res.json().catch(() => ({}))).error ?? "Could not add category");
        return false;
      },

      updateCategory: async (id, patch) => {
        const res = await apiFetch(`/api/categories/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res?.ok) {
          // A rename relabels existing posts server-side — refresh both.
          await Promise.all([get().refreshCategories(), get().refreshPosts()]);
          return true;
        }
        if (res) get().notify((await res.json().catch(() => ({}))).error ?? "Could not update category");
        return false;
      },

      deleteCategory: async (id) => {
        const res = await apiFetch(`/api/categories/${id}`, { method: "DELETE" });
        if (res?.ok) {
          await get().refreshCategories();
          get().notify("Category deleted");
          return true;
        }
        if (res) get().notify((await res.json().catch(() => ({}))).error ?? "Could not delete category");
        return false;
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
            ? d.mode === "review"
              ? `Autopilot on — drafted ${d.planned} posts for your review`
              : `Autopilot on — scheduled ${d.planned} posts this week`
            : `Autopilot paused — ${d.removed} AI-planned posts removed`,
        );
        // Review mode holds drafts on the dashboard; auto mode fills the
        // calendar. The caller (topbar/dashboard) jumps to the calendar only
        // when there's something scheduled to see.
        return d.autopilot === true && d.mode !== "review";
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

      setPostCategory: async (postId, category) => {
        const res = await apiFetch(`/api/posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category }),
        });
        if (res?.ok) {
          await get().refreshPosts();
          get().notify(`Category set to ${category}`);
        } else if (res) {
          get().notify("Could not update category");
        }
      },

      editPostCaption: async (postId, caption) => {
        const res = await apiFetch(`/api/posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseCaption: caption }),
        });
        if (res?.ok) {
          await get().refreshPosts();
          return true;
        }
        if (res) get().notify((await res.json().catch(() => ({}))).error ?? "Could not save caption");
        return false;
      },

      approveDraft: async (postId) => {
        const res = await apiFetch(`/api/posts/${postId}/approve`, { method: "POST" });
        if (res?.ok) {
          set({ dialogId: null });
          await get().refreshPosts();
          get().notify("Approved — added to the schedule");
          return true;
        }
        if (res) get().notify((await res.json().catch(() => ({}))).error ?? "Could not approve");
        return false;
      },

      discardDraft: async (postId) => {
        const res = await apiFetch(`/api/posts/${postId}`, { method: "DELETE" });
        if (res?.ok) {
          set({ dialogId: null });
          await get().refreshPosts();
          get().notify("Draft discarded");
          return true;
        }
        if (res) get().notify((await res.json().catch(() => ({}))).error ?? "Could not discard");
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

/** Build a category→color resolver from the operator's live categories, with
 * the seeded defaults as fallback. Pass the result to `postColor` so renamed /
 * recolored / deleted categories render correctly on the calendar and cards. */
export function categoryColorResolver(categories: CategoryDef[]): (name: string) => string {
  const live = new Map(categories.map((c) => [c.name, c.color]));
  return (name: string) => live.get(name) ?? CATEGORY_COLORS[name] ?? CATEGORY_FALLBACK_COLOR;
}

/** Selected accounts that map to a composer-supported platform and are connected. */
export function selectableAccounts(s: Pick<PortalState, "selAccts" | "accounts">) {
  return s.selAccts.filter((id) =>
    s.accounts.some(
      (a) => a.id === id && MARK_TO_PLATFORM[a.mark] && a.status !== "disconnected",
    ),
  );
}
