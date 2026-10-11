/*
  Typed client for the Payslip service REST API. The shapes below follow
  docs/API.md field for field. Amounts are integers: ZEC in zatoshis, USD in
  cents, rates in USD per ZEC times 1,000,000.
*/

// A value of "/" means the page's own origin (API_URL becomes ""): a proxy in front of the web app
// sends /api/* to the service, so the browser never crosses origins (deploy/). The Next server
// cannot use a relative base; its reads go through PAYSLIP_API_INTERNAL_URL (lib/server-api.ts).
export const API_URL = (process.env.NEXT_PUBLIC_PAYSLIP_API_URL?.trim() || "http://127.0.0.1:8080").replace(/\/+$/, "");

/** The same-origin proxy that attaches the signed-in member's token (ADR-026). */
export const PROXY_BASE = "/api/svc";

/**
 * Where the browser sends service calls: through the proxy when sign-in is on (the root layout
 * sets the flag before hydration), else straight to the service as before.
 */
export function apiBase(): string {
  if (typeof window !== "undefined" && window.__payslipProxy) return PROXY_BASE;
  return API_URL;
}

/** Called when the service answers 401: the session is gone, so the console sends people to sign in. */
let onUnauthenticated: (() => void) | null = null;

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

export type Network = "mainnet" | "testnet";
/** `treasury`: Fund with ZEC (ADR-025), chosen per run with `method: "zec"`, on any network. */
export type VenueId = "near-intents-1click" | "maya" | "testnet-fixed-rate" | "treasury";

export interface ApiErrorBody {
  code: string;
  message: string;
  hint: string;
  /** The runs an error is about, earliest period first (409 period_overlap, idempotency_mismatch). */
  runs?: string[];
}

export interface Health {
  /** "degraded" when lightwalletd is unreachable or a warning exists; "syncing" while the wallet catches up. */
  status: "ok" | "degraded" | "syncing" | string;
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
  /** "statements": a deployment with no wallet, serving statements and payment proofs only. */
  mode?: "full" | "statements";
  /** Payslip's fee on the USDC to ZEC funding swap, in basis points (0 when none). */
  app_fee_bps?: number;
  /** Whether statements carry the market value of each payment at receipt. */
  market_prices?: boolean;
  /**
   * The testnet venue's fixed rate in USD per coin (1350000.0 by default): what payroll dollars
   * convert at on testnet. Not a price. Null on mainnet, with any other venue and in statements
   * mode; absent on older services.
   */
  simulated_rate_usd_per_zec?: number | string | null;
  /**
   * True when POST /api/runs/{id}/fund accepts method "zec" (ZEC sent to the treasury, funded
   * at the market rate when it confirms). False in statements mode; absent on older services.
   */
  fund_with_zec?: boolean;
  /** PAYSLIP_MAX_RUN_USD_CENTS: the largest payroll one run may carry; null when no cap. */
  max_run_usd_cents?: number | null;
  /** "required" when payer routes need a signed-in member (ADR-026); absent on older services. */
  auth?: "off" | "required";
}

/** The signed-in person and their membership (GET /api/me). */
export interface Me {
  auth: "required";
  user: { id: string; email: string; name: string | null; picture_url: string | null };
  membership: Membership | null;
}

export interface Organisation {
  id: string;
  name: string;
  logo_url: string | null;
  created_at: string;
}

export interface Membership {
  role: "admin" | "approver" | "accountant" | "viewer";
  org: Organisation;
  since: string;
}

export interface OrgMember {
  user_id: string;
  email: string;
  name: string | null;
  picture_url: string | null;
  role: Membership["role"];
  created_at: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Membership["role"];
  status: "pending" | "accepted" | "expired" | "revoked";
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  /** Only in the answer to the request that created it: the invite link's token. */
  token?: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  user: { id: string; email: string | null; name: string | null } | null;
  role: string;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
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
  /** The same key in the ZIP 316 Revision 0 form (uview...) that released wallets import. */
  ufvk_wallet?: string;
  birthday_height: number;
  network: Network;
}

