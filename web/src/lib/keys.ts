/*
  Client-side classification of pasted or scanned key material. The service
  also rejects spending keys; this check stops them before they leave the
  browser. Prefixes verified 5 Oct 2026 against ZIP 316 (unified addresses and
  viewing keys, Revisions 0 and 2) and ZIP 32 (Sapling and Orchard extended
  keys): https://zips.z.cash/zip-0316 and https://zips.z.cash/zip-0032
*/

import type { Network } from "@/lib/api";

export type KeyClassification =
  { kind: "ufvk"; network: Network; value: string } | { kind: "rejected"; reason: string; spending: boolean };

const FVK_HRPS: Record<string, Network> = {
  uview: "mainnet",
  uvf: "mainnet",
  uviewtest: "testnet",
  uvftest: "testnet",
};

const IVK_HRPS = new Set(["uivk", "uvi", "uivktest", "uvitest"]);
const ADDRESS_HRPS = new Set(["u", "zu", "tu", "utest", "zutest", "tutest"]);
const SAPLING_FVK_HRPS = new Set(["zxviews", "zxviewtestsapling"]);

const BECH32_DATA = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;

const PREFIXES = "uview or uvf on mainnet, uviewtest or uvftest on testnet";

const SPENDING_MESSAGE = `This looks like a spending key or seed phrase. Never paste it here: it can move funds. Payslip needs only a viewing key, which starts with ${PREFIXES}.`;

function looksLikeMnemonic(value: string): boolean {
  const words = value.trim().split(/\s+/);
  return words.length >= 12 && words.length <= 24 && words.every((w) => /^[a-z]{3,8}$/.test(w));
}

/** Classify one candidate key string. Whitespace around it is ignored. */
export function classifyKey(raw: string): KeyClassification {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { kind: "rejected", reason: "Paste a viewing key first.", spending: false };
  }

  if (looksLikeMnemonic(trimmed)) {
    return { kind: "rejected", reason: SPENDING_MESSAGE, spending: true };
  }

  const value = trimmed.replace(/\s+/g, "");
  const lower = value.toLowerCase();

  if (lower.startsWith("secret-") || /^(sk|st)[1-9a-hj-np-z]{40,}$/i.test(value)) {
    return { kind: "rejected", reason: SPENDING_MESSAGE, spending: true };
  }
  // Transparent private keys in WIF form (mainnet 5/K/L, testnet 9/c).
  if (/^[5KL9c][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(value)) {
    return { kind: "rejected", reason: SPENDING_MESSAGE, spending: true };
  }
  // A bare hex string is a transaction id or raw key material; neither is a viewing key.
  if (/^(0x)?[0-9a-f]{64}$|^(0x)?[0-9a-f]{128}$/i.test(value)) {
    return {
      kind: "rejected",
      reason: `This is a hex string, such as a transaction id or raw key bytes, not a viewing key. Never paste raw keys here. A viewing key starts with ${PREFIXES}.`,
      spending: true,
    };
  }

  const sep = lower.lastIndexOf("1");
  if (sep <= 0) {
    return {
      kind: "rejected",
      reason: `This is not a Zcash viewing key. A unified full viewing key starts with ${PREFIXES}.`,
      spending: false,
    };
  }
  const hrp = lower.slice(0, sep);
  const data = lower.slice(sep + 1);

  if (hrp in FVK_HRPS) {
    if (value !== lower && value !== value.toUpperCase()) {
      return {
        kind: "rejected",
        reason:
          "This key mixes upper and lower case letters, so it was changed after export. Copy it again from the original.",
        spending: false,
      };
    }
    if (!BECH32_DATA.test(data) || data.length < 100) {
      return {
        kind: "rejected",
        reason: "This viewing key is incomplete or has a typo. Copy it again from the original.",
        spending: false,
      };
    }
    return { kind: "ufvk", network: FVK_HRPS[hrp], value: lower };
  }
  if (IVK_HRPS.has(hrp)) {
    return {
      kind: "rejected",
      reason: `This is an incoming viewing key. Statements need the full viewing key (starts with ${PREFIXES}) so outgoing payments can be read too. Ask the payer for the full viewing key.`,
      spending: false,
    };
  }
  if (ADDRESS_HRPS.has(hrp)) {
    return {
      kind: "rejected",
      reason:
        "This is a payment address, not a viewing key. An address receives funds; a viewing key reads them. The payer shares the viewing key from the Payslip access page.",
      spending: false,
    };
  }
  if (SAPLING_FVK_HRPS.has(hrp)) {
    return {
      kind: "rejected",
      reason: `This is a Sapling-only viewing key. Payslip pays from the newest shielded pool, so it needs a unified full viewing key (starts with ${PREFIXES}).`,
      spending: false,
    };
  }
  return {
    kind: "rejected",
    reason: `This is not a Zcash viewing key. A unified full viewing key starts with ${PREFIXES}.`,
    spending: false,
  };
}

/** Split a block of text (one key per line, or separated by commas or spaces). */
export function splitKeys(text: string): string[] {
  const lines = text
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  // A line containing spaces could be a seed phrase; keep it whole so it is caught.
  return lines;
}

/** Fingerprint for display only: never sent anywhere. */
export function keyPreview(value: string): string {
  if (value.length <= 22) return value;
  return `${value.slice(0, 14)}…${value.slice(-6)}`;
}
