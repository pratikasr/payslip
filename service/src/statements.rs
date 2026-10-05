//! Statement engine: turns outputs scanned with viewing keys into contractor statements and
//! the accountant's reconciliation. Pure functions; scanning lives in `viewer`.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::Serialize;
use time::{Date, OffsetDateTime};

use crate::{
    config::ZcashNetwork,
    memo::{self, Decoded, PayslipMemo},
    money,
    viewer::ScanOutput,
};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct KeyInfo {
    pub fingerprint: String,
    pub account_index: Option<u32>,
    pub label: Option<String>,
    /// treasury, contractor or unknown
    pub role: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Line {
    pub date: Option<String>,
    pub block_time: Option<String>,
    pub height: Option<u32>,
    pub txid: String,
    pub direction: &'static str,
    pub amount_zat: u64,
    pub usd_basis_cents: u64,
    pub rate_usd_per_zec_e6: u64,
    pub run_id: String,
    pub period: String,
    pub invoice_ref: String,
    pub running_zat: u64,
    pub running_usd_cents: u64,
    pub explorer_url: String,
    pub account: String,
    pub account_index: Option<u32>,
    pub label: Option<String>,
    /// held: ZEC to the contractor's shielded address; converted: ZEC to a swap venue's
    /// deposit address for conversion to USDC (ADR-018), memo on the change output.
    pub settlement: &'static str,
    pub to_address: Option<String>,
    /// Market value of the payment when it was mined, filled in by the API when prices are on.
    pub market: Option<crate::prices::MarketValue>,
    #[serde(skip)]
    pub fee_zat: Option<u64>,
    #[serde(skip)]
    pub sort_key: (u32, String, i64, i64),
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Unlabelled {
    pub date: Option<String>,
    pub height: Option<u32>,
    pub txid: String,
    pub direction: &'static str,
    pub amount_zat: u64,
    pub memo_text: Option<String>,
    pub reason: String,
    pub account: String,
    pub label: Option<String>,
    pub explorer_url: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct FundingIn {
    pub date: Option<String>,
    pub height: Option<u32>,
    pub txid: String,
    pub amount_zat: u64,
    pub run_id: String,
    pub account: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct RunFundingRecord {
    pub date: Option<String>,
    pub height: Option<u32>,
    pub txid: String,
    pub run_id: String,
    pub period: String,
    pub funded_usd_cents: u64,
    pub zec_acquired_zat: u64,
    pub rate_usd_per_zec_e6: u64,
    #[serde(skip)]
    pub fee_zat: Option<u64>,
}

/// One output of a run's allocation transaction as the treasury key sees it: what the payer
/// sent to one contractor account. `to_account` is the receiving account's fingerprint when its
/// key was scanned too, else None.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct AllocationOut {
    pub date: Option<String>,
    pub height: Option<u32>,
    pub txid: String,
    pub run_id: String,
    pub amount_zat: u64,
    pub to_account: Option<String>,
}

/// Every scanned output, classified.
#[derive(Clone, Debug, Default)]
pub struct Classified {
    pub lines: Vec<Line>,
    pub pending: Vec<Line>,
    pub unlabelled: Vec<Unlabelled>,
    pub funding: Vec<FundingIn>,
    pub run_records: Vec<RunFundingRecord>,
    /// Allocation outputs sent by a scanned account (the treasury), mined in the period or
    /// unmined.
    pub allocations: Vec<AllocationOut>,
}

/// A block time (Unix seconds) as RFC 3339 UTC, such as `2026-10-05T11:42:10Z`. A run's pay
/// lines show `confirmed_at` through this same function, so a payment's time is the same on the
/// run and on every statement.
pub fn block_time_rfc3339(unix: i64) -> Option<String> {
    OffsetDateTime::from_unix_timestamp(unix)
        .ok()?
        .format(&time::format_description::well_known::Rfc3339)
        .ok()
}

fn date_of(ts: Option<i64>) -> (Option<String>, Option<String>, Option<Date>) {
    match ts.and_then(|t| OffsetDateTime::from_unix_timestamp(t).ok()) {
        Some(dt) => {
            let d = dt.date();
            (
                Some(format!("{:04}-{:02}-{:02}", d.year(), u8::from(d.month()), d.day())),
                ts.and_then(block_time_rfc3339),
                Some(d),
            )
        }
        None => (None, None, None),
    }
}

/// A unified address in the ZIP 316 Revision 0 form (`utest1` / `u1`) with the same receivers,
/// as payment proofs show it (ADR-021); the wallet records Revision 2 (`zutest1` / `zu1`).
/// Anything that is not a unified address (a transparent venue deposit) is returned as is.
pub fn address_r0(network: ZcashNetwork, address: &str) -> String {
    use zcash_address::unified::{self, Container as _, Encoding as _};
    use zcash_protocol::consensus::Parameters;
    let Ok((net, _, ua)) = unified::Address::decode(address) else {
        return address.to_string();
    };
    if net != network.params().network_type() {
        return address.to_string();
    }
    let items: Vec<_> = ua
        .items()
        .into_iter()
        .filter(|r| !matches!(r, unified::Receiver::Unknown { .. }))
        .map(unified::Uitem::Data)
        .collect();
    unified::Address::try_from_items(unified::Revision::R0, items)
        .map(|r0| r0.encode(&net))
        .unwrap_or_else(|_| address.to_string())
}

/// Marks as `treasury` an unknown key that sent a run's allocation or holds its funding record
/// (PS1R): only the treasury key can. A statements-only service knows no key in advance.
pub fn infer_treasury(outputs: &[ScanOutput], keys: &mut [KeyInfo]) {
    for o in outputs {
        let treasury_memo = matches!(
            memo::decode_bytes(o.memo.as_deref()),
            Decoded::Payslip(PayslipMemo::RunFunding(_) | PayslipMemo::Allocation(_))
        );
        if let (true, Some(from)) = (treasury_memo, &o.from_account) {
            if let Some(k) = keys.iter_mut().find(|k| &k.fingerprint == from && k.role == "unknown") {
                k.role = "treasury".into();
            }
        }
    }
}

/// Neutralises spreadsheet formula injection in text that came from the chain.
pub fn csv_safe(s: &str) -> String {
    if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.to_string()
    }
}

/// Classifies outputs. `tip` decides which unmined transactions have expired; `period`
/// filters by block date (UTC, inclusive). Pending lines are never period-filtered.
pub fn classify(
    network: ZcashNetwork,
    outputs: &[ScanOutput],
    keys: &[KeyInfo],
    tip: u32,
    period: Option<(Date, Date)>,
) -> Classified {
    let by_fp: HashMap<&str, &KeyInfo> = keys.iter().map(|k| (k.fingerprint.as_str(), k)).collect();
    let label = |fp: &str| by_fp.get(fp).and_then(|k| k.label.clone());
    let index = |fp: &str| by_fp.get(fp).and_then(|k| k.account_index);
    let mut c = Classified::default();
    // Converting pay lines carry their PS1 memo on the funding account's change output, because
    // the venue deposit address is transparent. Index them by (txid, account).
    let mut converted: HashMap<(String, String), memo::PayLineMemo> = HashMap::new();
    for o in outputs {
        if o.is_change {
            if let (Some(acct), Decoded::Payslip(PayslipMemo::PayLine(m))) = (
                o.to_account.as_ref().or(o.from_account.as_ref()),
                memo::decode_bytes(o.memo.as_deref()),
            ) {
                converted.insert((o.txid.clone(), acct.clone()), m);
            }
        }
    }
    for o in outputs {
        let expired = o.mined_height.is_none() && o.expiry_height.is_some_and(|e| e != 0 && tip > e);
        if expired {
            continue;
        }
        let (date, block_time, day) = date_of(o.block_time);
        let in_period = match (period, day) {
            (None, _) => true,
            (Some((from, to)), Some(d)) => d >= from && d <= to,
            (Some(_), None) => o.mined_height.is_none(),
        };
        let mut decoded = memo::decode_bytes(o.memo.as_deref());
        let mut settlement = "held";
        if o.is_change && matches!(decoded, Decoded::Payslip(PayslipMemo::PayLine(_))) {
            continue;
        }
        if let (
            false,
            Some(from),
            Decoded::Unlabelled {
                reason: memo::UnlabelledReason::NoMemo,
                ..
            },
        ) = (o.is_change, &o.from_account, &decoded)
        {
            if let Some(m) = converted.get(&(o.txid.clone(), from.clone())) {
                decoded = Decoded::Payslip(PayslipMemo::PayLine(m.clone()));
                settlement = "converted";
            }
        }
        let explorer_url = network.explorer_tx_url(&o.txid);
        let direction: &'static str = if o.from_account.is_some() { "out" } else { "in" };
        let account = o
            .from_account
            .clone()
            .or_else(|| o.to_account.clone())
            .unwrap_or_default();

        if let Decoded::Payslip(PayslipMemo::RunFunding(r)) = &decoded {
            if in_period || o.mined_height.is_none() {
                c.run_records.push(RunFundingRecord {
                    date: date.clone(),
                    height: o.mined_height,
                    txid: o.txid.clone(),
                    run_id: r.run_id.to_string(),
                    period: r.period.to_string(),
                    funded_usd_cents: r.funded_usd_cents,
                    zec_acquired_zat: r.zec_acquired_zat,
                    rate_usd_per_zec_e6: r.rate_e6,
                    fee_zat: o.fee_zat,
                });
            }
            continue;
        }
        if o.is_change {
            continue;
        }
        if o.from_account.is_none() && o.to_account.is_none() {
            continue;
        }
        match decoded {
            // A pay line is a payment the scanned account made. One arriving into it was written
            // by whoever sent it (anyone who knows the account's address can), so it is listed,
            // never counted as pay.
            Decoded::Payslip(PayslipMemo::PayLine(m)) if direction == "in" => {
                if in_period || o.mined_height.is_none() {
                    c.unlabelled.push(Unlabelled {
                        date,
                        height: o.mined_height,
                        txid: o.txid.clone(),
                        direction,
                        amount_zat: o.value_zat,
                        memo_text: PayslipMemo::PayLine(m).encode().ok(),
                        reason: "unexpected_direction".into(),
                        label: label(&account),
                        account,
                        explorer_url,
                    });
                }
            }
            Decoded::Payslip(PayslipMemo::PayLine(m)) => {
                let line = Line {
                    date: date.clone(),
                    block_time,
                    height: o.mined_height,
                    txid: o.txid.clone(),
                    direction,
                    amount_zat: o.value_zat,
                    usd_basis_cents: m.usd_basis_cents,
                    rate_usd_per_zec_e6: m.rate_e6,
                    run_id: m.run_id.to_string(),
                    period: m.period.to_string(),
                    invoice_ref: m.invoice_ref.clone(),
                    running_zat: 0,
                    running_usd_cents: 0,
                    explorer_url,
                    label: label(&account),
                    account_index: index(&account),
                    account,
                    settlement,
                    to_address: o.to_address.as_deref().map(|a| address_r0(network, a)),
                    market: None,
                    fee_zat: o.fee_zat,
                    sort_key: (
                        o.mined_height.unwrap_or(u32::MAX),
                        o.txid.clone(),
                        o.pool,
                        o.output_index,
                    ),
                };
                if o.mined_height.is_none() {
                    c.pending.push(line);
                } else if in_period {
                    c.lines.push(line);
                }
            }
            Decoded::Payslip(PayslipMemo::Allocation(a)) => {
                // Sent by the treasury: one expected pay line for the run (reconciliation).
                if o.from_account.is_some() && (in_period || o.mined_height.is_none()) {
                    c.allocations.push(AllocationOut {
                        date: date.clone(),
                        height: o.mined_height,
                        txid: o.txid.clone(),
                        run_id: a.run_id.to_string(),
                        amount_zat: o.value_zat,
                        to_account: o.to_account.clone(),
                    });
                }
                // Treasury to contractor account: internal. The receiving side is funding.
                if let Some(to) = &o.to_account {
                    if in_period || o.mined_height.is_none() {
                        c.funding.push(FundingIn {
                            date,
                            height: o.mined_height,
                            txid: o.txid.clone(),
                            amount_zat: o.value_zat,
                            run_id: a.run_id.to_string(),
                            account: to.clone(),
                        });
                    }
                }
            }
            Decoded::Payslip(PayslipMemo::RunFunding(_)) => unreachable!("handled above"),
            Decoded::Unlabelled { reason, text } => {
                if in_period || o.mined_height.is_none() {
                    c.unlabelled.push(Unlabelled {
                        date,
                        height: o.mined_height,
                        txid: o.txid.clone(),
                        direction,
                        amount_zat: o.value_zat,
                        memo_text: text,
                        reason: reason.as_str().into(),
                        label: label(&account),
                        account,
                        explorer_url,
                    });
                }
            }
        }
    }
    c.lines.sort_by(|a, b| a.sort_key.cmp(&b.sort_key));
    let (mut z, mut u) = (0u64, 0u64);
    for l in c.lines.iter_mut() {
        z += l.amount_zat;
        u += l.usd_basis_cents;
        l.running_zat = z;
        l.running_usd_cents = u;
    }
    c
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Totals {
    pub count: usize,
    pub zat: u64,
    pub usd_cents: u64,
}

pub fn totals(lines: &[Line]) -> Totals {
    Totals {
        count: lines.len(),
        zat: lines.iter().map(|l| l.amount_zat).sum(),
        usd_cents: lines.iter().map(|l| l.usd_basis_cents).sum(),
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct RunReconciliation {
    pub run_id: String,
    pub period: String,
    /// Block date (UTC) of the run's funding record: the period the run is reconciled in.
    pub funding_date: Option<String>,
    pub funded_usd_cents: Option<u64>,
    pub zec_acquired_zat: Option<u64>,
    pub rate_usd_per_zec_e6: Option<u64>,
    pub paid_usd_cents: u64,
    pub paid_zat: u64,
    pub lines: usize,
    pub pending_lines: usize,
    /// Allocation outputs the treasury key shows for the run: one per pay line the payer funded.
    pub allocations: usize,
    pub allocated_zat: u64,
    /// Allocations to accounts whose viewing key was not supplied: their payments cannot be seen.
    pub missing_accounts: usize,
    /// ZEC allocated to those accounts.
    pub missing_zat: u64,
    /// Allocations to supplied accounts that show no payment for the run.
    pub unpaid_accounts: usize,
    pub network_fees_zat: u64,
    /// The run's ZEC the treasury kept: acquired minus what the allocation sent to contractor
    /// accounts and its fee, all read from the treasury's own transaction. None without the
    /// treasury key's view of the allocation.
    pub unspent_zat: Option<i64>,
    pub variance_usd_cents: Option<i64>,
    pub explained_usd_cents: Option<i64>,
    /// Variance minus explained: what rounding (or an error) leaves over. Shown, never hidden.
    pub difference_usd_cents: Option<i64>,
    /// The rounding allowance: each line's ZEC is rounded to the zatoshi, so up to one cent per
    /// line plus one for the funding record.
    pub rounding_tolerance_cents: i64,
    pub status: &'static str,
}

fn date_str(d: Date) -> String {
    format!("{:04}-{:02}-{:02}", d.year(), u8::from(d.month()), d.day())
}

/// Per-run reconciliation over `all`, the classification of the whole scanned history (no
/// period filter), so a run is judged on all of its payments wherever they fall. A run belongs
/// to the period its funding record was mined in (or, with no record visible, its first mined
/// output); runs still in progress belong to every period. `period` None includes every run.
///
/// Statuses, checked in this order:
/// - `missing_funding_record`: no run funding record (PS1R) is visible; the treasury key is
///   missing or the run never allocated.
/// - `incomplete`: the allocation or a payment is not mined yet.
/// - `incomplete_keys`: the treasury allocated to accounts whose viewing keys were not
///   supplied, so some payments cannot be seen.
/// - `unpaid`: an allocated account whose key was supplied shows no payment for the run.
/// - `variance_unexplained`: funded USD minus paid USD differs from the ZEC not paid out
///   (valued at the fill rate) by more than the rounding tolerance.
/// - `reconciled`: every allocation has its payment and the variance is explained.
pub fn reconcile(all: &Classified, period: Option<(Date, Date)>) -> Vec<RunReconciliation> {
    let mut run_ids: BTreeSet<String> = all.run_records.iter().map(|r| r.run_id.clone()).collect();
    run_ids.extend(all.lines.iter().map(|l| l.run_id.clone()));
    run_ids.extend(all.pending.iter().map(|l| l.run_id.clone()));
    run_ids.extend(all.allocations.iter().map(|a| a.run_id.clone()));
    let range = period.map(|(f, t)| (date_str(f), date_str(t)));
    let mut out = vec![];
    for run_id in run_ids {
        let record = all.run_records.iter().find(|r| r.run_id == run_id);
        let lines: Vec<&Line> = all
            .lines
            .iter()
            .filter(|l| l.run_id == run_id && l.direction == "out")
            .collect();
        let pending_lines: Vec<&Line> = all
            .pending
            .iter()
            .filter(|l| l.run_id == run_id && l.direction == "out")
            .collect();
        let allocations: Vec<&AllocationOut> = all.allocations.iter().filter(|a| a.run_id == run_id).collect();

        // Which period the run belongs to.
        let anchor: Option<Option<String>> = match record {
            Some(r) if r.height.is_some() => Some(r.date.clone()),
            Some(_) => None,
            None => {
                let mined = allocations
                    .iter()
                    .filter(|a| a.height.is_some())
                    .map(|a| a.date.clone())
                    .chain(lines.iter().map(|l| l.date.clone()))
                    .flatten()
                    .min();
                mined.map(Some)
            }
        };
        let in_range = match (&range, &anchor) {
            (None, _) => true,
            // In progress: shown in every period.
            (Some(_), None) => true,
            (Some((from, to)), Some(Some(d))) => d >= from && d <= to,
            // Mined but with no block time: never hidden.
            (Some(_), Some(None)) => true,
        };
        if !in_range {
            continue;
        }

        let paid_usd: u64 = lines.iter().map(|l| l.usd_basis_cents).sum();
        let paid_zat: u64 = lines.iter().map(|l| l.amount_zat).sum();
        let mut fee_txs: BTreeMap<&str, u64> = BTreeMap::new();
        for l in &lines {
            fee_txs.insert(&l.txid, l.fee_zat.unwrap_or(0));
        }
        if let Some(r) = record {
            fee_txs.insert(&r.txid, r.fee_zat.unwrap_or(0));
        }
        let fees: u64 = fee_txs.values().sum();
        let period = record
            .map(|r| r.period.clone())
            .or_else(|| lines.first().map(|l| l.period.clone()))
            .unwrap_or_default();
        let (funded, acquired, rate) = match record {
            Some(r) => (
                Some(r.funded_usd_cents),
                Some(r.zec_acquired_zat),
                Some(r.rate_usd_per_zec_e6),
            ),
            None => (None, None, None),
        };
        let allocated_zat: u64 = allocations.iter().map(|a| a.amount_zat).sum();
        // What the treasury kept, from its own allocation transaction: not inferred from the
        // payments that happen to be visible.
        let unspent = match (acquired, record) {
            (Some(a), Some(r)) if !allocations.is_empty() => {
                Some(a as i64 - allocated_zat as i64 - r.fee_zat.unwrap_or(0) as i64)
            }
            _ => None,
        };
        let variance = funded.map(|f| f as i64 - paid_usd as i64);
        let explained = match (acquired, rate) {
            (Some(a), Some(r)) => {
                let diff = a as i64 - paid_zat as i64;
                let cents = money::zat_to_usd_cents(diff.unsigned_abs(), r) as i64;
                Some(if diff < 0 { -cents } else { cents })
            }
            _ => None,
        };
        let tolerance = lines.len() as i64 + 1;
        let difference = match (variance, explained) {
            (Some(v), Some(e)) => Some(v - e),
            _ => None,
        };
        // Each allocation should have its payment, from the account it funded.
        let missing_accounts = allocations.iter().filter(|a| a.to_account.is_none()).count();
        let missing_zat: u64 = allocations
            .iter()
            .filter(|a| a.to_account.is_none())
            .map(|a| a.amount_zat)
            .sum();
        let unpaid_accounts = allocations
            .iter()
            .filter_map(|a| a.to_account.as_deref())
            .filter(|acct| !lines.iter().chain(pending_lines.iter()).any(|l| l.account == *acct))
            .count();
        let allocation_pending = allocations.iter().any(|a| a.height.is_none());
        let status = if record.is_none() {
            "missing_funding_record"
        } else if !pending_lines.is_empty() || allocation_pending || record.is_some_and(|r| r.height.is_none()) {
            "incomplete"
        } else if missing_accounts > 0 {
            "incomplete_keys"
        } else if unpaid_accounts > 0 {
            "unpaid"
        } else if difference.unwrap_or(0).abs() <= tolerance {
            "reconciled"
        } else {
            "variance_unexplained"
        };
        out.push(RunReconciliation {
            run_id,
            period,
            funding_date: record.and_then(|r| r.date.clone()),
            funded_usd_cents: funded,
            zec_acquired_zat: acquired,
            rate_usd_per_zec_e6: rate,
            paid_usd_cents: paid_usd,
            paid_zat,
            lines: lines.len(),
            pending_lines: pending_lines.len(),
            allocations: allocations.len(),
            allocated_zat,
            missing_accounts,
            missing_zat,
            unpaid_accounts,
            network_fees_zat: fees,
            unspent_zat: unspent,
            variance_usd_cents: variance,
            explained_usd_cents: explained,
            difference_usd_cents: difference,
            rounding_tolerance_cents: tolerance,
            status,
        });
    }
    out
}

/// A contractor CSV in `format`. On testnet the market value columns stay empty in every
/// format (Koinly's Net Worth falls back to the USD basis): testnet ZEC has no market value and
/// the statement screen hides it there (ADR-022).
pub fn contractor_export(c: &Classified, format: ExportFormat, network: ZcashNetwork) -> String {
    let stripped;
    let c = if network == ZcashNetwork::Testnet {
        let mut copy = c.clone();
        for l in copy.lines.iter_mut().chain(copy.pending.iter_mut()) {
            l.market = None;
        }
        stripped = copy;
        &stripped
    } else {
        c
    };
    match format {
        ExportFormat::Payslip => contractor_csv(c),
        f => contractor_tool_csv(c, f),
    }
}

pub fn contractor_csv(c: &Classified) -> String {
    let mut w = csv::WriterBuilder::new().flexible(true).from_writer(vec![]);
    let _ = w.write_record([
        "date",
        "block_time",
        "height",
        "txid",
        "amount_zec",
        "usd_basis",
        "rate_usd_per_zec",
        "run_id",
        "period",
        "invoice_ref",
        "running_zec",
        "running_usd",
        "market_value_at_receipt",
        "market_currency",
        "market_price_per_zec",
    ]);
    for l in &c.lines {
        let _ = w.write_record(contractor_record(l));
    }
    let _ = w.write_record(["# pending"]);
    for l in &c.pending {
        let _ = w.write_record(contractor_record(l));
    }
    write_unlabelled(&mut w, &c.unlabelled);
    String::from_utf8(w.into_inner().unwrap_or_default()).unwrap_or_default()
}

fn contractor_record(l: &Line) -> Vec<String> {
    let mut r = line_record(l);
    match &l.market {
        Some(m) => r.extend([
            money::format_usd(m.value_cents),
            m.currency.clone(),
            money::format_usd(m.price_cents),
        ]),
        None => r.extend([String::new(), String::new(), String::new()]),
    }
    r
}

fn line_record(l: &Line) -> Vec<String> {
    vec![
        l.date.clone().unwrap_or_default(),
        l.block_time.clone().unwrap_or_default(),
        l.height.map(|h| h.to_string()).unwrap_or_default(),
        l.txid.clone(),
        money::format_zec(l.amount_zat),
        money::format_usd(l.usd_basis_cents),
        money::format_rate(l.rate_usd_per_zec_e6),
        l.run_id.clone(),
        l.period.clone(),
        csv_safe(&l.invoice_ref),
        money::format_zec(l.running_zat),
        money::format_usd(l.running_usd_cents),
    ]
}

fn write_unlabelled(w: &mut csv::Writer<Vec<u8>>, items: &[Unlabelled]) {
    let _ = w.write_record(["# unlabelled"]);
    let _ = w.write_record([
        "date",
        "height",
        "txid",
        "direction",
        "amount_zec",
        "reason",
        "memo_text",
        "account",
    ]);
    for u in items {
        let _ = w.write_record([
            u.date.clone().unwrap_or_default(),
            u.height.map(|h| h.to_string()).unwrap_or_default(),
            u.txid.clone(),
            u.direction.to_string(),
            money::format_zec(u.amount_zat),
            u.reason.clone(),
            csv_safe(&u.memo_text.clone().unwrap_or_default()),
            csv_safe(&u.label.clone().unwrap_or_else(|| u.account.clone())),
        ]);
    }
}

pub fn accountant_csv(runs: &[RunReconciliation], c: &Classified) -> String {
    let mut w = csv::WriterBuilder::new().flexible(true).from_writer(vec![]);
    let _ = w.write_record(["# reconciliation"]);
    let _ = w.write_record([
        "run_id",
        "period",
        "funded_usd",
        "zec_acquired",
        "rate_usd_per_zec",
        "paid_usd",
        "paid_zec",
        "lines",
        "pending_lines",
        "allocations",
        "missing_accounts",
        "unpaid_accounts",
        "network_fees_zec",
        "unspent_zec",
        "variance_usd",
        "explained_usd",
        "difference_usd",
        "status",
    ]);
    let opt = |v: Option<String>| v.unwrap_or_default();
    for r in runs {
        let _ = w.write_record([
            r.run_id.clone(),
            r.period.clone(),
            opt(r.funded_usd_cents.map(money::format_usd)),
            opt(r.zec_acquired_zat.map(money::format_zec)),
            opt(r.rate_usd_per_zec_e6.map(money::format_rate)),
            money::format_usd(r.paid_usd_cents),
            money::format_zec(r.paid_zat),
            r.lines.to_string(),
            r.pending_lines.to_string(),
            r.allocations.to_string(),
            r.missing_accounts.to_string(),
            r.unpaid_accounts.to_string(),
            money::format_zec(r.network_fees_zat),
            opt(r.unspent_zat.map(|z| money::format_zec_signed(z as i128))),
            opt(r.variance_usd_cents.map(|v| money::format_usd_signed(v as i128))),
            opt(r.explained_usd_cents.map(|v| money::format_usd_signed(v as i128))),
            opt(r.difference_usd_cents.map(|v| money::format_usd_signed(v as i128))),
            r.status.to_string(),
        ]);
    }
    let _ = w.write_record(["# lines"]);
    let _ = w.write_record([
        "account",
        "date",
        "block_time",
        "height",
        "txid",
        "amount_zec",
        "usd_basis",
        "rate_usd_per_zec",
        "run_id",
        "period",
        "invoice_ref",
    ]);
    for l in c.lines.iter().chain(c.pending.iter()) {
        let _ = w.write_record([
            csv_safe(&l.label.clone().unwrap_or_else(|| l.account.clone())),
            l.date.clone().unwrap_or_default(),
            l.block_time.clone().unwrap_or_default(),
            l.height.map(|h| h.to_string()).unwrap_or_else(|| "pending".into()),
            l.txid.clone(),
            money::format_zec(l.amount_zat),
            money::format_usd(l.usd_basis_cents),
            money::format_rate(l.rate_usd_per_zec_e6),
            l.run_id.clone(),
            l.period.clone(),
            csv_safe(&l.invoice_ref),
        ]);
    }
    write_unlabelled(&mut w, &c.unlabelled);
    String::from_utf8(w.into_inner().unwrap_or_default()).unwrap_or_default()
}

/// Export formats for tax and bookkeeping tools (verified 5 Oct 2026, see Verified facts).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExportFormat {
    /// Payslip's own statement CSV (all sections).
    Payslip,
    /// Koinly universal template; income lines with USD net worth and the txid.
    Koinly,
    /// CoinTracker template; exact headers, UTC dates as MM/DD/YYYY HH:MM:SS.
    CoinTracker,
    /// Xero bank statement CSV for a "ZEC wallet (USD)" account: money out negative.
    Xero,
    /// QuickBooks Online bank upload, three columns: Date, Description, Amount.
    QuickBooks,
}

impl ExportFormat {
    pub fn parse(s: Option<&str>) -> Option<Self> {
        match s.unwrap_or("payslip") {
            "payslip" => Some(ExportFormat::Payslip),
            "koinly" => Some(ExportFormat::Koinly),
            "cointracker" => Some(ExportFormat::CoinTracker),
            "xero" => Some(ExportFormat::Xero),
            "quickbooks" => Some(ExportFormat::QuickBooks),
            _ => None,
        }
    }

    pub fn slug(&self) -> &'static str {
        match self {
            ExportFormat::Payslip => "payslip",
            ExportFormat::Koinly => "koinly",
            ExportFormat::CoinTracker => "cointracker",
            ExportFormat::Xero => "xero",
            ExportFormat::QuickBooks => "quickbooks",
        }
    }
}

fn utc(ts: Option<&str>) -> Option<OffsetDateTime> {
    ts.and_then(|t| OffsetDateTime::parse(t, &time::format_description::well_known::Rfc3339).ok())
}

fn fmt_ts(t: OffsetDateTime, pattern: &str) -> String {
    let d = t.date();
    let (y, m, day) = (d.year(), u8::from(d.month()), d.day());
    let (hh, mm, ss) = (t.hour(), t.minute(), t.second());
    match pattern {
        "iso" => format!("{y:04}-{m:02}-{day:02} {hh:02}:{mm:02}:{ss:02}"),
        "us" => format!("{m:02}/{day:02}/{y:04} {hh:02}:{mm:02}:{ss:02}"),
        _ => format!("{day:02}/{m:02}/{y:04}"),
    }
}

/// A contractor's income lines for Koinly or CoinTracker. Only mined payments are exported.
pub fn contractor_tool_csv(c: &Classified, format: ExportFormat) -> String {
    let mut w = csv::WriterBuilder::new().from_writer(vec![]);
    match format {
        ExportFormat::Koinly => {
            let _ = w.write_record([
                "Date",
                "Sent Amount",
                "Sent Currency",
                "Received Amount",
                "Received Currency",
                "Fee Amount",
                "Fee Currency",
                "Net Worth Amount",
                "Net Worth Currency",
                "Tag",
                "Description",
                "TxHash",
            ]);
            for l in &c.lines {
                let Some(t) = utc(l.block_time.as_deref()) else {
                    continue;
                };
                let _ = w.write_record([
                    fmt_ts(t, "iso"),
                    String::new(),
                    String::new(),
                    money::format_zec(l.amount_zat),
                    "ZEC".into(),
                    String::new(),
                    String::new(),
                    // Income at its market value when received, else the USD basis the payer
                    // wrote on chain.
                    l.market
                        .as_ref()
                        .map(|m| money::format_usd(m.value_cents))
                        .unwrap_or_else(|| money::format_usd(l.usd_basis_cents)),
                    l.market
                        .as_ref()
                        .map(|m| m.currency.clone())
                        .unwrap_or_else(|| "USD".into()),
                    "other income".into(),
                    csv_safe(&format!("Payslip {} invoice {}", l.period, l.invoice_ref)),
                    l.txid.clone(),
                ]);
            }
        }
        _ => {
            let _ = w.write_record([
                "Date",
                "Received Quantity",
                "Received Currency",
                "Sent Quantity",
                "Sent Currency",
                "Fee Amount",
                "Fee Currency",
                "Tag",
            ]);
            for l in &c.lines {
                let Some(t) = utc(l.block_time.as_deref()) else {
                    continue;
                };
                let _ = w.write_record([
                    fmt_ts(t, "us"),
                    money::format_zec(l.amount_zat),
                    "ZEC".into(),
                    String::new(),
                    String::new(),
                    String::new(),
                    String::new(),
                    "payment".into(),
                ]);
            }
        }
    }
    String::from_utf8(w.into_inner().unwrap_or_default()).unwrap_or_default()
}

/// The payer's books for Xero or QuickBooks, in USD (neither holds crypto): each run's funding
/// as money in and each pay line as money out, at the USD basis written on chain.
pub fn accountant_tool_csv(c: &Classified, format: ExportFormat) -> String {
    let mut rows: Vec<(OffsetDateTime, String, i64, String, String)> = vec![];
    for r in &c.run_records {
        let Some(t) = c
            .lines
            .iter()
            .filter(|l| l.run_id == r.run_id)
            .filter_map(|l| utc(l.block_time.as_deref()))
            .min()
            .or_else(|| r.date.as_deref().and_then(|d| utc(Some(&format!("{d}T00:00:00Z")))))
        else {
            continue;
        };
        rows.push((
            t,
            "Payslip treasury".into(),
            r.funded_usd_cents as i64,
            format!("Payroll funding {}", r.period),
            r.run_id.chars().take(8).collect(),
        ));
    }
    for l in &c.lines {
        let Some(t) = utc(l.block_time.as_deref()) else {
            continue;
        };
        rows.push((
            t,
            l.label.clone().unwrap_or_else(|| "Contractor".into()),
            -(l.usd_basis_cents as i64),
            format!("Payroll {} {}", l.period, l.invoice_ref),
            l.invoice_ref.clone(),
        ));
    }
    rows.sort_by_key(|r| r.0);
    let mut w = csv::WriterBuilder::new().from_writer(vec![]);
    if format == ExportFormat::Xero {
        let _ = w.write_record(["Date", "Amount", "Payee", "Description", "Reference"]);
        for (t, payee, cents, desc, reference) in rows {
            let _ = w.write_record([
                fmt_ts(t, "dmy"),
                money::format_usd_signed(cents as i128),
                csv_safe(&payee),
                csv_safe(&desc),
                csv_safe(&reference),
            ]);
        }
    } else {
        let _ = w.write_record(["Date", "Description", "Amount"]);
        for (t, payee, cents, desc, _) in rows {
            let _ = w.write_record([
                fmt_ts(t, "dmy"),
                csv_safe(&format!("{payee}: {desc}")),
                money::format_usd_signed(cents as i128),
            ]);
        }
    }
    String::from_utf8(w.into_inner().unwrap_or_default()).unwrap_or_default()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::memo::{AllocationMemo, PayLineMemo, Period, RunFundingMemo};
    use uuid::Uuid;

    pub const RUN: &str = "6f1c2d3e-4a5b-4c6d-8e7f-901234567890";
    const RATE: u64 = 1_354_930_000;
    // 2026-10-05T11:42:10Z
    const T0: i64 = 1_791_200_530;

    fn memo_bytes(m: PayslipMemo) -> Option<Vec<u8>> {
        Some(memo::to_memo_bytes(&m.encode().unwrap()).unwrap().as_slice().to_vec())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn out(
        txid: &str,
        h: Option<u32>,
        t: i64,
        from: Option<&str>,
        to: Option<&str>,
        zat: u64,
        change: bool,
        memo: Option<Vec<u8>>,
    ) -> ScanOutput {
        ScanOutput {
            txid: txid.into(),
            mined_height: h,
            block_time: h.map(|_| t),
            expiry_height: Some(h.unwrap_or(100) + 40),
            pool: 4,
            output_index: 0,
            from_account: from.map(String::from),
            to_account: to.map(String::from),
            to_address: None,
            value_zat: zat,
            is_change: change,
            memo,
            fee_zat: Some(10_000),
        }
    }

    pub fn pay(usd: u64, inv: &str) -> PayslipMemo {
        PayslipMemo::PayLine(PayLineMemo {
            run_id: Uuid::parse_str(RUN).unwrap(),
            period: Period::new(2026, 9).unwrap(),
            invoice_ref: inv.into(),
            usd_basis_cents: usd,
            rate_e6: RATE,
        })
    }

    fn keys() -> Vec<KeyInfo> {
        vec![
            KeyInfo {
                fingerprint: "treasury".into(),
                account_index: Some(0),
                label: Some("Treasury".into()),
                role: "treasury".into(),
            },
            KeyInfo {
                fingerprint: "a1".into(),
                account_index: Some(1),
                label: Some("Amara".into()),
                role: "contractor".into(),
            },
            KeyInfo {
                fingerprint: "a2".into(),
                account_index: Some(2),
                label: Some("Bo".into()),
                role: "contractor".into(),
            },
        ]
    }

    /// A complete run as the accountant sees it: allocation with a funding record, two payments.
    pub fn accountant_outputs() -> Vec<ScanOutput> {
        let z1 = money::usd_cents_to_zat(480_000, RATE).unwrap();
        let z2 = money::usd_cents_to_zat(325_050, RATE).unwrap();
        let funded = 805_300u64;
        let acquired = money::usd_cents_to_zat(funded, RATE).unwrap();
        let alloc = PayslipMemo::Allocation(AllocationMemo {
            run_id: Uuid::parse_str(RUN).unwrap(),
        });
        let record = PayslipMemo::RunFunding(RunFundingMemo {
            run_id: Uuid::parse_str(RUN).unwrap(),
            period: Period::new(2026, 9).unwrap(),
            funded_usd_cents: funded,
            zec_acquired_zat: acquired,
            rate_e6: RATE,
        });
        vec![
            out(
                "aa",
                Some(100),
                T0,
                Some("treasury"),
                Some("a1"),
                z1 + 10_000,
                false,
                memo_bytes(alloc.clone()),
            ),
            out(
                "aa",
                Some(100),
                T0,
                Some("treasury"),
                Some("a2"),
                z2 + 10_000,
                false,
                memo_bytes(alloc),
            ),
            out(
                "aa",
                Some(100),
                T0,
                Some("treasury"),
                Some("treasury"),
                5_000_000,
                true,
                memo_bytes(record),
            ),
            out(
                "b1",
                Some(102),
                T0 + 60,
                Some("a1"),
                None,
                z1,
                false,
                memo_bytes(pay(480_000, "INV-14")),
            ),
            out(
                "b2",
                Some(103),
                T0 + 90,
                Some("a2"),
                None,
                z2,
                false,
                memo_bytes(pay(325_050, "INV-7")),
            ),
        ]
    }

    #[test]
    fn contractor_statement_has_only_their_lines_with_running_totals() {
        let z1 = money::usd_cents_to_zat(480_000, RATE).unwrap();
        let outputs = vec![
            out(
                "aa",
                Some(100),
                T0,
                None,
                Some("a1"),
                z1 + 10_000,
                false,
                memo_bytes(PayslipMemo::Allocation(AllocationMemo {
                    run_id: Uuid::parse_str(RUN).unwrap(),
                })),
            ),
            out(
                "b1",
                Some(102),
                T0 + 60,
                Some("a1"),
                None,
                z1,
                false,
                memo_bytes(pay(480_000, "INV-14")),
            ),
            out(
                "b3",
                Some(150),
                T0 + 86_400 * 3,
                Some("a1"),
                None,
                z1,
                false,
                memo_bytes(pay(480_000, "INV-15")),
            ),
        ];
        let c = classify(ZcashNetwork::Testnet, &outputs, &keys(), 200, None);
        assert_eq!(c.lines.len(), 2);
        assert_eq!(c.funding.len(), 1);
        assert!(c.unlabelled.is_empty());
        assert_eq!(c.lines[1].running_usd_cents, 960_000);
        assert_eq!(c.lines[1].running_zat, 2 * z1);
        assert_eq!(c.lines[0].invoice_ref, "INV-14");
        assert_eq!(c.lines[0].label.as_deref(), Some("Amara"));
        assert_eq!(c.lines[0].date.as_deref(), Some("2026-10-05"));
        assert_eq!(
            totals(&c.lines),
            Totals {
                count: 2,
                zat: 2 * z1,
                usd_cents: 960_000
            }
        );
    }

    #[test]
    fn unlabelled_lines_are_listed_never_dropped() {
        let outputs = vec![
            out("c1", Some(110), T0, None, Some("a1"), 777, false, None),
            out(
                "c2",
                Some(111),
                T0,
                None,
                Some("a1"),
                888,
                false,
                memo_bytes_text("hello"),
            ),
            out(
                "c3",
                Some(112),
                T0,
                Some("a1"),
                None,
                999,
                false,
                memo_bytes_text("PS1|broken"),
            ),
        ];
        let c = classify(ZcashNetwork::Testnet, &outputs, &keys(), 200, None);
        assert!(c.lines.is_empty());
        let reasons: Vec<&str> = c.unlabelled.iter().map(|u| u.reason.as_str()).collect();
        assert_eq!(reasons, vec!["no_memo", "unknown_prefix", "malformed"]);
        assert_eq!(c.unlabelled[2].direction, "out");
    }

    fn memo_bytes_text(t: &str) -> Option<Vec<u8>> {
        Some(memo::to_memo_bytes(t).unwrap().as_slice().to_vec())
    }

    #[test]
    fn period_boundaries_are_inclusive_utc_dates() {
        // 2026-09-30T23:59:59Z and 2026-10-01T00:00:00Z
        let last = 1_790_812_799;
        let first = last + 1;
        let outputs = vec![
            out(
                "p1",
                Some(100),
                last,
                Some("a1"),
                None,
                1,
                false,
                memo_bytes(pay(100, "A")),
            ),
            out(
                "p2",
                Some(101),
                first,
                Some("a1"),
                None,
                2,
                false,
                memo_bytes(pay(200, "B")),
            ),
        ];
        let sep = (
            Date::from_calendar_date(2026, time::Month::September, 1).unwrap(),
            Date::from_calendar_date(2026, time::Month::September, 30).unwrap(),
        );
        let c = classify(ZcashNetwork::Testnet, &outputs, &keys(), 200, Some(sep));
        assert_eq!(
            c.lines.iter().map(|l| l.invoice_ref.as_str()).collect::<Vec<_>>(),
            vec!["A"]
        );
        let oct = (
            Date::from_calendar_date(2026, time::Month::October, 1).unwrap(),
            Date::from_calendar_date(2026, time::Month::October, 31).unwrap(),
        );
        let c = classify(ZcashNetwork::Testnet, &outputs, &keys(), 200, Some(oct));
        assert_eq!(
            c.lines.iter().map(|l| l.invoice_ref.as_str()).collect::<Vec<_>>(),
            vec!["B"]
        );
    }

    #[test]
    fn unmined_lines_are_pending_and_expired_ones_vanish() {
        let mut pending = out("q1", None, 0, Some("a1"), None, 5, false, memo_bytes(pay(100, "P")));
        pending.expiry_height = Some(300);
        let mut expired = out("q2", None, 0, Some("a1"), None, 5, false, memo_bytes(pay(100, "X")));
        expired.expiry_height = Some(150);
        let c = classify(ZcashNetwork::Testnet, &[pending, expired], &keys(), 200, None);
        assert!(c.lines.is_empty());
        assert_eq!(c.pending.len(), 1);
        assert_eq!(c.pending[0].invoice_ref, "P");
    }

    #[test]
    fn reconciliation_variance_equals_unpaid_zec_at_fill_rate() {
        let c = classify(ZcashNetwork::Testnet, &accountant_outputs(), &keys(), 200, None);
        assert_eq!(c.lines.len(), 2);
        let r = reconcile(&c, None);
        assert_eq!(r.len(), 1);
        let r = &r[0];
        assert_eq!(r.paid_usd_cents, 805_050);
        assert_eq!(r.variance_usd_cents, Some(250));
        assert_eq!(
            r.difference_usd_cents,
            Some(r.variance_usd_cents.unwrap() - r.explained_usd_cents.unwrap())
        );
        assert_eq!(r.rounding_tolerance_cents, 3);
        assert!(
            r.difference_usd_cents.unwrap().abs() <= r.rounding_tolerance_cents,
            "{r:?}"
        );
        assert_eq!(r.status, "reconciled");
        assert_eq!(r.network_fees_zat, 30_000);
    }

    #[test]
    fn missing_funding_record_and_pending_lines_are_flagged() {
        let mut outputs = accountant_outputs();
        outputs.remove(2);
        let r = reconcile(&classify(ZcashNetwork::Testnet, &outputs, &keys(), 200, None), None);
        assert_eq!(r[0].status, "missing_funding_record");
        let mut outputs = accountant_outputs();
        outputs[4].mined_height = None;
        outputs[4].block_time = None;
        let r = reconcile(&classify(ZcashNetwork::Testnet, &outputs, &keys(), 120, None), None);
        assert_eq!(r[0].status, "incomplete");
        assert_eq!(r[0].pending_lines, 1);
    }

    #[test]
    fn overpayment_is_an_unexplained_variance() {
        let mut outputs = accountant_outputs();
        // A third payment that claims the same run but was never funded.
        outputs.push(out(
            "b9",
            Some(104),
            T0 + 120,
            Some("a2"),
            None,
            50_000_000,
            false,
            memo_bytes(pay(100_000, "INV-X")),
        ));
        let r = reconcile(&classify(ZcashNetwork::Testnet, &outputs, &keys(), 200, None), None);
        assert_eq!(r[0].status, "variance_unexplained");
    }

    #[test]
    fn converted_line_pairs_the_venue_deposit_with_the_memo_on_change() {
        // Account a1 pays 0.002 ZEC to a transparent venue deposit; its change carries the memo.
        let mut deposit = out("cv", Some(120), T0, Some("a1"), None, 200_000, false, None);
        deposit.pool = 0;
        deposit.to_address = Some("t1JjCEbkvYSfZvQLM1P8C6eXtQLawVox9PR".into());
        let change = out(
            "cv",
            Some(120),
            T0,
            Some("a1"),
            Some("a1"),
            10_000,
            true,
            memo_bytes(pay(270, "CONV-1")),
        );
        // An unrelated transparent payment with no memo stays unlabelled.
        let mut stray = out("zz", Some(121), T0, Some("a1"), None, 5_000, false, None);
        stray.pool = 0;
        // With the treasury key also scanned, the testnet stand-in deposit belongs to a known account.
        let mut deposit_known = deposit.clone();
        deposit_known.to_account = Some("treasury".into());
        let c2 = classify(
            ZcashNetwork::Testnet,
            &[deposit_known, change.clone()],
            &keys(),
            200,
            None,
        );
        assert_eq!(c2.lines.len(), 1, "{c2:?}");
        assert!(c2.unlabelled.is_empty());
        let c = classify(ZcashNetwork::Testnet, &[deposit, change, stray], &keys(), 200, None);
        assert_eq!(c.lines.len(), 1, "{c:?}");
        let l = &c.lines[0];
        assert_eq!(
            (l.settlement, l.amount_zat, l.invoice_ref.as_str()),
            ("converted", 200_000, "CONV-1")
        );
        assert_eq!(l.to_address.as_deref(), Some("t1JjCEbkvYSfZvQLM1P8C6eXtQLawVox9PR"));
        assert_eq!(c.unlabelled.len(), 1);
        assert_eq!(c.unlabelled[0].txid, "zz");
    }

    #[test]
    fn tool_exports_use_each_tools_exact_layout() {
        let c = classify(ZcashNetwork::Testnet, &accountant_outputs(), &keys(), 200, None);
        let koinly = contractor_tool_csv(&c, ExportFormat::Koinly);
        let mut lines = koinly.lines();
        assert_eq!(
            lines.next().unwrap(),
            "Date,Sent Amount,Sent Currency,Received Amount,Received Currency,Fee Amount,Fee Currency,Net Worth Amount,Net Worth Currency,Tag,Description,TxHash"
        );
        let first = lines.next().unwrap();
        assert!(first.starts_with("2026-10-05 11:43:10,,,"), "{first}");
        assert!(first.contains(",ZEC,,,4800.00,USD,other income,"), "{first}");
        let ct = contractor_tool_csv(&c, ExportFormat::CoinTracker);
        let mut lines = ct.lines();
        assert_eq!(
            lines.next().unwrap(),
            "Date,Received Quantity,Received Currency,Sent Quantity,Sent Currency,Fee Amount,Fee Currency,Tag"
        );
        assert!(lines.next().unwrap().starts_with("10/05/2026 11:43:10,"));
        let xero = accountant_tool_csv(&c, ExportFormat::Xero);
        let mut lines = xero.lines();
        assert_eq!(lines.next().unwrap(), "Date,Amount,Payee,Description,Reference");
        assert_eq!(
            lines.next().unwrap(),
            "05/10/2026,8053.00,Payslip treasury,Payroll funding 2026-09,6f1c2d3e"
        );
        assert_eq!(
            lines.next().unwrap(),
            "05/10/2026,-4800.00,Amara,Payroll 2026-09 INV-14,INV-14"
        );
        let qb = accountant_tool_csv(&c, ExportFormat::QuickBooks);
        assert_eq!(qb.lines().next().unwrap(), "Date,Description,Amount");
        assert!(
            qb.lines().all(|l| l.split(',').count() == 3),
            "QuickBooks needs exactly three columns"
        );
        assert_eq!(ExportFormat::parse(Some("excel")), None);
    }

    /// The accountant pasted the treasury key and Amara's key but not Bo's: the treasury shows
    /// two allocations, one payment is visible. Audit SL-03.
    #[test]
    fn a_missing_contractor_key_is_flagged_not_reconciled() {
        let mut outputs = accountant_outputs();
        outputs[1].to_account = None; // the allocation to Bo, whose key is missing
        outputs.remove(4); // Bo's payment, invisible without his key
        let mut k = keys();
        k.pop();
        let r = reconcile(&classify(ZcashNetwork::Testnet, &outputs, &k, 200, None), None);
        assert_eq!(r[0].status, "incomplete_keys", "{r:?}");
        assert_eq!((r[0].allocations, r[0].missing_accounts, r[0].lines), (2, 1, 1));
        // Bo's allocation is reported, not booked as unspent: the treasury kept the same
        // amount whichever keys are loaded.
        let full = reconcile(
            &classify(ZcashNetwork::Testnet, &accountant_outputs(), &keys(), 200, None),
            None,
        );
        assert_eq!(r[0].unspent_zat, full[0].unspent_zat);
        assert_eq!(
            r[0].missing_zat,
            money::usd_cents_to_zat(325_050, RATE).unwrap() + 10_000
        );
    }

    /// Bo's key is supplied, the treasury allocated to him, but he shows no payment. SL-03.
    #[test]
    fn an_allocation_without_a_payment_is_unpaid() {
        let mut outputs = accountant_outputs();
        outputs.remove(4);
        let r = reconcile(&classify(ZcashNetwork::Testnet, &outputs, &keys(), 200, None), None);
        assert_eq!(r[0].status, "unpaid", "{r:?}");
        assert_eq!(r[0].unpaid_accounts, 1);
        // With every payment the same run reconciles, and says how many it expected.
        let r = reconcile(
            &classify(ZcashNetwork::Testnet, &accountant_outputs(), &keys(), 200, None),
            None,
        );
        assert_eq!(
            (r[0].status, r[0].allocations, r[0].unpaid_accounts),
            ("reconciled", 2, 0)
        );
        assert_eq!(r[0].allocated_zat, r[0].paid_zat + 20_000);
    }

    /// A run funded at 23:58 on 30 Sep and paid after midnight belongs to September, with both
    /// payments; October does not list it again. SL-03.
    #[test]
    fn a_run_is_reconciled_whole_in_the_period_of_its_funding_record() {
        let sep30 = 1_790_812_680; // 2026-09-30T23:58:00Z
        let mut outputs = accountant_outputs();
        for o in outputs.iter_mut().take(3) {
            o.block_time = Some(sep30);
        }
        outputs[3].block_time = Some(sep30 + 180);
        outputs[4].block_time = Some(sep30 + 240);
        let all = classify(ZcashNetwork::Testnet, &outputs, &keys(), 200, None);
        let month = |m: time::Month, last: u8| {
            (
                Date::from_calendar_date(2026, m, 1).unwrap(),
                Date::from_calendar_date(2026, m, last).unwrap(),
            )
        };
        let sep = reconcile(&all, Some(month(time::Month::September, 30)));
        assert_eq!(sep.len(), 1);
        assert_eq!((sep[0].status, sep[0].lines), ("reconciled", 2));
        assert_eq!(sep[0].funding_date.as_deref(), Some("2026-09-30"));
        assert!(reconcile(&all, Some(month(time::Month::October, 31))).is_empty());
    }

    /// Anyone who knows a contractor account's address can send it a PS1 memo; an inbound one
    /// is listed as unlabelled, never counted as pay. Audit SL-18.
    #[test]
    fn an_inbound_pay_line_memo_is_not_income() {
        let mut outputs = accountant_outputs();
        outputs.push(out(
            "ff",
            Some(150),
            T0 + 999,
            None,
            Some("a1"),
            1,
            false,
            memo_bytes(pay(99_999_900, "FAKE")),
        ));
        let c = classify(ZcashNetwork::Testnet, &outputs, &keys(), 200, None);
        assert!(c.lines.iter().all(|l| l.direction == "out"));
        assert_eq!(totals(&c.lines).usd_cents, 805_050);
        let u = c.unlabelled.iter().find(|u| u.txid == "ff").unwrap();
        assert_eq!(u.reason, "unexpected_direction");
        assert!(u.memo_text.as_deref().unwrap().contains("FAKE"));
        assert_eq!(reconcile(&c, None)[0].status, "reconciled");
    }

    /// Contractor names come from the payer's form; the unlabelled section escapes them. SL-21.
    #[test]
    fn unlabelled_account_labels_are_formula_safe() {
        let mut k = keys();
        k[1].label = Some("=HYPERLINK(\"https://evil.example\",\"Amara\")".into());
        let c = classify(
            ZcashNetwork::Testnet,
            &[out("c1", Some(110), T0, None, Some("a1"), 777, false, None)],
            &k,
            200,
            None,
        );
        let csv = accountant_csv(&reconcile(&c, None), &c);
        let row = csv.lines().find(|l| l.contains("c1")).unwrap();
        assert!(row.contains(",\"'=HYPERLINK"), "{row}");
    }

    /// Audit JD-02: in statements mode every key arrives as "unknown"; the one that holds the
    /// funding record and sent the allocations is recognised as the treasury key.
    #[test]
    fn the_treasury_key_is_recognised_from_its_records() {
        let mut k: Vec<KeyInfo> = keys()
            .into_iter()
            .map(|mut k| {
                k.role = "unknown".into();
                k.label = None;
                k
            })
            .collect();
        infer_treasury(&accountant_outputs(), &mut k);
        let roles: Vec<&str> = k.iter().map(|k| k.role.as_str()).collect();
        assert_eq!(roles, vec!["treasury", "unknown", "unknown"]);
        // A contractor key alone sees allocations arriving, not sent: it stays unknown.
        let mut only = vec![k[1].clone()];
        let inbound: Vec<ScanOutput> = accountant_outputs()
            .into_iter()
            .map(|mut o| {
                if o.from_account.as_deref() == Some("treasury") {
                    o.from_account = None;
                }
                o
            })
            .collect();
        infer_treasury(&inbound, &mut only);
        assert_eq!(only[0].role, "unknown");
    }

    /// Audit PBL-10: testnet CSVs carry no market value (testnet ZEC has none); mainnet keeps it.
    #[test]
    fn testnet_exports_leave_market_values_empty() {
        let mut c = classify(ZcashNetwork::Testnet, &accountant_outputs(), &keys(), 200, None);
        for l in c.lines.iter_mut() {
            l.market = Some(crate::prices::MarketValue {
                currency: "USD".into(),
                price_cents: 133_155,
                value_cents: 473,
                priced_at: "2026-10-05T11:40:00Z".into(),
                source: "coingecko",
            });
        }
        let koinly = contractor_export(&c, ExportFormat::Koinly, ZcashNetwork::Testnet);
        assert!(koinly.contains(",4800.00,USD,"), "{koinly}");
        assert!(!koinly.contains("4.73"));
        let own = contractor_export(&c, ExportFormat::Payslip, ZcashNetwork::Testnet);
        assert!(!own.contains("1331.55") && !own.contains("4.73"), "{own}");
        let mainnet = contractor_export(&c, ExportFormat::Koinly, ZcashNetwork::Mainnet);
        assert!(mainnet.contains(",4.73,USD,"), "{mainnet}");
    }

    /// Audit PBL-08: statement lines show the recipient in the Revision 0 form a payment proof
    /// shows, not the wallet's Revision 2 form.
    #[test]
    fn recipients_are_shown_in_revision_0() {
        use zcash_address::unified::{self, Encoding as _};
        let params = ZcashNetwork::Testnet.params();
        let sk = orchard::keys::SpendingKey::from_bytes([7; 32]).unwrap();
        let addr = orchard::keys::FullViewingKey::from(&sk).address_at(0u32, zip32::Scope::External);
        let r2 = unified::Address::try_from_items(
            unified::Revision::R2,
            vec![unified::Uitem::Data(unified::Receiver::Orchard(
                addr.to_raw_address_bytes(),
            ))],
        )
        .unwrap()
        .encode(&zcash_protocol::consensus::NetworkType::Test);
        assert!(r2.starts_with("zutest1"), "{r2}");
        let r0 = address_r0(ZcashNetwork::Testnet, &r2);
        assert_eq!(r0, crate::proof::recipient_address(&params, addr));
        assert!(r0.starts_with("utest1"));
        // Transparent addresses and junk pass through.
        assert_eq!(
            address_r0(ZcashNetwork::Testnet, "t1JjCEbkvYSfZvQLM1P8C6eXtQLawVox9PR"),
            "t1JjCEbkvYSfZvQLM1P8C6eXtQLawVox9PR"
        );
        let mut o = out(
            "r",
            Some(120),
            T0,
            Some("a1"),
            None,
            5,
            false,
            memo_bytes(pay(100, "R")),
        );
        o.to_address = Some(r2);
        let c = classify(ZcashNetwork::Testnet, &[o], &keys(), 200, None);
        assert_eq!(c.lines[0].to_address.as_deref(), Some(r0.as_str()));
    }

    #[test]
    fn csv_escapes_formulas_and_keeps_unlabelled_section() {
        assert_eq!(csv_safe("=HYPERLINK(1)"), "'=HYPERLINK(1)");
        assert_eq!(csv_safe("INV-1"), "INV-1");
        let outputs = vec![out(
            "c1",
            Some(110),
            T0,
            None,
            Some("a1"),
            777,
            false,
            memo_bytes_text("=cmd|' /C calc'!A0"),
        )];
        let c = classify(ZcashNetwork::Testnet, &outputs, &keys(), 200, None);
        let csv = contractor_csv(&c);
        assert!(csv.contains("# unlabelled"));
        assert!(csv.contains("'=cmd"));
    }
}