export interface ViewingKeyExportEntry {
  label: string;
  role: "treasury" | "contractor";
  account_index: number;
  ufvk: string;
  ufvk_wallet?: string;
  contractor_id: string | null;
  /** Where this account's payments can start: a scan of the key need not look earlier. */
  birthday_height?: number;
}

export interface ViewingKeyExport {
  network: Network;
  birthday_height: number;
  keys: ViewingKeyExportEntry[];
}

/** `cancelled`: closed before any money reached it (services with POST /api/runs/{id}/cancel). */
export type RunStatus =
  | "draft"
  | "awaiting_funds"
  | "funded"
  | "swapping"
  | "swapped"
  | "allocating"
  | "paying"
  | "paid"
  | "failed"
  | "cancelled";

/**
 * `deposit_seen` and `incomplete` come from the 1Click venue; the rest from every venue. For
 * Fund with ZEC (venue `treasury`): `awaiting_deposit` (nothing in the treasury yet),
 * `deposit_seen` (ZEC arrived but is still confirming or short), `success` (confirmed and the
 * run is funded), `expired` (24 hours passed unfunded).
 */
export type FundingStatus =
  "awaiting_deposit" | "deposit_seen" | "processing" | "incomplete" | "success" | "refunded" | "failed" | "expired";

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
  /** The venue's quoted rate (USD per ZEC times 1e6), set when the quote is made. */
  quote_rate_e6?: number | null;
  venue_status?: string | null;
  /** Maya only: the router contract a token deposit goes through. */
  router?: string | null;
  /** Maya only: the memo the deposit must carry, or the swap is not made. */
  deposit_memo?: string | null;
  /** Fund with ZEC only: the treasury unified address to send ZEC to (also `deposit_address`). */
  treasury_address?: string | null;
  /** Fund with ZEC only: the ZEC asked for at request time (payroll at the rate, fee reserve, 2% buffer). */
  zec_required_zat?: number | null;
  /** Fund with ZEC only: confirmed ZEC available to this run at the last check. */
  zec_received_zat?: number | null;
  /** Fund with ZEC only: ZEC seen in the treasury but not yet confirmed. */
  zec_pending_zat?: number | null;
  /** Fund with ZEC only: what the run still needs at the current rate (0 once funded); null when the price could not be read. */
  zec_shortfall_zat?: number | null;
  /** Fund with ZEC only: the block at whose rate the run was funded. */
  funded_at_height?: number | null;
  /** Fund with ZEC only: when the price point behind the rate was taken. */
  priced_at?: string | null;
}

/** Funding that asks for an EVM deposit: the fields the browser wallet needs are present. */
export type EvmFunding = Funding & { chain_id: number; token_address: string; deposit_address: string };

export function isEvmFunding(f: Funding | null | undefined): f is EvmFunding {
  return !!f && typeof f.chain_id === "number" && !!f.token_address && !!f.deposit_address;
}

/** Fund with ZEC: the treasury address and the amount to send are present. */
export type ZecFunding = Funding & { venue: "treasury"; treasury_address: string; zec_required_zat: number };

export function isZecFunding(f: Funding | null | undefined): f is ZecFunding {
  return !!f && f.venue === "treasury" && !!f.treasury_address && typeof f.zec_required_zat === "number";
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
  /**
   * The block time of `confirmed_height` (RFC 3339 UTC): null until confirmed, and briefly null
   * beside a height for lines confirmed before the service recorded block times. Absent on older
   * services.
   */
  confirmed_at?: string | null;
  explorer_url: string | null;
  memo: string | null;
  error: ApiErrorBody | null;
  settlement_choice?: SettlementChoice;
  payout_chain?: string | null;
  /** Conversion to USDC for a convert_usdc line (ADR-018); null for lines that hold ZEC. */
  settlement?: Conversion | null;
  /** True when the contractor was archived after the run was created (newer services). */
  contractor_archived?: boolean;
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
  /**
   * Sent only when the payer ticked "This is an extra run for the same period". Newer services
   * answer 409 period_overlap without it when another run covers the period; older ones ignore it.
   */
  allow_overlap?: boolean;
}

