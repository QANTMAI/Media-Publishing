"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Sparkles } from "lucide-react";
import { usePortal, useStoreHydration } from "@/lib/store";
import { Toast } from "@/components/Toast";
import { PostDialog } from "@/components/PostDialog";
import { NotificationBell } from "@/components/NotificationBell";

// Handoff #2: Analytics is no longer a nav item — it lives as a Dashboard
// section. Settings is new.
const NAV = [
  { href: "/dashboard", label: "Dashboard", title: "Dashboard" },
  { href: "/compose", label: "Compose", title: "Compose a post" },
  { href: "/calendar", label: "Calendar", title: "Content calendar" },
  { href: "/library", label: "Library", title: "Media library" },
  { href: "/accounts", label: "Accounts", title: "Connected accounts" },
  { href: "/settings", label: "Settings", title: "Settings" },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { killOn, toggleKill, autopilot, toggleAutopilot, setAccounts, refreshPosts, refreshSettings, refreshCategories } =
    usePortal();
  const hydrated = useStoreHydration();
  const [authed, setAuthed] = useState(false);

  // Auth is server truth: the httpOnly session cookie, checked via the API.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me").then(async (res) => {
      if (cancelled) return;
      if (res.ok) {
        setAuthed(true);
        const data = await fetch("/api/accounts").then((r) => (r.ok ? r.json() : { accounts: [] }));
        if (!cancelled) setAccounts(data.accounts);
        refreshPosts();
        refreshSettings();
        refreshCategories();
      } else {
        router.replace("/login");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router, setAccounts, refreshPosts, refreshSettings, refreshCategories]);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  if (!hydrated || !authed) return null;

  const pageTitle = NAV.find((n) => pathname.startsWith(n.href))?.title ?? "Dashboard";

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-bg)" }}>
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: 232,
          flex: "none",
          borderRight: "2px solid var(--color-text)",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <div style={{ padding: "20px 16px 18px", borderBottom: "2px solid var(--color-text)" }}>
          <Image
            src="/logo-dark.png"
            alt="QANTM Media"
            width={140}
            height={26}
            style={{ height: 26, width: "auto" }}
            priority
          />
          <div
            style={{
              fontSize: 10,
              color: "var(--color-neutral-600)",
              marginTop: 8,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Publishing portal
          </div>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", padding: "8px 0", flex: 1 }}>
          {NAV.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className="navbtn" aria-current={active ? "page" : undefined}>
                {active && <span className="active-bar" />}
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div
          style={{
            borderTop: "2px solid var(--color-divider)",
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Image
            src="/logo-mark.png"
            alt=""
            width={30}
            height={30}
            style={{ width: 30, height: 30, objectFit: "contain", flex: "none" }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 13,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              QANTM Media
            </div>
            <div style={{ fontSize: 11, color: "var(--color-neutral-600)" }}>Solo creator</div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={signOut}
            title="Sign out"
            aria-label="Sign out"
            style={{ flex: "none", padding: "6px 10px" }}
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* ── Main column ── */}
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "16px 28px",
            borderBottom: "2px solid var(--color-text)",
            background: "var(--color-bg)",
            position: "sticky",
            top: 0,
            zIndex: 5,
          }}
        >
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 20 }}>
            {pageTitle}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <NotificationBell />
            <button
              className="btn"
              onClick={async () => {
                const turnedOn = await toggleAutopilot();
                if (turnedOn) router.push("/calendar");
              }}
              style={
                autopilot
                  ? { background: "var(--color-accent-2)", border: "2px solid var(--color-accent-2)", color: "#201e1d" }
                  : { background: "transparent", border: "2px solid var(--color-text)", color: "var(--color-text)" }
              }
            >
              <Sparkles size={14} /> Autopilot: {autopilot ? "On" : "Off"}
            </button>
            <button className="btn btn-secondary" onClick={toggleKill}>
              {killOn ? "Resume publishing" : "Pause all publishing"}
            </button>
            <Link href="/compose" className="btn btn-primary" style={{ textDecoration: "none" }}>
              New post
            </Link>
          </div>
        </header>

        {killOn && (
          <div
            style={{
              background: "var(--color-accent)",
              color: "#fff",
              padding: "8px 28px",
              fontFamily: "var(--font-heading)",
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: "0.02em",
            }}
          >
            PUBLISHING PAUSED — all queued posts are held. Toggle the kill switch to resume.
          </div>
        )}

        <div style={{ padding: 28, flex: 1 }}>{children}</div>
      </main>

      <Toast />
      <PostDialog />
    </div>
  );
}
