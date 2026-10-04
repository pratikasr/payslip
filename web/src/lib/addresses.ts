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

export function checkUnifiedAddress(raw: string, network?: Network): string | null {
  const value = raw.trim();
  if (!value) return "Enter the contractor's unified address.";
  const lower = value.toLowerCase();
  if (/^t[1m3]/i.test(value) && !lower.startsWith("tu")) {
    return "This is a transparent address, which would make the payment public. Ask the contractor for a unified address from Zodl or another shielded wallet.";
  }
  if (lower.startsWith("zs1") || lower.startsWith("ztestsapling1")) {
    return "This is a Sapling address. Ask the contractor for a unified address (starts with u1 on mainnet, utest1 on testnet).";
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
] as const;

export function chainLabel(value: string | null | undefined): string {
  if (!value) return "Not set";
  return PAYOUT_CHAINS.find((c) => c.value === value)?.label ?? value.charAt(0).toUpperCase() + value.slice(1);
}