export interface FundRequest {
  /**
   * "zec": ZEC sent to the treasury, funded at the market rate when it confirms (ADR-025).
   * "usdc" or absent: a USDC deposit swapped by the venue (on testnet, the fixed-rate venue).
   */
  method?: "zec" | "usdc";
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
  /** Market value when the payment was mined (CoinGecko price nearest the block time). */
  market?: MarketValue | null;
}

export interface MarketValue {
  /** ISO 4217, upper case. */
  currency: string;
  /** Price of one ZEC, in hundredths of the currency. */
  price_cents: number;
  /** Value of the payment, in hundredths of the currency. */
  value_cents: number;
  priced_at: string;
  source: string;
}

export interface StatementMarket {
  currency: string;
  available: boolean;
  total_cents?: number;
  priced_lines?: number;
  unpriced_lines?: number;
  source?: string;
  note?: string | null;
  error?: string;
}

export type ContractorExportFormat = "payslip" | "koinly" | "cointracker";

/**
 * `birthday_height`: where a scan of keys the service does not know starts (a key file's
 * birthday). Optional; JSON leaves it out when undefined, and older services ignore it.
 */
export interface ContractorStatementRequest {
  ufvk: string;
  from: string;
  to: string;
  currency?: string;
  birthday_height?: number;
}

export interface AccountantStatementRequest {
  ufvks: string[];
  from: string;
  to: string;
  birthday_height?: number;
}
export type AccountantExportFormat = "payslip" | "xero" | "quickbooks";

export type ProofMemo =
  | {
      kind: "pay_line";
      run_id: string;
      period: string;
      invoice_ref: string;
      usd_basis_cents: number;
      rate_usd_per_zec_e6: number;
      /** Always true: the memo is the sender's own claim, not checked against any payroll. */
      asserted_by_sender?: boolean;
    }
  | { kind: "text"; text: string }
  | { kind: "none" }
  | { kind: "payslip_internal" };

export interface CreatedProof {
  token: string;
  pool: "orchard" | "ironwood";
  action_index: number;
  amount_zat: number;
  recipient: string;
  memo: ProofMemo;
}

export interface ProofSet {
  network: Network;
  txid: string;
  height: number | null;
  /** False until the transaction is in a block; a proof of an unmined payment is not valid yet. */
  mined?: boolean;
  proofs: CreatedProof[];
}

export interface VerifiedProof {
  /** True when the output is real and its transaction is mined (ADR-024). */
  valid: boolean;
  mined?: boolean;
  network: Network;
  txid: string;
  explorer_url: string;
  height: number | null;
  confirmations: number | null;
  block_time: string | null;
  pool: "orchard" | "ironwood";
  amount_zat: number;
  recipient: string;
  /** Whether the expected address (if one was given) holds the receiver the note was paid to. */
  address_matches: boolean | null;
  /** False when the expected address could not be read; absent or null when none was given. */
  address_valid?: boolean | null;
  memo: ProofMemo;
  discloses: string;
  /** What a valid proof establishes, in the service's words. */
  proves?: string;
  /** What it does not establish (who sent it; the memo is the sender's claim). */
  does_not_prove?: string;
}

export interface UnlabelledLine {
  date: string;
  height: number | null;
  txid: string;
  direction: "in" | "out";
  amount_zat: number;
  memo_text: string | null;
  reason: "no_memo" | "unknown_prefix" | "malformed" | "non_text" | "unexpected_direction";
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
  /** The lowest height the scan started at: nothing earlier is in the statement. */
  scanned_from_height?: number | null;
  scanned_to_height: number;
  generated_at: string;
  lines: StatementLine[];
  pending: StatementLine[];
  totals: { count: number; zat: number; usd_cents: number };
  unlabelled: UnlabelledLine[];
  funding: FundingLine[];
  /** Runs this service knows, keyed by run id. */
  runs?: Record<string, RunRef>;
  market?: StatementMarket;
}

