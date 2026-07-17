import nodemailer, { type Transporter } from "nodemailer";

/* Email delivery seam. Real SMTP via nodemailer when the deployment configures
 * it; otherwise honestly reports "not configured" and sends nothing — we never
 * claim to have emailed when we couldn't.
 *
 * Config (env): SMTP_URL (e.g. smtps://user:pass@smtp.host:465) and
 * SMTP_FROM (the From address). Both required; absent = disabled. */

export function emailConfigured(): boolean {
  return !!(process.env.SMTP_URL && process.env.SMTP_FROM);
}

let cached: Transporter | null = null;
function transport(): Transporter {
  if (!cached) cached = nodemailer.createTransport(process.env.SMTP_URL);
  return cached;
}

export interface SendResult {
  sent: boolean;
  reason?: string; // why it wasn't sent (config missing, or the error)
}

/** Send a plain-text email. Returns {sent:false, reason} instead of throwing,
 * so a notification is never lost just because email delivery hiccuped. */
export async function sendEmail(to: string, subject: string, text: string): Promise<SendResult> {
  if (!emailConfigured()) return { sent: false, reason: "SMTP not configured" };
  try {
    await transport().sendMail({ from: process.env.SMTP_FROM, to, subject, text });
    return { sent: true };
  } catch (err) {
    // Never surface SMTP credentials or the raw stack to callers/logs beyond a
    // short reason.
    const reason = err instanceof Error ? err.message.slice(0, 200) : "send failed";
    console.error("email send failed:", reason);
    return { sent: false, reason };
  }
}
