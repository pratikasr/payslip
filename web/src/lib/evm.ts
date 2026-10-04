/*
  Lightweight EVM chain metadata for display. The wallet module (loaded only
  on the Fund step) has the full wagmi chain objects; this table lets the rest
  of the page name a chain without loading viem.
*/
export const EVM_CHAINS: Record<number, { name: string; explorer: string }> = {
  1: { name: "Ethereum", explorer: "https://etherscan.io" },
  8453: { name: "Base", explorer: "https://basescan.org" },
  42161: { name: "Arbitrum One", explorer: "https://arbiscan.io" },
  10: { name: "OP Mainnet", explorer: "https://optimistic.etherscan.io" },
  137: { name: "Polygon", explorer: "https://polygonscan.com" },
  11155111: { name: "Sepolia", explorer: "https://sepolia.etherscan.io" },
  84532: { name: "Base Sepolia", explorer: "https://sepolia.basescan.org" },
  421614: { name: "Arbitrum Sepolia", explorer: "https://sepolia.arbiscan.io" },
};

export function evmChainName(chainId: number, fallback?: string): string {
  return EVM_CHAINS[chainId]?.name ?? fallback ?? `chain ${chainId}`;
}

/** Origin chains offered when asking the venue for a deposit address. */
export const ORIGIN_CHAINS = [
  { value: "base", label: "Base" },
  { value: "arb", label: "Arbitrum" },
  { value: "eth", label: "Ethereum" },
] as const;