/**
 * `incomplete_keys`: the treasury allocated to accounts whose key was not supplied.
 * `unpaid`: an account that was allocated ZEC shows no payment for the run.
 */
export type ReconciliationStatus =
  "reconciled" | "variance_unexplained" | "missing_funding_record" | "incomplete" | "incomplete_keys" | "unpaid";

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
  /** Block date (UTC) of the run's funding record: the period the run is reconciled in. */
  funding_date?: string | null;
  /** Allocation outputs the treasury key shows for the run (one per funded pay line). */
  allocations?: number;
  allocated_zat?: number;
  /** Allocations to accounts whose viewing key was not supplied, and the ZEC they got. */
  missing_accounts?: number;
  missing_zat?: number;
  /** Allocations to supplied accounts that show no payment for the run. */
  unpaid_accounts?: number;
  network_fees_zat: number;
  /** ZEC the treasury kept from the run; null without the treasury key's view of the allocation. */
  unspent_zat: number | null;
  variance_usd_cents: number | null;
  explained_usd_cents: number | null;
  /** Variance minus explained; within rounding_tolerance_cents for a reconciled run. */
  difference_usd_cents?: number | null;
  /** One cent per pay line plus one: each line's ZEC is rounded to the zatoshi. */
  rounding_tolerance_cents?: number;
  status: ReconciliationStatus;
}

export interface ReconciliationAccount {
  fingerprint: string;
  account_index: number | null;
  label: string | null;
  role: "treasury" | "contractor" | "unknown";
  /** Where this key's scan started. */
  scanned_from_height?: number | null;
}

export type ReconciliationLine = StatementLine & {
  account_index: number | null;
  label: string | null;
};

export interface Reconciliation {
  network: Network;
  period: StatementPeriod;
  /** The lowest height any key was scanned from: nothing earlier is in the books. */
  scanned_from_height?: number | null;
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
  /** Run ids the error names (period_overlap, idempotency_mismatch); empty for other errors. */
  readonly runs: string[];

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.hint = body.hint;
    this.runs = body.runs ?? [];
  }
}

export const UNREACHABLE_CODE = "service_unreachable";

function unreachable(): ApiError {
  // Plain words for anyone (a contractor, an accountant, a payer). The setup details are in
  // serviceSetupHint(), which only the company console shows, to whoever runs the service.
  return new ApiError(0, {
    code: UNREACHABLE_CODE,
    message: "The Payslip service is not answering.",
    hint: "Try again in a moment.",
  });
}

