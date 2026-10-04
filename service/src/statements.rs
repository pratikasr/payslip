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

/// Every scanned output, classified.
#[derive(Clone, Debug, Default)]
pub struct Classified {
    pub lines: Vec<Line>,
    pub pending: Vec<Line>,
    pub unlabelled: Vec<Unlabelled>,
    pub funding: Vec<FundingIn>,
    pub run_records: Vec<RunFundingRecord>,
}

fn date_of(ts: Option<i64>) -> (Option<String>, Option<String>, Option<Date>) {
    match ts.and_then(|t| OffsetDateTime::from_unix_timestamp(t).ok()) {
        Some(dt) => {
            let d = dt.date();
            (
                Some(format!("{:04}-{:02}-{:02}", d.year(), u8::from(d.month()), d.day())),
                dt.format(&time::format_description::well_known::Rfc3339).ok(),
                Some(d),
            )
        }
        None => (None, None, None),
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
        let decoded = memo::decode_bytes(o.memo.as_deref());
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
    pub funded_usd_cents: Option<u64>,
    pub zec_acquired_zat: Option<u64>,
    pub rate_usd_per_zec_e6: Option<u64>,
    pub paid_usd_cents: u64,
    pub paid_zat: u64,
    pub lines: usize,
    pub pending_lines: usize,
    pub network_fees_zat: u64,
    pub unspent_zat: Option<i64>,
    pub variance_usd_cents: Option<i64>,
    pub explained_usd_cents: Option<i64>,
    pub status: &'static str,
}

/// Per-run reconciliation: funded USD against paid USD. The variance must equal the ZEC
/// acquired but not paid out, valued at the run's fill rate, within one cent per line
/// (each line's ZEC amount is rounded to the zatoshi).
pub fn reconcile(c: &Classified) -> Vec<RunReconciliation> {
    let mut run_ids: BTreeSet<String> = c.run_records.iter().map(|r| r.run_id.clone()).collect();
    run_ids.extend(c.lines.iter().map(|l| l.run_id.clone()));
    run_ids.extend(c.pending.iter().map(|l| l.run_id.clone()));
    let mut out = vec![];
    for run_id in run_ids {
        let record = c.run_records.iter().find(|r| r.run_id == run_id);
        let lines: Vec<&Line> = c
            .lines
            .iter()
            .filter(|l| l.run_id == run_id && l.direction == "out")
            .collect();
        let pending = c
            .pending
            .iter()
            .filter(|l| l.run_id == run_id && l.direction == "out")
            .count();
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
        let unspent = acquired.map(|a| a as i64 - paid_zat as i64 - fees as i64);
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
        let status = if record.is_none() {
            "missing_funding_record"
        } else if pending > 0 {
            "incomplete"
        } else if (variance.unwrap_or(0) - explained.unwrap_or(0)).abs() <= tolerance {
            "reconciled"
        } else {
            "variance_unexplained"
        };
        out.push(RunReconciliation {
            run_id,
            period,
            funded_usd_cents: funded,
            zec_acquired_zat: acquired,
            rate_usd_per_zec_e6: rate,
            paid_usd_cents: paid_usd,
            paid_zat,
            lines: lines.len(),
            pending_lines: pending,
            network_fees_zat: fees,
            unspent_zat: unspent,
            variance_usd_cents: variance,
            explained_usd_cents: explained,
            status,
        });
    }
    out
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
    ]);
    for l in &c.lines {
        let _ = w.write_record(line_record(l));
    }
    let _ = w.write_record(["# pending"]);
    for l in &c.pending {
        let _ = w.write_record(line_record(l));
    }
    write_unlabelled(&mut w, &c.unlabelled);
    String::from_utf8(w.into_inner().unwrap_or_default()).unwrap_or_default()
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
            u.label.clone().unwrap_or_else(|| u.account.clone()),
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
        "network_fees_zec",
        "unspent_zec",
        "variance_usd",
        "explained_usd",
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
            money::format_zec(r.network_fees_zat),
            opt(r.unspent_zat.map(|z| money::format_zec_signed(z as i128))),
            opt(r.variance_usd_cents.map(|v| money::format_usd_signed(v as i128))),
            opt(r.explained_usd_cents.map(|v| money::format_usd_signed(v as i128))),
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
        let r = reconcile(&c);
        assert_eq!(r.len(), 1);
        let r = &r[0];
        assert_eq!(r.paid_usd_cents, 805_050);
        assert_eq!(r.variance_usd_cents, Some(250));
        assert!(
            (r.variance_usd_cents.unwrap() - r.explained_usd_cents.unwrap()).abs() <= 3,
            "{r:?}"
        );
        assert_eq!(r.status, "reconciled");
        assert_eq!(r.network_fees_zat, 30_000);
    }

    #[test]
    fn missing_funding_record_and_pending_lines_are_flagged() {
        let mut outputs = accountant_outputs();
        outputs.remove(2);
        let r = reconcile(&classify(ZcashNetwork::Testnet, &outputs, &keys(), 200, None));
        assert_eq!(r[0].status, "missing_funding_record");
        let mut outputs = accountant_outputs();
        outputs[4].mined_height = None;
        outputs[4].block_time = None;
        let r = reconcile(&classify(ZcashNetwork::Testnet, &outputs, &keys(), 120, None));
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
        let r = reconcile(&classify(ZcashNetwork::Testnet, &outputs, &keys(), 200, None));
        assert_eq!(r[0].status, "variance_unexplained");
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
