/*
  Typed client for the Payslip service REST API. The shapes below follow
  docs/API.md field for field. Amounts are integers: ZEC in zatoshis, USD in
  cents, rates in USD per ZEC times 1,000,000.
*/

export const API_URL = (process.env.NEXT_PUBLIC_PAYSLIP_API_URL?.trim() || "http://127.0.0.1:8080").replace(/\/+$/, "");

export type Network = "mainnet" | "testnet";
export type VenueId = "near-intents-1click" | "maya" | "testnet-fixed-rate";

export interface ApiErrorBody {
  code: string;
  message: string;
  hint: string;
}

export interface Health {
  /** "degraded" when lightwalletd is unreachable or a warning exists. */
  status: "ok" | "degraded" | string;
  network: Network;
  lightwalletd: string;
  chain_tip: number;
  wallet_synced_height: number;
  venue: VenueId;
  birthday_height: number;
  version: string;
  /** Present on the live service: the last lightwalletd error, if any. */
  lightwalletd_error?: string | null;
  clock_skew_seconds?: number | null;
  /** Human-readable warnings, for example clock skew or a lagging lightwalletd. */
  warnings?: string[];
}

export interface Treasury {
  account_index: number;
  unified_address: string;
  spendable_zat: number;
  pending_zat: number;
  total_zat: number;
}

export interface Wallet {
  network: Network;
  chain_tip: number;
  synced_height: number;
  treasury: Treasury;
  contractor_accounts: number;
}

export type SettlementChoice = "hold_zec" | "convert_usdc";

export interface Contractor {
  id: string;
  name: string;
  email: string | null;
  unified_address: string;
  account_index: number;
  settlement_choice: SettlementChoice;
  payout_chain: string | null;
  payout_address: string | null;
  fvk_shared_at: string | null;
  created_at: string;
}

export interface NewContractor {
  name: string;
  unified_address: string;
  settlement_choice: SettlementChoice;
  email?: string;
  payout_chain?: string;
  payout_address?: string;
}

export interface ContractorViewingKey {
  contractor_id: string;
  account_index: number;
  ufvk: string;
  birthday_height: number;
  network: Network;
}

export interface ViewingKeyExportEntry {
  label: string;
  role: "treasury" | "contractor";
  account_index: number;
  ufvk: string;
  contractor_id: string | null;
}

export interface ViewingKeyExport {
  network: Network;
  birthday_height: number;
  keys: ViewingKeyExportEntry[];
}

export type RunStatus =
  "draft" | "awaiting_funds" | "funded" | "swapping" | "swapped" | "allocating" | "paying" | "paid" | "failed";

export type FundingStatus = "awaiting_deposit" | "processing" | "success" | "refunded" | "failed" | "expired";

/**
 * Funding record. The EVM fields (chain, token, deposit address, deadline)
 * are null for the testnet fixed-rate venue, which needs no deposit.
 */
export interface Funding {
  venue: VenueId;
  status: FundingStatus;
  origin_asset: string;
  origin_chain: string | null;
  token_address: string | null;
  chain_id: number | null;
  amount_in: string;
  amount_in_base_units: string;
  deposit_address: string | null;
  deadline: string | null;
  funded_usd_cents: number | null;
  zec_acquired_zat: number | null;
  rate_usd_per_zec_e6: number | null;
  venue_ref: string | null;
  deposit_tx_hash?: string | null;
  refund_reason?: string | null;
  requested_usd_cents?: number | null;
  quoted_zat?: number | null;
  venue_status?: string | null;
}

/** Funding that asks for an EVM deposit: the fields the browser wallet needs are present. */
export type EvmFunding = Funding & { chain_id: number; token_address: string; deposit_address: string };

export function isEvmFunding(f: Funding | null | undefined): f is EvmFunding {
  return !!f && typeof f.chain_id === "number" && !!f.token_address && !!f.deposit_address;
}

export type PayLineStatus = "pending" | "allocated" | "broadcast" | "confirmed" | "failed";

export interface PayLine {
  id: string;
  contractor_id: string;
  contractor_name: string;
  account_index: number;
  invoice_ref: string;
  amount_usd_cents: number;
  amount_zat: number | null;
  status: PayLineStatus;
  /** Per-line allocation tx, if the service reports one per line. */
  allocation_txid?: string | null;
  txid: string | null;
  confirmed_height: number | null;
  explorer_url: string | null;
  memo: string | null;
  error: ApiErrorBody | null;
  settlement_choice?: SettlementChoice;
  payout_chain?: string | null;
  /** Conversion to USDC for a convert_usdc line (ADR-018); null for lines that hold ZEC. */
  settlement?: Conversion | null;
}

export interface Conversion {
  venue: string;
  status: "quoted" | "processing" | "success" | "refunded" | "failed" | "simulated";
  deposit_address: string;
  amount_zat: number;
  payout_chain: string;
  payout_address: string;
  quoted_out: string;
  delivered_out: string | null;
  delivered_tx: string | null;
  simulated: boolean;
  refund_reason: string | null;
}

