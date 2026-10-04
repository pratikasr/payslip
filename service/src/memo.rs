//! Payslip memo codec (ADR-008, record types extended by ADR-014).
//!
//! Every Payslip output carries an ASCII, pipe-separated, versioned memo:
//!
//! - `PS1|<run_id>|<YYYY-MM>|<invoice_ref>|<usd_basis_cents>|<rate_e6>`: a pay line, on the
//!   output from contractor account i to contractor i.
//! - `PS1A|<run_id>`: an allocation, on the output from the treasury to contractor account i
//!   that funds that account's pay line.
//! - `PS1R|<run_id>|<YYYY-MM>|<funded_usd_cents>|<zec_acquired_zat>|<rate_e6>`: the run's
//!   funding record, on the treasury change output of the allocation transaction. Only the
//!   treasury viewing key (held by the accountant) can read it.
//!
//! The encoded memo must fit the 512-byte Zcash memo field. Anything the decoder does not
//! recognise is reported as unlabelled with a reason; it is never dropped.

use std::fmt;

use uuid::Uuid;

/// Maximum memo length in bytes (ZIP 302).
pub const MAX_MEMO_BYTES: usize = 512;

/// Maximum invoice reference length. Keeps every record far inside the memo limit.
pub const MAX_INVOICE_REF_LEN: usize = 64;

const TAG_PAY_LINE: &str = "PS1";
const TAG_ALLOCATION: &str = "PS1A";
const TAG_RUN_FUNDING: &str = "PS1R";

/// A calendar month, the pay period written into a pay line memo.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Period {
    pub year: u16,
    pub month: u8,
}

impl Period {
    pub fn new(year: u16, month: u8) -> Option<Self> {
        ((2000..=9999).contains(&year) && (1..=12).contains(&month)).then_some(Period { year, month })
    }

    pub fn parse(s: &str) -> Option<Self> {
        let (y, m) = s.split_once('-')?;
        if y.len() != 4 || m.len() != 2 || !y.bytes().chain(m.bytes()).all(|b| b.is_ascii_digit()) {
            return None;
        }
        Period::new(y.parse().ok()?, m.parse().ok()?)
    }
}

impl fmt::Display for Period {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}-{:02}", self.year, self.month)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PayLineMemo {
    pub run_id: Uuid,
    pub period: Period,
    pub invoice_ref: String,
    pub usd_basis_cents: u64,
    pub rate_e6: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AllocationMemo {
    pub run_id: Uuid,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunFundingMemo {
    pub run_id: Uuid,
    pub period: Period,
    pub funded_usd_cents: u64,
    pub zec_acquired_zat: u64,
    pub rate_e6: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PayslipMemo {
    PayLine(PayLineMemo),
    Allocation(AllocationMemo),
    RunFunding(RunFundingMemo),
}

/// Why a memo was not recognised as a Payslip record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnlabelledReason {
    /// The output carries no memo, or an empty one.
    NoMemo,
    /// The memo is text, but not a Payslip record (or a future version this build cannot read).
    UnknownPrefix,
    /// The memo claims to be a Payslip record but its fields do not parse.
    Malformed,
    /// The memo is not UTF-8 text.
    NonText,
}

impl UnlabelledReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            UnlabelledReason::NoMemo => "no_memo",
            UnlabelledReason::UnknownPrefix => "unknown_prefix",
            UnlabelledReason::Malformed => "malformed",
            UnlabelledReason::NonText => "non_text",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decoded {
    Payslip(PayslipMemo),
    Unlabelled { reason: UnlabelledReason, text: Option<String> },
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum EncodeError {
    #[error("invoice reference is empty")]
    EmptyInvoiceRef,
    #[error("invoice reference is longer than {MAX_INVOICE_REF_LEN} characters")]
    InvoiceRefTooLong,
    #[error("invoice reference may only contain printable ASCII and no '|'")]
    InvoiceRefCharset,
    #[error("amount must be greater than zero")]
    ZeroAmount,
    #[error("encoded memo is {0} bytes, over the {MAX_MEMO_BYTES}-byte limit")]
    TooLong(usize),
}

/// Validates an invoice reference the same way the encoder does, for use at API boundaries.
pub fn validate_invoice_ref(s: &str) -> Result<(), EncodeError> {
    if s.is_empty() {
        return Err(EncodeError::EmptyInvoiceRef);
    }
    if s.len() > MAX_INVOICE_REF_LEN {
        return Err(EncodeError::InvoiceRefTooLong);
    }
    if !s.bytes().all(|b| (0x20..0x7f).contains(&b) && b != b'|') {
        return Err(EncodeError::InvoiceRefCharset);
    }
    Ok(())
}

fn check_len(s: String) -> Result<String, EncodeError> {
    if s.len() > MAX_MEMO_BYTES {
        Err(EncodeError::TooLong(s.len()))
    } else {
        Ok(s)
    }
}

impl PayslipMemo {
    pub fn encode(&self) -> Result<String, EncodeError> {
        match self {
            PayslipMemo::PayLine(m) => {
                validate_invoice_ref(&m.invoice_ref)?;
                if m.usd_basis_cents == 0 || m.rate_e6 == 0 {
                    return Err(EncodeError::ZeroAmount);
                }
                check_len(format!(
                    "{TAG_PAY_LINE}|{}|{}|{}|{}|{}",
                    m.run_id, m.period, m.invoice_ref, m.usd_basis_cents, m.rate_e6
                ))
            }
            PayslipMemo::Allocation(m) => check_len(format!("{TAG_ALLOCATION}|{}", m.run_id)),
            PayslipMemo::RunFunding(m) => {
                if m.funded_usd_cents == 0 || m.zec_acquired_zat == 0 || m.rate_e6 == 0 {
                    return Err(EncodeError::ZeroAmount);
                }
                check_len(format!(
                    "{TAG_RUN_FUNDING}|{}|{}|{}|{}|{}",
                    m.run_id, m.period, m.funded_usd_cents, m.zec_acquired_zat, m.rate_e6
                ))
            }
        }
    }
}

fn parse_positive(s: &str) -> Option<u64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) || (s.len() > 1 && s.starts_with('0')) {
        return None;
    }
    s.parse::<u64>().ok().filter(|v| *v > 0)
}

