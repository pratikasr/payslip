"use client";

/*
  Browser-wallet funding for the Fund step of the payroll flow (copied from the
  original payer Fund step so the flow does not depend on the old pages). This
  module loads wagmi, viem and RainbowKit, and it is imported with next/dynamic
  (ssr: false) so every other route stays light.

  WalletConnect needs a project id. When NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
  is empty only the injected (browser extension) wallet is offered;
  RainbowKit's injectedWallet never uses the project id, so no id is invented.
*/

import "@rainbow-me/rainbowkit/styles.css";

import { ConnectButton, connectorsForWallets, darkTheme, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useState } from "react";
import { toast } from "sonner";
import { erc20Abi, formatUnits, isAddress, type Address, type Hash as TxHash } from "viem";
import {
  createConfig,
  http,
  useAccount,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
  WagmiProvider,
} from "wagmi";
import { arbitrum, base, mainnet } from "wagmi/chains";
import { Hash } from "@/components/app/hash";
import { Button } from "@/components/ui/button";
import { api, toDisplayError, type EvmFunding } from "@/lib/api";

const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";
/** The USDC origins the venue accepts (service `NEAR_ORIGINS`): Base, Ethereum, Arbitrum. */
const CHAINS = [base, mainnet, arbitrum] as const;

const connectors = connectorsForWallets(
  PROJECT_ID
    ? [
        { groupName: "Browser", wallets: [injectedWallet] },
        { groupName: "Popular", wallets: [metaMaskWallet, rainbowWallet, walletConnectWallet] },
      ]
    : [{ groupName: "Browser", wallets: [injectedWallet] }],
  { appName: "Payslip", projectId: PROJECT_ID },
);

const config = createConfig({
  chains: CHAINS,
  connectors,
  ssr: false,
  transports: Object.fromEntries(CHAINS.map((c) => [c.id, http()])) as Record<
    (typeof CHAINS)[number]["id"],
    ReturnType<typeof http>
  >,
});

const queryClient = new QueryClient();

export interface WalletPayProps {
  runId: string;
  funding: EvmFunding;
  onSubmitted: (hash: string) => void;
}

export default function WalletPay(props: WalletPayProps) {
  const { resolvedTheme } = useTheme();
  const themeOptions = { accentColor: "#f4b728", accentColorForeground: "#1c1503", borderRadius: "medium" as const };
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={resolvedTheme === "dark" ? darkTheme(themeOptions) : lightTheme(themeOptions)}
          modalSize="compact"
        >
          <PayWithWallet {...props} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function describeWalletError(err: unknown): string {
  const e = err as { name?: string; shortMessage?: string; message?: string };
  if (e?.name === "UserRejectedRequestError" || /user rejected|denied/i.test(e?.shortMessage ?? e?.message ?? "")) {
    return "You rejected the request in your wallet. Nothing was sent.";
  }
  return e?.shortMessage ?? e?.message ?? "The wallet returned an error.";
}

function PayWithWallet({ runId, funding, onSubmitted }: WalletPayProps) {
  const chain = CHAINS.find((c) => c.id === funding.chain_id);
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { writeContractAsync, isPending: signing } = useWriteContract();
  const [hash, setHash] = useState<TxHash | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const token = funding.token_address as Address;
  const deposit = funding.deposit_address as Address;
  const amount = /^\d+$/.test(funding.amount_in_base_units) ? BigInt(funding.amount_in_base_units) : null;
  const addressesValid = isAddress(token) && isAddress(deposit);

  const reads = useReadContracts({
    allowFailure: false,
    contracts: [
      {
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address ?? "0x0000000000000000000000000000000000000000"],
        chainId: funding.chain_id,
      },
      { address: token, abi: erc20Abi, functionName: "decimals", chainId: funding.chain_id },
      { address: token, abi: erc20Abi, functionName: "symbol", chainId: funding.chain_id },
    ],
    query: { enabled: !!address && !!chain && addressesValid },
  });
  const receipt = useWaitForTransactionReceipt({ hash, chainId: funding.chain_id, query: { enabled: !!hash } });

  if (!chain) {
    return (
      <p className="text-[0.8125rem] text-destructive" role="alert">
        The venue asked for a deposit on chain id {funding.chain_id}, which this web app is not configured for. Send the
        deposit from any wallet using the address and amount shown, or add the chain in
        web/src/components/runs/new-run/wallet-pay.tsx.
      </p>
    );
  }
  if (!addressesValid || amount === null) {
    return (
      <p className="text-[0.8125rem] text-destructive" role="alert">
        The funding details from the service are not a valid EVM transfer (token {funding.token_address}, deposit{" "}
        {funding.deposit_address}). Request a new deposit address.
      </p>
    );
  }

  const [balance, decimals, symbol] = reads.data ?? [];
  const insufficient = balance !== undefined && balance < amount;

  const send = async () => {
    setError(null);
    try {
      if (chainId !== funding.chain_id) {
        await switchChainAsync({ chainId: funding.chain_id });
      }
      const txHash = await writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: "transfer",
        args: [deposit, amount],
        chainId: funding.chain_id,
      });
      setHash(txHash);
      onSubmitted(txHash);
      try {
        await api.reportDepositTx(runId, txHash);
      } catch (err) {
        const e = toDisplayError(err);
        toast.warning("Deposit sent, but the service did not record the transaction hash.", {
          description: `${e.message} The venue still detects the deposit on its own. ${e.hint}`,
        });
      }
    } catch (err) {
      setError(describeWalletError(err));
    }
  };

  const explorer = chain.blockExplorers?.default.url;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
        {isConnected && !hash ? (
          <Button onClick={send} disabled={switching || signing || insufficient}>
            {switching
              ? `Switching to ${chain.name}`
              : signing
                ? "Confirm in your wallet"
                : chainId !== funding.chain_id
                  ? `Switch to ${chain.name} and send`
                  : `Send ${funding.amount_in} ${funding.origin_asset}`}
          </Button>
        ) : null}
      </div>

      {isConnected && balance !== undefined && decimals !== undefined ? (
        <p className={insufficient ? "text-[0.8125rem] text-destructive" : "text-[0.8125rem] text-muted-foreground"}>
          Wallet balance on {chain.name}: <span className="num">{formatUnits(balance, decimals)}</span>{" "}
          {symbol ?? funding.origin_asset}
          {insufficient
            ? `. This is less than the ${funding.amount_in} ${funding.origin_asset} the run needs; top up or use another wallet.`
            : null}
        </p>
      ) : null}
      {!PROJECT_ID ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          Browser extension wallets only. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable mobile wallets through
          WalletConnect.
        </p>
      ) : null}

      {hash ? (
        <div className="rounded-xl bg-raised p-3.5 text-[0.8125rem]">
          <p className="font-medium">
            {receipt.isSuccess
              ? `Deposit confirmed on ${chain.name}`
              : receipt.isError
                ? `Could not confirm the deposit on ${chain.name}`
                : `Deposit sent, waiting for ${chain.name} to confirm`}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
            Transaction
            <Hash
              value={hash}
              label="deposit transaction hash"
              explorerUrl={explorer ? `${explorer}/tx/${hash}` : null}
            />
          </div>
          {receipt.data?.status === "reverted" ? (
            <p className="mt-1 text-destructive">
              The transfer reverted on chain. Check the token balance and send again.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-[0.8125rem] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
