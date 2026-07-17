"use client";

import Image from "next/image";

/** Left-hand blue brand panel shared by the login and setup screens. */
export function AuthPoster() {
  return (
    <div
      style={{
        width: "44%",
        flex: "none",
        background: "var(--color-accent)",
        color: "#fff",
        padding: "48px 44px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <Image
        src="/logo-landing.png"
        alt="QANTM Media"
        width={216}
        height={72}
        style={{ height: 72, width: "auto", alignSelf: "flex-start" }}
        priority
      />
      <div>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 800,
            fontSize: 44,
            lineHeight: 1.02,
            letterSpacing: "-0.02em",
          }}
        >
          One portal.
          <br />
          Every channel.
          <br />
          Locked down.
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.55, maxWidth: "34ch", marginTop: 18, opacity: 0.92 }}>
          Your accounts are protected by two-factor authentication and encrypted
          credential storage. We never see your passwords.
        </p>
      </div>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.85 }}>
        Secure publishing portal
      </div>
    </div>
  );
}
