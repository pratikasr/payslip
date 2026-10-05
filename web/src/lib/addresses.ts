/*
  Client-side checks for addresses typed into forms. The service is the
  authority (it decodes the address); these checks catch the common mistakes
  early with a message that names the fix. Prefixes from ZIP 316.
*/
import type { Network } from "@/lib/api";

const UA_HRPS: Record<string, Network> = {
  u: "mainnet",
  zu: "mainnet",
  tu: "mainnet",
  utest: "testnet",
  zutest: "testnet",
  tutest: "testnet",
};

/**
 * The address as the service expects it: trimmed, and lower case when it was copied in all
 * capitals (Bech32m allows one case or the other; the service reads lower case).
 */
export function normaliseUnifiedAddress(raw: string): string {
  const value = raw.trim();
  return value === value.toUpperCase() ? value.toLowerCase() : value;
}

export function checkUnifiedAddress(raw: string, network?: Network): string | null {
  const value = raw.trim();
  if (!value) return "Enter the contractor's unified address.";
  if (/\s/.test(value)) return "This address has a space or a line break in it. Copy it again from the wallet.";
  const lower = value.toLowerCase();
  if (/^t[1m3]/i.test(value) && !lower.startsWith("tu")) {
    return "This is a transparent address, which would make the payment public. Ask the contractor for a unified address from Zodl or another shielded wallet.";
  }
  if (lower.startsWith("zs1") || lower.startsWith("ztestsapling1")) {
    return "This is a Sapling address. Ask the contractor for a unified address (starts with u1 on mainnet, utest1 on testnet).";
  }
  if (value !== lower && value !== value.toUpperCase()) {
    return "This address mixes capital and small letters, so a character was changed. Copy it again from the wallet.";
  }
  const sep = lower.lastIndexOf("1");
  const hrp = sep > 0 ? lower.slice(0, sep) : "";
  const net = UA_HRPS[hrp];
  if (!net) return "This is not a Zcash unified address. It starts with u1 on mainnet or utest1 on testnet.";
  if (network && net !== network) {
    return `This is a ${net} address, but the service runs on ${network}. Ask for a ${network} address.`;
  }
  if (!/^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/.test(lower.slice(sep + 1))) {
    return "This address has characters that cannot appear in a unified address. Copy it again from the wallet.";
  }
  return null;
}

/**
 * The USDC payout address for `chain`: 0x and 40 hex characters on Base, Arbitrum and Ethereum,
 * a base58 public key on Solana. The service checks Solana keys exactly (32 bytes) and says so.
 */
export function checkPayoutAddress(raw: string, chain: string): string | null {
  if (chain !== "sol") return checkEvmAddress(raw);
  const value = raw.trim();
  if (!value) return "Enter the payout address for USDC.";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))
    return "Enter a Solana address: 32 to 44 letters and digits, without 0, O, I or l.";
  return null;
}

export function checkEvmAddress(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter the payout address for USDC.";
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return "Enter an EVM address: 0x followed by 40 hex characters.";
  return null;
}

/** Payout chains offered for convert_usdc (USDC routes the service supports via 1Click). Values are sent as payout_chain. */
export const PAYOUT_CHAINS = [
  { value: "base", label: "Base" },
  { value: "arb", label: "Arbitrum" },
  { value: "eth", label: "Ethereum" },
  { value: "sol", label: "Solana" },
] as const;

export function chainLabel(value: string | null | undefined): string {
  if (!value) return "Not set";
  return PAYOUT_CHAINS.find((c) => c.value === value)?.label ?? value.charAt(0).toUpperCase() + value.slice(1);
}
