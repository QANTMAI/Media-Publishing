import { db } from "./db";
import { encrypt, decrypt } from "./vault";

/* Operator API keys (bring-your-own-key). Encrypted with the same AES-256-GCM
 * vault as OAuth tokens. Write-only: neither ciphertext nor plaintext ever
 * leaves the server — the client only ever sees `hint` (last 4 chars).
 *
 * OpenAI is intentionally absent and must never be added (standing rule). */

interface ProviderDef {
  label: string;
  /** Short guidance shown under the field. */
  keyHint: string;
  where: string; // where to get the key
  /** Live validation: a cheap authenticated call that proves the key works.
   * Returns ok + a short human-readable status. Never logs the key. */
  test: (key: string) => Promise<{ ok: boolean; status: string }>;
}

async function anthropicTest(key: string): Promise<{ ok: boolean; status: string }> {
  // Listing models is a free, read-only, authenticated call — 200 proves the
  // key is valid, 401 proves it isn't. 10s timeout so a hung network can't
  // wedge the request.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true, status: "Key is valid" };
    if (res.status === 401) return { ok: false, status: "Key was rejected (401 unauthorized)" };
    return { ok: false, status: `Provider returned ${res.status}` };
  } catch (err) {
    return { ok: false, status: err instanceof Error && err.name === "AbortError" ? "Timed out reaching the provider" : "Could not reach the provider" };
  } finally {
    clearTimeout(timer);
  }
}

export const CREDENTIAL_PROVIDERS: Record<string, ProviderDef> = {
  anthropic: {
    label: "Anthropic (Claude)",
    keyHint: "Starts with sk-ant-",
    where: "console.anthropic.com → API keys",
    test: anthropicTest,
  },
};

export function isProvider(p: string): p is keyof typeof CREDENTIAL_PROVIDERS {
  return Object.prototype.hasOwnProperty.call(CREDENTIAL_PROVIDERS, p);
}

export interface CredentialView {
  provider: string;
  label: string;
  keyHint: string;
  where: string;
  set: boolean;
  hint: string | null; // last 4 chars, only when set
  updatedAt: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
}

/** Masked view of every supported provider — set or not. Never includes the
 * key or ciphertext. */
export async function listCredentials(userId: string): Promise<CredentialView[]> {
  const rows = await db.credential.findMany({ where: { userId } });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return Object.entries(CREDENTIAL_PROVIDERS).map(([provider, def]) => {
    const row = byProvider.get(provider);
    return {
      provider,
      label: def.label,
      keyHint: def.keyHint,
      where: def.where,
      set: !!row,
      hint: row?.hint ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
      lastTestOk: row?.lastTestOk ?? null,
    };
  });
}

/** Store (or replace) a provider key. Returns the masked hint. */
export async function setCredential(userId: string, provider: string, key: string): Promise<string> {
  const trimmed = key.trim();
  const hint = trimmed.slice(-4);
  await db.credential.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ciphertext: encrypt(trimmed), hint, keyVersion: 1, lastTestedAt: null, lastTestOk: null },
    // A new key invalidates the previous test result.
    update: { ciphertext: encrypt(trimmed), hint, lastTestedAt: null, lastTestOk: null },
  });
  return hint;
}

export async function deleteCredential(userId: string, provider: string): Promise<boolean> {
  const res = await db.credential.deleteMany({ where: { userId, provider } });
  return res.count > 0;
}

/** Server-only: decrypt a provider key for use by a real consumer (e.g. the
 * AI studio when it ships). Never expose the result to the client. */
export async function getCredentialPlaintext(userId: string, provider: string): Promise<string | null> {
  const row = await db.credential.findUnique({ where: { userId_provider: { userId, provider } } });
  return row ? decrypt(row.ciphertext) : null;
}

/** Run the provider's live validation against the stored key and record the
 * result. Returns the outcome (never the key). */
export async function testCredential(userId: string, provider: string): Promise<{ ok: boolean; status: string }> {
  const def = CREDENTIAL_PROVIDERS[provider];
  if (!def) return { ok: false, status: "Unknown provider" };
  const key = await getCredentialPlaintext(userId, provider);
  if (!key) return { ok: false, status: "No key saved" };
  const result = await def.test(key);
  await db.credential.updateMany({
    where: { userId, provider },
    data: { lastTestedAt: new Date(), lastTestOk: result.ok },
  });
  return result;
}
