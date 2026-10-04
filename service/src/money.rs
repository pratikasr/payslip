//! Integer money math. USD in cents, ZEC in zatoshis, rates in USD per ZEC times 1e6.
//!
//! No floating point touches an amount that is paid or reported.

pub const ZAT_PER_ZEC: u64 = 100_000_000;

/// `rate_e6 * zat / 1e12 = cents`, so `cents * 1e12 / rate_e6 = zat`.
const SCALE: u128 = 1_000_000_000_000;

fn div_round(n: u128, d: u128) -> u128 {
    (n + d / 2) / d
}

/// The fill rate of a swap: USD paid in per ZEC received, times 1e6. `None` if either side is 0.
pub fn fill_rate_e6(funded_usd_cents: u64, zec_acquired_zat: u64) -> Option<u64> {
    if funded_usd_cents == 0 || zec_acquired_zat == 0 {
        return None;
    }
    u64::try_from(div_round(funded_usd_cents as u128 * SCALE, zec_acquired_zat as u128)).ok()
}

/// ZEC for a USD amount at a rate, rounded half up to the nearest zatoshi.
pub fn usd_cents_to_zat(usd_cents: u64, rate_e6: u64) -> Option<u64> {
    if rate_e6 == 0 {
        return None;
    }
    u64::try_from(div_round(usd_cents as u128 * SCALE, rate_e6 as u128)).ok()
}

/// USD value of a ZEC amount at a rate, rounded half up to the nearest cent.
pub fn zat_to_usd_cents(zat: u64, rate_e6: u64) -> u64 {
    div_round(zat as u128 * rate_e6 as u128, SCALE) as u64
}

/// `12.34567890` style, always 8 decimals.
pub fn format_zec(zat: u64) -> String {
    format!("{}.{:08}", zat / ZAT_PER_ZEC, zat % ZAT_PER_ZEC)
}

/// Signed variant for variances.
pub fn format_zec_signed(zat: i128) -> String {
    let sign = if zat < 0 { "-" } else { "" };
    format!("{sign}{}", format_zec(zat.unsigned_abs() as u64))
}

/// `1234.56` style, always 2 decimals, no separators (for CSV).
pub fn format_usd(cents: u64) -> String {
    format!("{}.{:02}", cents / 100, cents % 100)
}

pub fn format_usd_signed(cents: i128) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    format!("{sign}{}", format_usd(cents.unsigned_abs() as u64))
}

/// `1354.930000` style for a rate.
pub fn format_rate(rate_e6: u64) -> String {
    format!("{}.{:06}", rate_e6 / 1_000_000, rate_e6 % 1_000_000)
}

/// Parses a decimal string such as "28462.15" into base units with `decimals` places.
pub fn parse_decimal(s: &str, decimals: u32) -> Option<u128> {
    let s = s.trim();
    let (whole, frac) = s.split_once('.').unwrap_or((s, ""));
    if whole.is_empty() && frac.is_empty() {
        return None;
    }
    if !whole.bytes().chain(frac.bytes()).all(|b| b.is_ascii_digit()) || frac.len() > decimals as usize {
        return None;
    }
    let whole: u128 = if whole.is_empty() { 0 } else { whole.parse().ok()? };
    let mut frac_s = frac.to_string();
    while frac_s.len() < decimals as usize {
        frac_s.push('0');
    }
    let frac: u128 = if frac_s.is_empty() { 0 } else { frac_s.parse().ok()? };
    whole.checked_mul(10u128.pow(decimals))?.checked_add(frac)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_rate_matches_hand_calculation() {
        // $28,462.15 for 21.01 ZEC is $1,354.6954... per ZEC.
        assert_eq!(fill_rate_e6(2_846_215, 2_101_000_000), Some(1_354_695_383));
        assert_eq!(fill_rate_e6(0, 1), None);
        assert_eq!(fill_rate_e6(1, 0), None);
    }

    #[test]
    fn usd_to_zat_round_trips_within_one_cent() {
        let rate = 1_354_930_000;
        for cents in [1u64, 99, 480_000, 325_000, 100_000_000, 777_777] {
            let zat = usd_cents_to_zat(cents, rate).unwrap();
            let back = zat_to_usd_cents(zat, rate);
            assert!(back.abs_diff(cents) <= 1, "{cents} -> {zat} -> {back}");
        }
        assert_eq!(usd_cents_to_zat(100, 0), None);
    }

    #[test]
    fn exact_conversions() {
        // At $50.00 per ZEC, $25.00 is exactly 0.5 ZEC.
        assert_eq!(usd_cents_to_zat(2_500, 50_000_000), Some(50_000_000));
        assert_eq!(zat_to_usd_cents(50_000_000, 50_000_000), 2_500);
    }

    #[test]
    fn formatting() {
        assert_eq!(format_zec(0), "0.00000000");
        assert_eq!(format_zec(354_262_000), "3.54262000");
        assert_eq!(format_zec(1), "0.00000001");
        assert_eq!(format_zec_signed(-1), "-0.00000001");
        assert_eq!(format_usd(480_000), "4800.00");
        assert_eq!(format_usd(5), "0.05");
        assert_eq!(format_usd_signed(-1215), "-12.15");
        assert_eq!(format_rate(1_354_930_000), "1354.930000");
    }

    #[test]
    fn decimal_parsing() {
        assert_eq!(parse_decimal("28462.15", 6), Some(28_462_150_000));
        assert_eq!(parse_decimal("1", 8), Some(100_000_000));
        assert_eq!(parse_decimal(".5", 2), Some(50));
        assert_eq!(parse_decimal("1.123", 2), None);
        assert_eq!(parse_decimal("-1", 2), None);
        assert_eq!(parse_decimal("", 2), None);
        assert_eq!(parse_decimal("1e5", 2), None);
    }
}