fn parse_uuid(s: &str) -> Option<Uuid> {
    // Only the canonical hyphenated lowercase form that the encoder writes.
    (s.len() == 36).then(|| Uuid::parse_str(s).ok()).flatten().filter(|u| u.to_string() == s)
}

fn decode_text(text: &str) -> Decoded {
    let malformed = || Decoded::Unlabelled {
        reason: UnlabelledReason::Malformed,
        text: Some(text.to_string()),
    };
    let fields: Vec<&str> = text.split('|').collect();
    match fields[0] {
        TAG_PAY_LINE => {
            if fields.len() != 6 {
                return malformed();
            }
            let parsed = (|| {
                let invoice_ref = fields[3].to_string();
                validate_invoice_ref(&invoice_ref).ok()?;
                Some(PayLineMemo {
                    run_id: parse_uuid(fields[1])?,
                    period: Period::parse(fields[2])?,
                    invoice_ref,
                    usd_basis_cents: parse_positive(fields[4])?,
                    rate_e6: parse_positive(fields[5])?,
                })
            })();
            parsed.map_or_else(malformed, |m| Decoded::Payslip(PayslipMemo::PayLine(m)))
        }
        TAG_ALLOCATION => {
            if fields.len() != 2 {
                return malformed();
            }
            parse_uuid(fields[1]).map_or_else(malformed, |run_id| {
                Decoded::Payslip(PayslipMemo::Allocation(AllocationMemo { run_id }))
            })
        }
        TAG_RUN_FUNDING => {
            if fields.len() != 6 {
                return malformed();
            }
            let parsed = (|| {
                Some(RunFundingMemo {
                    run_id: parse_uuid(fields[1])?,
                    period: Period::parse(fields[2])?,
                    funded_usd_cents: parse_positive(fields[3])?,
                    zec_acquired_zat: parse_positive(fields[4])?,
                    rate_e6: parse_positive(fields[5])?,
                })
            })();
            parsed.map_or_else(malformed, |m| Decoded::Payslip(PayslipMemo::RunFunding(m)))
        }
        _ => Decoded::Unlabelled {
            reason: UnlabelledReason::UnknownPrefix,
            text: Some(text.to_string()),
        },
    }
}