/** For whoever runs Payslip: where the web app expects the service and what it must allow. */
export function serviceSetupHint(): string {
  const origin = typeof window === "undefined" ? "this web app's origin" : window.location.origin;
  return `Start it with: cd service && cargo run. If it is already running, check that NEXT_PUBLIC_PAYSLIP_API_URL points at it (now ${API_URL || "this origin"}) and that the service's PAYSLIP_WEB_ORIGIN includes ${origin}.`;
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
    const runs = (body.error as { runs?: unknown }).runs;
    return new ApiError(res.status, {
      code: body.error.code,
      message: body.error.message,
      hint: body.error.hint ?? "",
      runs: Array.isArray(runs) ? runs.filter((r): r is string => typeof r === "string") : undefined,
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
    res = await fetch(`${apiBase()}${path}`, {
      method,
      signal,
      // Every write is JSON, even with no body: the service refuses non-JSON writes so a
      // cross-site form post cannot reach it without a CORS preflight.
      headers:
        method === "GET"
          ? { Accept: "application/json" }
          : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw unreachable();
  }
  if (res.status === 401 && onUnauthenticated) onUnauthenticated();
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
  /**
   * Undoes Mark as shared: clears fvk_shared_at and answers the Contractor. Services from before
   * 5 Oct 2026 answer 404 or 405: the UI then stops offering Undo. A key already handed over
   * still works; this changes only the record.
   */
  unmarkViewingKeyShared: (contractorId: string) =>
    json<Contractor>(`/api/contractors/${id(contractorId)}/viewing-key/shared`, { method: "DELETE" }),
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
  /** Closes a run that received no money (status `cancelled`); 409 run_has_funds or deposit_in_progress otherwise. */
  cancelRun: (runId: string) => json<Run>(`/api/runs/${id(runId)}/cancel`, { method: "POST", body: {} }),
  runLog: (runId: string, signal?: AbortSignal) =>
    json<{ events: RunLogEvent[] }>(`/api/runs/${id(runId)}/log`, { signal }).then((r) => r.events),
  runEventsUrl: (runId: string) => `${apiBase()}/api/runs/${id(runId)}/events`,

  /** Who is signed in and their role; 404 when sign-in is off. */
  me: (signal?: AbortSignal) => json<Me>("/api/me", { signal }),
  org: (signal?: AbortSignal) => json<Organisation>("/api/org", { signal }),
  updateOrg: (input: { name?: string; logo_url?: string | null }) =>
    json<Organisation>("/api/org", { method: "PATCH", body: input }),
  members: (signal?: AbortSignal) =>
    json<{ members: OrgMember[] }>("/api/org/members", { signal }).then((r) => r.members),
  setMemberRole: (userId: string, role: Membership["role"]) =>
    json<OrgMember>("/api/org/members", { method: "POST", body: { user_id: userId, role } }),
  removeMember: (userId: string) => json<void>(`/api/org/members/${id(userId)}`, { method: "DELETE" }),
  invitations: (signal?: AbortSignal) =>
    json<{ invitations: Invitation[] }>("/api/org/invitations", { signal }).then((r) => r.invitations),
  invite: (email: string, role: Membership["role"]) =>
    json<Invitation>("/api/org/invitations", { method: "POST", body: { email, role } }),
  revokeInvitation: (invitationId: string) =>
    json<void>(`/api/org/invitations/${id(invitationId)}`, { method: "DELETE" }),
  acceptInvitation: (token: string) =>
    json<{ membership: Membership }>(`/api/org/invitations/${id(token)}/accept`, { method: "POST", body: {} }),
  audit: (opts: { limit?: number; before?: number } = {}, signal?: AbortSignal) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.before) q.set("before", String(opts.before));
    const qs = q.toString();
    return json<{ entries: AuditEntry[] }>(`/api/org/audit${qs ? `?${qs}` : ""}`, { signal }).then((r) => r.entries);
  },

  contractorStatement: (body: ContractorStatementRequest, signal?: AbortSignal) =>
    json<Statement>("/api/statements/contractor", { method: "POST", body, signal }),
  contractorStatementCsv: (body: ContractorStatementRequest, format: ContractorExportFormat = "payslip") =>
    blob(`/api/statements/contractor.csv?format=${format}`, { method: "POST", body }),
  accountantStatement: (body: AccountantStatementRequest, signal?: AbortSignal) =>
    json<Reconciliation>("/api/statements/accountant", { method: "POST", body, signal }),
  accountantStatementCsv: (body: AccountantStatementRequest, format: AccountantExportFormat = "payslip") =>
    blob(`/api/statements/accountant.csv?format=${format}`, { method: "POST", body }),

  /** Deletes the service's cached scan of exactly this key set; the next statement scans afresh. */
  forgetKeys: (ufvks: string[]) =>
    json<{ forgotten: boolean }>("/api/statements/forget", { method: "POST", body: { ufvks } }),
  createProof: (body: { ufvk: string; txid: string }) => json<ProofSet>("/api/proofs", { method: "POST", body }),
  verifyProof: (token: string, address?: string, signal?: AbortSignal) =>
    json<VerifiedProof>(`/api/proofs/${id(token)}${address ? `?address=${encodeURIComponent(address)}` : ""}`, {
      signal,
    }),
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