export interface Run {
  id: string;
  status: RunStatus;
  period_start: string;
  period_end: string;
  period_label: string;
  total_usd_cents: number;
  total_zat: number | null;
  funding: Funding | null;
  fees_zat: number | null;
  lines: PayLine[];
  error: ApiErrorBody | null;
  created_at: string;
  updated_at: string;
  network?: Network;
  /** The treasury-to-contractor-accounts allocation, one transaction per run. */
  allocation_txid?: string | null;
  allocation_height?: number | null;
  allocation_explorer_url?: string | null;
  /** True while the executor is working on this run. */
  executing?: boolean;
  /** For a failed run, the status it failed in. */
  failed_from?: RunStatus | null;
}

export interface NewRunLine {
  contractor_id: string;
  amount_usd_cents: number;
  invoice_ref: string;
}

export interface NewRun {
  period_start: string;
  period_end: string;
  lines: NewRunLine[];
  idempotency_key: string;
}

export interface FundRequest {
  origin_chain?: string;
  refund_address?: string;
}

export interface RunLogEvent {
  id?: number | string;
  at: string;
  message: string;
}

export interface StatementLine {
  /** "out" = paid from the account, "in" = received by it. */
  direction?: "in" | "out";
  date: string;
  block_time: string | null;
  height: number | null;
  txid: string;
  amount_zat: number;
  usd_basis_cents: number;
  rate_usd_per_zec_e6: number;
  run_id: string;
  period: string;
  invoice_ref: string;
  running_zat: number;
  running_usd_cents: number;
  explorer_url: string | null;
  /** held: paid to the contractor's shielded address; converted: paid to a swap venue for USDC (memo on change). */
  settlement?: "held" | "converted";
  to_address?: string | null;
}

export interface UnlabelledLine {
  date: string;
  height: number | null;
  txid: string;
  direction: "in" | "out";
  amount_zat: number;
  memo_text: string | null;
  reason: "no_memo" | "unknown_prefix" | "malformed" | "non_text";
}

export interface FundingLine {
  date: string;
  height: number | null;
  txid: string;
  amount_zat: number;
  run_id: string | null;
  account?: string;
}

export interface RunRef {
  period_start: string;
  period_end: string;
  status: RunStatus;
}

export interface StatementPeriod {
  from: string;
  to: string;
}

export interface Statement {
  network: Network;
  account: {
    fingerprint: string;
    account_index: number | null;
    label: string | null;
    role?: "treasury" | "contractor" | "unknown";
  };
  period: StatementPeriod;
  scanned_to_height: number;
  generated_at: string;
  lines: StatementLine[];
  pending: StatementLine[];
  totals: { count: number; zat: number; usd_cents: number };
  unlabelled: UnlabelledLine[];
  funding: FundingLine[];
  /** Runs this service knows, keyed by run id. */
  runs?: Record<string, RunRef>;
}

export type ReconciliationStatus = "reconciled" | "variance_unexplained" | "missing_funding_record" | "incomplete";

export interface ReconciliationRun {
  run_id: string;
  period: string;
  funded_usd_cents: number | null;
  zec_acquired_zat: number | null;
  rate_usd_per_zec_e6: number | null;
  paid_usd_cents: number;
  paid_zat: number;
  lines: number;
  pending_lines?: number;
  network_fees_zat: number;
  unspent_zat: number;
  variance_usd_cents: number | null;
  explained_usd_cents: number | null;
  status: ReconciliationStatus;
}

export interface ReconciliationAccount {
  fingerprint: string;
  account_index: number | null;
  label: string | null;
  role: "treasury" | "contractor" | "unknown";
}

export type ReconciliationLine = StatementLine & {
  account_index: number | null;
  label: string | null;
};

export interface Reconciliation {
  network: Network;
  period: StatementPeriod;
  scanned_to_height: number;
  generated_at: string;
  accounts: ReconciliationAccount[];
  runs: ReconciliationRun[];
  lines: ReconciliationLine[];
  pending?: ReconciliationLine[];
  funding?: FundingLine[];
  unlabelled: UnlabelledLine[];
  /** False when the Treasury key was not supplied: funding cannot be reconciled. */
  treasury_key_present?: boolean;
  totals: {
    funded_usd_cents: number;
    paid_usd_cents: number;
    variance_usd_cents: number;
    paid_zat: number;
    count: number;
  };
}

/** Error raised for any failed call. `hint` always names the fix. */
export class ApiError extends Error {
  readonly code: string;
  readonly hint: string;
  readonly status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.hint = body.hint;
  }
}

export const UNREACHABLE_CODE = "service_unreachable";

function unreachable(): ApiError {
  const origin = typeof window === "undefined" ? "this web app's origin" : window.location.origin;
  return new ApiError(0, {
    code: UNREACHABLE_CODE,
    message: `Payslip service is not reachable at ${API_URL}.`,
    hint: `Start it with: cd service && cargo run. If it is already running, check that NEXT_PUBLIC_PAYSLIP_API_URL points at it and that the service's PAYSLIP_WEB_ORIGIN is set to ${origin}.`,
  });
}