/// Decodes raw memo bytes as stored by the wallet (512 bytes, ZIP 302 encoding).
pub fn decode_bytes(bytes: Option<&[u8]>) -> Decoded {
    use zcash_protocol::memo::{Memo, MemoBytes};
    let Some(bytes) = bytes else {
        return Decoded::Unlabelled { reason: UnlabelledReason::NoMemo, text: None };
    };
    let memo = MemoBytes::from_bytes(bytes).ok().and_then(|mb| Memo::try_from(mb).ok());
    match memo {
        None => Decoded::Unlabelled { reason: UnlabelledReason::NonText, text: None },
        Some(Memo::Empty) => Decoded::Unlabelled { reason: UnlabelledReason::NoMemo, text: None },
        Some(Memo::Text(t)) => decode_str(&t),
        Some(_) => Decoded::Unlabelled { reason: UnlabelledReason::NonText, text: None },
    }
}

/// Decodes a memo that is already text.
pub fn decode_str(text: &str) -> Decoded {
    if text.is_empty() {
        return Decoded::Unlabelled { reason: UnlabelledReason::NoMemo, text: None };
    }
    if text.len() > MAX_MEMO_BYTES {
        return Decoded::Unlabelled {
            reason: UnlabelledReason::Malformed,
            text: Some(text.chars().take(80).collect()),
        };
    }
    decode_text(text)
}

