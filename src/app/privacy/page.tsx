import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — QANTM Media Publishing Portal",
  description:
    "How the QANTM Media Publishing Portal handles your data: what it stores, how secrets are protected, and when content leaves the app.",
};

/* Public legal page — deliberately outside the (portal) auth group so it is
 * readable without signing in. Content is written to match what the app
 * ACTUALLY does (single-operator tool that stores an account, encrypted
 * social tokens, your Anthropic key, posts, media and an audit log) — not a
 * boilerplate "we collect nothing" notice. Keep it truthful when the app
 * changes. Last content review: 2026-08-01. */

const UPDATED = "August 1, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <h2
        style={{
          fontFamily: "var(--font-heading)",
          fontWeight: 800,
          fontSize: 19,
          margin: "0 0 10px",
          color: "var(--color-text)",
        }}
      >
        {title}
      </h2>
      <div style={{ fontSize: 15, lineHeight: 1.65, color: "var(--color-neutral-800)" }}>{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main style={{ background: "var(--color-bg)", minHeight: "100vh", color: "var(--color-text)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "56px 24px 80px" }}>
        <p className="kick" style={{ fontSize: 12, textTransform: "uppercase" }}>
          QANTM Media Publishing Portal
        </p>
        <h1 style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 34, margin: "6px 0 6px" }}>
          Privacy
        </h1>
        <p style={{ fontSize: 13, color: "var(--color-neutral-600)", margin: "0 0 8px" }}>
          Last updated: {UPDATED}
        </p>
        <p style={{ fontSize: 15, lineHeight: 1.65, color: "var(--color-neutral-800)", margin: "0 0 36px" }}>
          This portal is a private, single-operator publishing tool. It is not a public service and it is not
          ad-supported. This page explains, plainly, what the app stores, how it protects secrets, and the only
          times your content leaves the app.
        </p>

        <Section title="Who we are">
          QANTM AI builds and maintains the QANTM Media Publishing Portal from Connecticut, USA. For any privacy
          question, email{" "}
          <a href="mailto:info@qantm.ai" style={{ color: "var(--color-accent-700)" }}>
            info@qantm.ai
          </a>
          .
        </Section>

        <Section title="A private, single-operator tool">
          The portal is designed to run for one operator — you. There is no open sign-up, no public directory, and
          no shared multi-tenant database. Your instance holds your data and no one else&rsquo;s. QANTM AI does not
          operate your instance for you and does not receive a copy of what it stores.
        </Section>

        <Section title="What the portal stores">
          To do its job, the app keeps the following in your own database:
          <ul style={{ margin: "10px 0 0", paddingLeft: 22 }}>
            <li>
              <strong>Your operator account</strong> — email address, your password stored only as a salted{" "}
              <em>bcrypt</em> hash (never in plain text), and, if you enable two-factor authentication, your
              authenticator secret.
            </li>
            <li>
              <strong>Connected social accounts</strong> — the handle/ID of each account you connect and the access
              token the platform issues so the app can publish on your behalf.
            </li>
            <li>
              <strong>App credentials you enter</strong> — OAuth client ID/secret for platforms you set up, and your
              Anthropic API key for the AI features.
            </li>
            <li>
              <strong>Your content</strong> — posts, drafts, schedules, captions, media you upload, brand-voice
              settings, and the episodic-memory notes the app keeps to stay consistent.
            </li>
            <li>
              <strong>An audit log</strong> — a record of security-relevant actions (sign-ins, account connect /
              disconnect, publishes) so you can see what happened and when.
            </li>
          </ul>
        </Section>

        <Section title="How secrets and tokens are protected">
          Access tokens, OAuth secrets, and your Anthropic API key are encrypted at rest with{" "}
          <strong>AES-256-GCM</strong> in a credential vault and are never shown again in the interface after you
          enter them. They are used only to connect and publish to the platforms you chose. Passwords are never
          stored in a recoverable form — only as a one-way bcrypt hash.
        </Section>

        <Section title="When your content leaves the app">
          The portal sends data outward only in these cases, all triggered by you:
          <ul style={{ margin: "10px 0 0", paddingLeft: 22 }}>
            <li>
              <strong>To platforms you publish to</strong> — when you connect or publish, the post text and any media
              go to that platform (for example Bluesky or YouTube), governed by that platform&rsquo;s own privacy
              policy.
            </li>
            <li>
              <strong>To Anthropic, for AI features you invoke</strong> — when you use &ldquo;Write with AI,&rdquo;
              autopilot, brand-voice analysis, or memory tools, the relevant text is sent to Anthropic&rsquo;s Claude
              API using <em>your own</em> API key, subject to Anthropic&rsquo;s API terms. AI never runs on its own —
              only when you press a button.
            </li>
            <li>
              <strong>To news/RSS sources you add</strong> — your server fetches the feed and article URLs you
              configure so it can draft from them.
            </li>
          </ul>
          Nothing else is transmitted anywhere.
        </Section>

        <Section title="AI is Anthropic only, with your key">
          Every AI feature is powered by Anthropic&rsquo;s Claude models and runs on the API key you supply. The app
          does not use OpenAI or any other AI provider, and it does not send your data to any model unless you
          trigger a feature that needs it.
        </Section>

        <Section title="No cookies for tracking, no analytics, no ads">
          The app sets only two first-party cookies: <code>qantm_session</code> to keep you signed in, and{" "}
          <code>qantm_oauth_state</code> to protect the account-connect flow against cross-site request forgery.
          There are no advertising cookies, no third-party analytics, no pixels, and no trackers, and a strict
          Content-Security-Policy blocks third-party scripts.
        </Section>

        <Section title="Where the app runs">
          You control where the portal is hosted — on your own machine or your own server. Standard hosting metadata
          (such as request logs) is handled by whichever infrastructure you choose to run it on, under that
          provider&rsquo;s policies. QANTM AI does not host your instance and does not collect your usage.
        </Section>

        <Section title="No selling or sharing">
          Your data is yours. QANTM AI does not receive it, does not sell it, and does not share it with anyone. The
          only outbound flows are the ones you initiate, described above.
        </Section>

        <Section title="Keeping and deleting your data">
          You keep your data for as long as you keep your instance. Disconnecting a social account deletes its stored
          token; deleting a post, draft, or media asset removes it from your database. Because it is your own
          instance, you can also remove data directly at the database level at any time.
        </Section>

        <Section title="Your privacy rights">
          Depending on where you live, privacy law may give you rights to access, correct, or delete personal data
          held about you. Because this is your own private instance holding your own data, you exercise those rights
          directly by managing or deleting the data in the app. If you need help, contact{" "}
          <a href="mailto:info@qantm.ai" style={{ color: "var(--color-accent-700)" }}>
            info@qantm.ai
          </a>
          .
        </Section>

        <Section title="Children&rsquo;s privacy">
          The portal is an operator tool for adults and is not directed to children under 13. It does not knowingly
          collect information from children.
        </Section>

        <Section title="Changes to this policy">
          If this policy changes, the &ldquo;Last updated&rdquo; date above changes with it. The portal&rsquo;s source
          history is the authoritative record of what changed and when.
        </Section>

        <Section title="Reporting a concern">
          To report a privacy or security concern, email{" "}
          <a href="mailto:info@qantm.ai" style={{ color: "var(--color-accent-700)" }}>
            info@qantm.ai
          </a>
          . Security issues are triaged directly by QANTM AI.
        </Section>

        <p style={{ marginTop: 44, paddingTop: 18, borderTop: "2px solid var(--color-divider)" }}>
          <Link href="/login" style={{ color: "var(--color-accent-700)", fontWeight: 600, fontSize: 14 }}>
            ← Back to sign-in
          </Link>
        </p>
      </div>
    </main>
  );
}