function isErrorBody(value: unknown): value is { error: ApiErrorBody } {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const err = (value as { error: unknown }).error;
  return typeof err === "object" && err !== null && "code" in err && "message" in err;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (isErrorBody(body)) {
    return new ApiError(res.status, {
      code: body.error.code,
      message: body.error.message,
      hint: body.error.hint ?? "",
    });
  }
  return new ApiError(res.status, {
    code: `http_${res.status}`,
    message: `The service answered ${res.status} ${res.statusText || ""}`.trim() + ".",
    hint: "Check the service log for this request; the response did not include an error body.",
  });
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

async function send(path: string, { method = "GET", body, signal }: RequestOptions): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      signal,
      headers:
        body === undefined
          ? { Accept: "application/json" }
          : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw unreachable();
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

async function json<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await send(path, options);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function blob(path: string, options: RequestOptions = {}): Promise<{ blob: Blob; filename: string | null }> {
  const res = await send(path, options);
  const disposition = res.headers.get("Content-Disposition");
  const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return { blob: await res.blob(), filename: match ? decodeURIComponent(match[1]) : null };
}

const id = (value: string) => encodeURIComponent(value);

export const api = {
  health: (signal?: AbortSignal) => json<Health>("/api/health", { signal }),

  wallet: (signal?: AbortSignal) => json<Wallet>("/api/wallet", { signal }),
  syncWallet: () => json<Wallet>("/api/wallet/sync", { method: "POST" }),

  contractors: (signal?: AbortSignal) =>
    json<{ contractors: Contractor[] }>("/api/contractors", { signal }).then((r) => r.contractors),
  contractor: (contractorId: string, signal?: AbortSignal) =>
    json<Contractor>(`/api/contractors/${id(contractorId)}`, { signal }),
  createContractor: (input: NewContractor) => json<Contractor>("/api/contractors", { method: "POST", body: input }),
  updateContractor: (contractorId: string, input: Partial<NewContractor>) =>
    json<Contractor>(`/api/contractors/${id(contractorId)}`, { method: "PATCH", body: input }),
  archiveContractor: (contractorId: string) =>
    json<unknown>(`/api/contractors/${id(contractorId)}`, { method: "DELETE" }),
  contractorViewingKey: (contractorId: string, signal?: AbortSignal) =>
    json<ContractorViewingKey>(`/api/contractors/${id(contractorId)}/viewing-key`, { signal }),
  markViewingKeyShared: (contractorId: string) =>
    json<Contractor>(`/api/contractors/${id(contractorId)}/viewing-key/shared`, { method: "POST" }),
  viewingKeyExport: (signal?: AbortSignal) => json<ViewingKeyExport>("/api/viewing-keys", { signal }),

  runs: (signal?: AbortSignal) => json<{ runs: Run[] }>("/api/runs", { signal }).then((r) => r.runs),
  run: (runId: string, signal?: AbortSignal) => json<Run>(`/api/runs/${id(runId)}`, { signal }),
  createRun: (input: NewRun) => json<Run>("/api/runs", { method: "POST", body: input }),
  fundRun: (runId: string, input: FundRequest) =>
    json<Run>(`/api/runs/${id(runId)}/fund`, { method: "POST", body: input }),
  reportDepositTx: (runId: string, txHash: string) =>
    json<Run>(`/api/runs/${id(runId)}/funding/deposit-tx`, { method: "POST", body: { tx_hash: txHash } }),
  pollFunding: (runId: string, signal?: AbortSignal) => json<Run>(`/api/runs/${id(runId)}/funding`, { signal }),
  executeRun: (runId: string) => json<Run>(`/api/runs/${id(runId)}/execute`, { method: "POST" }),
  discardRun: (runId: string) => json<void>(`/api/runs/${id(runId)}`, { method: "DELETE" }),
  runLog: (runId: string, signal?: AbortSignal) =>
    json<{ events: RunLogEvent[] }>(`/api/runs/${id(runId)}/log`, { signal }).then((r) => r.events),
  runEventsUrl: (runId: string) => `${API_URL}/api/runs/${id(runId)}/events`,

  contractorStatement: (body: { ufvk: string; from: string; to: string }, signal?: AbortSignal) =>
    json<Statement>("/api/statements/contractor", { method: "POST", body, signal }),
  contractorStatementCsv: (body: { ufvk: string; from: string; to: string }) =>
    blob("/api/statements/contractor.csv", { method: "POST", body }),
  accountantStatement: (body: { ufvks: string[]; from: string; to: string }, signal?: AbortSignal) =>
    json<Reconciliation>("/api/statements/accountant", { method: "POST", body, signal }),
  accountantStatementCsv: (body: { ufvks: string[]; from: string; to: string }) =>
    blob("/api/statements/accountant.csv", { method: "POST", body }),
};

/** Normalise anything thrown by the client into an ApiError for display. */
export function toDisplayError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ApiError(0, {
    code: "client_error",
    message,
    hint: "Reload the page. If it happens again, check the browser console for details.",
  });
}