/// Encodes a memo string into the 512-byte memo field.
pub fn to_memo_bytes(text: &str) -> Result<zcash_protocol::memo::MemoBytes, EncodeError> {
    use std::str::FromStr;
    use zcash_protocol::memo::{Memo, MemoBytes};
    let memo = Memo::from_str(text).map_err(|_| EncodeError::TooLong(text.len()))?;
    Ok(MemoBytes::from(memo))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run() -> Uuid {
        Uuid::parse_str("6f1c2d3e-4a5b-4c6d-8e7f-901234567890").unwrap()
    }

    fn pay_line() -> PayslipMemo {
        PayslipMemo::PayLine(PayLineMemo {
            run_id: run(),
            period: Period::new(2026, 9).unwrap(),
            invoice_ref: "INV-2026-014".into(),
            usd_basis_cents: 480_000,
            rate_e6: 1_354_930_000,
        })
    }

    #[test]
    fn pay_line_encodes_to_spec_format() {
        assert_eq!(
            pay_line().encode().unwrap(),
            "PS1|6f1c2d3e-4a5b-4c6d-8e7f-901234567890|2026-09|INV-2026-014|480000|1354930000"
        );
    }

    #[test]
    fn every_record_type_round_trips() {
        let records = [
            pay_line(),
            PayslipMemo::Allocation(AllocationMemo { run_id: run() }),
            PayslipMemo::RunFunding(RunFundingMemo {
                run_id: run(),
                period: Period::new(2026, 9).unwrap(),
                funded_usd_cents: 2_846_215,
                zec_acquired_zat: 2_101_000_000,
                rate_e6: 1_354_930_000,
            }),
        ];
        for r in records {
            let text = r.encode().unwrap();
            assert_eq!(decode_str(&text), Decoded::Payslip(r.clone()));
            let bytes = to_memo_bytes(&text).unwrap();
            assert_eq!(decode_bytes(Some(bytes.as_slice())), Decoded::Payslip(r));
        }
    }

    #[test]
    fn longest_valid_pay_line_fits_the_memo_field() {
        let mut m = match pay_line() {
            PayslipMemo::PayLine(m) => m,
            _ => unreachable!(),
        };
        m.invoice_ref = "X".repeat(MAX_INVOICE_REF_LEN);
        m.usd_basis_cents = u64::MAX;
        m.rate_e6 = u64::MAX;
        let text = PayslipMemo::PayLine(m).encode().unwrap();
        assert!(text.len() <= MAX_MEMO_BYTES);
    }

    #[test]
    fn length_limit_is_enforced() {
        let mut m = match pay_line() {
            PayslipMemo::PayLine(m) => m,
            _ => unreachable!(),
        };
        m.invoice_ref = "X".repeat(MAX_INVOICE_REF_LEN + 1);
        assert_eq!(PayslipMemo::PayLine(m).encode(), Err(EncodeError::InvoiceRefTooLong));
        let over = format!("PS1|{}", "a".repeat(600));
        assert_eq!(
            decode_str(&over),
            Decoded::Unlabelled {
                reason: UnlabelledReason::Malformed,
                text: Some(over.chars().take(80).collect())
            }
        );
        assert!(to_memo_bytes(&"a".repeat(513)).is_err());
        assert!(to_memo_bytes(&"a".repeat(512)).is_ok());
    }

    #[test]
    fn unknown_prefix_is_unlabelled_not_dropped() {
        for text in ["thanks for lunch", "PS2|future|format", "ps1|lowercase", "INVOICE 14"] {
            assert_eq!(
                decode_str(text),
                Decoded::Unlabelled { reason: UnlabelledReason::UnknownPrefix, text: Some(text.into()) },
                "{text}"
            );
        }
    }

    #[test]
    fn malformed_records_are_reported() {
        let id = run();
        for text in [
            format!("PS1|{id}|2026-09|INV-1|480000"),
            format!("PS1|{id}|2026-09|INV-1|480000|1354930000|extra"),
            format!("PS1|not-a-uuid|2026-09|INV-1|480000|1354930000"),
            format!("PS1|{id}|2026-13|INV-1|480000|1354930000"),
            format!("PS1|{id}|26-09|INV-1|480000|1354930000"),
            format!("PS1|{id}|2026-09||480000|1354930000"),
            format!("PS1|{id}|2026-09|INV-1|0|1354930000"),
            format!("PS1|{id}|2026-09|INV-1|-480000|1354930000"),
            format!("PS1|{id}|2026-09|INV-1|48.00|1354930000"),
            format!("PS1|{id}|2026-09|INV-1|0480000|1354930000"),
            format!("PS1|{id}|2026-09|INV-1|99999999999999999999999|1"),
            format!("PS1|{}|2026-09|INV-1|480000|1354930000", id.to_string().to_uppercase()),
            format!("PS1A|{id}|extra"),
            "PS1A|".to_string(),
            format!("PS1R|{id}|2026-09|100|0|1354930000"),
        ] {
            assert!(
                matches!(decode_str(&text), Decoded::Unlabelled { reason: UnlabelledReason::Malformed, .. }),
                "{text}"
            );
        }
    }

    #[test]
    fn empty_and_missing_memos_are_no_memo() {
        assert_eq!(decode_bytes(None), Decoded::Unlabelled { reason: UnlabelledReason::NoMemo, text: None });
        let empty = zcash_protocol::memo::MemoBytes::empty();
        assert_eq!(
            decode_bytes(Some(empty.as_slice())),
            Decoded::Unlabelled { reason: UnlabelledReason::NoMemo, text: None }
        );
        assert_eq!(decode_str(""), Decoded::Unlabelled { reason: UnlabelledReason::NoMemo, text: None });
    }

    #[test]
    fn binary_memo_is_non_text() {
        let mut raw = [0u8; 512];
        raw[0] = 0xff;
        raw[1] = 0x01;
        assert!(matches!(
            decode_bytes(Some(&raw)),
            Decoded::Unlabelled { reason: UnlabelledReason::NonText, .. }
        ));
    }

    #[test]
    fn invoice_ref_rejects_pipes_and_control_characters() {
        assert_eq!(validate_invoice_ref("INV|14"), Err(EncodeError::InvoiceRefCharset));
        assert_eq!(validate_invoice_ref("INV\n14"), Err(EncodeError::InvoiceRefCharset));
        assert_eq!(validate_invoice_ref("INV-14 é"), Err(EncodeError::InvoiceRefCharset));
        assert_eq!(validate_invoice_ref(""), Err(EncodeError::EmptyInvoiceRef));
        assert!(validate_invoice_ref("Invoice 14 / Sep").is_ok());
    }

    #[test]
    fn zero_amounts_cannot_be_encoded() {
        let mut m = match pay_line() {
            PayslipMemo::PayLine(m) => m,
            _ => unreachable!(),
        };
        m.usd_basis_cents = 0;
        assert_eq!(PayslipMemo::PayLine(m).encode(), Err(EncodeError::ZeroAmount));
    }

    #[test]
    fn period_parsing() {
        assert_eq!(Period::parse("2026-09"), Period::new(2026, 9));
        assert_eq!(Period::parse("2026-9"), None);
        assert_eq!(Period::parse("2026-00"), None);
        assert_eq!(Period::parse("+026-09"), None);
        assert_eq!(Period::new(2026, 12).unwrap().to_string(), "2026-12");
    }
}
