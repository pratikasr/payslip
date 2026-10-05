//! ZEC market prices for the value of a payment at the moment it was received, which is what
//! most tax authorities count as income. Read from CoinGecko's public market chart API
//! (Verified facts, 5 Oct 2026): five-minute points for ranges up to a day, hourly up to 90
//! days, daily beyond. A statement never fails because prices are unavailable; its lines just
//! carry no market value.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use anyhow::{bail, Context};
use serde::{Deserialize, Serialize};

/// Fiat currencies CoinGecko quotes ZEC in (`/simple/supported_vs_currencies`, 5 Oct 2026).
pub const CURRENCIES: &[&str] = &[
    "usd", "aed", "ars", "aud", "bdt", "bhd", "brl", "cad", "chf", "clp", "cny", "czk", "dkk", "eur", "gbp", "gel",
    "hkd", "huf", "idr", "ils", "inr", "jpy", "krw", "kwd", "lkr", "mmk", "mxn", "myr", "ngn", "nok", "nzd", "php",
    "pkr", "pln", "rub", "sar", "sek", "sgd", "thb", "try", "twd", "uah", "vnd", "zar",
];

/// The value of one payment at receipt.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct MarketValue {
    /// ISO 4217 code, upper case.
    pub currency: String,
    /// Price of one ZEC, in hundredths of the currency.
    pub price_cents: u64,
    /// Value of the payment, in hundredths of the currency.
    pub value_cents: u64,
    /// When the price point was taken (RFC 3339), nearest to the block time.
    pub priced_at: String,
    pub source: &'static str,
}

/// Price points (Unix seconds, price) per request range, with when they were fetched.
type Cache = HashMap<String, (Instant, Vec<(i64, f64)>)>;

pub struct Prices {
    http: reqwest::Client,
    base: Option<String>,
    api_key: Option<String>,
    cache: Mutex<Cache>,
}

#[derive(Deserialize)]
struct Chart {
    prices: Vec<(f64, f64)>,
}

const HOUR: i64 = 3600;
/// Seconds a recent price range is reused for; also the step its end is rounded up to.
const CACHE_STEP: i64 = 300;
/// Price ranges kept in memory at most.
const MAX_CACHED_RANGES: usize = 256;

impl Prices {
    /// `base` None disables prices.
    pub fn new(base: Option<String>, api_key: Option<String>) -> Self {
        Prices {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .user_agent("payslip-service")
                .build()
                .expect("http client"),
            base: base.map(|b| b.trim_end_matches('/').to_string()),
            api_key,
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn enabled(&self) -> bool {
        self.base.is_some()
    }

    /// Prices (Unix seconds, price) covering `from..=to`, padded by an hour each side.
    async fn series(&self, currency: &str, from: i64, to: i64, now: i64) -> anyhow::Result<Vec<(i64, f64)>> {
        let Some(base) = &self.base else {
            bail!("prices are disabled")
        };
        let from = (from - HOUR).div_euclid(HOUR) * HOUR;
        let to = ((to + HOUR).div_euclid(HOUR) + 1) * HOUR;
        // Capped at the last five-minute mark, not at `now`: the cache key then stays the same
        // for five minutes and repeated statements share one request. A payment mined since
        // that mark is still within the gap allowed to its nearest price point.
        let to = to.min(now.div_euclid(CACHE_STEP) * CACHE_STEP);
        let key = format!("{currency}:{from}:{to}");
        // A range that ended over an hour ago never changes; a recent one is refreshed.
        let ttl = if to < now - HOUR {
            Duration::MAX
        } else {
            Duration::from_secs(CACHE_STEP as u64)
        };
        if let Some((at, s)) = self.cache.lock().ok().and_then(|c| c.get(&key).cloned()) {
            if at.elapsed() < ttl {
                return Ok(s);
            }
        }
        // The public API rate-limits bursts (HTTP 429): back off briefly and try again twice.
        let mut resp = None;
        for wait_ms in [0u64, 1_500, 4_000] {
            if wait_ms > 0 {
                tokio::time::sleep(Duration::from_millis(wait_ms)).await;
            }
            let mut req = self.http.get(format!("{base}/coins/zcash/market_chart/range")).query(&[
                ("vs_currency", currency),
                ("from", &from.to_string()),
                ("to", &to.to_string()),
            ]);
            if let Some(k) = &self.api_key {
                req = req.header("x-cg-demo-api-key", k);
            }
            let r = req.send().await.context("price request")?;
            if r.status() != reqwest::StatusCode::TOO_MANY_REQUESTS {
                resp = Some(r);
                break;
            }
        }
        let Some(resp) = resp else {
            bail!("price source is rate limiting requests")
        };
        if !resp.status().is_success() {
            bail!("price source answered {}", resp.status());
        }
        let chart: Chart = resp.json().await.context("price response")?;
        let s: Vec<(i64, f64)> = chart
            .prices
            .into_iter()
            .filter(|(_, p)| p.is_finite() && *p > 0.0)
            .map(|(ms, p)| ((ms / 1000.0) as i64, p))
            .collect();
        if let Ok(mut c) = self.cache.lock() {
            if c.len() >= MAX_CACHED_RANGES {
                // Drop what is stale; if everything is fresh, start over rather than grow.
                c.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(CACHE_STEP as u64));
                if c.len() >= MAX_CACHED_RANGES {
                    c.clear();
                }
            }
            c.insert(key, (Instant::now(), s.clone()));
        }
        Ok(s)
    }

    /// Market value of each `(unix seconds, zatoshis)` payment, in `currency`. None for a payment
    /// with no price point close enough to its time.
    pub async fn values(&self, currency: &str, payments: &[(i64, u64)]) -> anyhow::Result<Vec<Option<MarketValue>>> {
        if payments.is_empty() {
            return Ok(vec![]);
        }
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let from = payments.iter().map(|p| p.0).min().unwrap_or(now);
        let to = payments.iter().map(|p| p.0).max().unwrap_or(now);
        let series = self.series(currency, from, to, now).await?;
        // The source's granularity depends on the range it was asked for.
        let span = to - from + 2 * HOUR;
        let max_gap = if span <= 24 * HOUR {
            15 * 60
        } else if span <= 90 * 24 * HOUR {
            2 * HOUR
        } else {
            36 * HOUR
        };
        Ok(payments
            .iter()
            .map(|&(t, zat)| value_at(&series, t, zat, max_gap, currency))
            .collect())
    }
}

/// The price point nearest `t`, within `max_gap` seconds, applied to `zat`.
pub fn value_at(series: &[(i64, f64)], t: i64, zat: u64, max_gap: i64, currency: &str) -> Option<MarketValue> {
    let &(at, price) = series.iter().min_by_key(|(pt, _)| (pt - t).abs())?;
    if (at - t).abs() > max_gap {
        return None;
    }
    let price_cents = (price * 100.0).round() as u64;
    let value_cents = ((u128::from(zat) * u128::from(price_cents) + 50_000_000) / 100_000_000) as u64;
    let priced_at = time::OffsetDateTime::from_unix_timestamp(at)
        .ok()?
        .format(&time::format_description::well_known::Rfc3339)
        .ok()?;
    Some(MarketValue {
        currency: currency.to_ascii_uppercase(),
        price_cents,
        value_cents,
        priced_at,
        source: "coingecko",
    })
}

/// A currency code from a request, lower-cased and checked.
pub fn parse_currency(raw: Option<&str>) -> Option<String> {
    let c = raw.unwrap_or("usd").trim().to_ascii_lowercase();
    CURRENCIES.contains(&c.as_str()).then_some(c)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_uses_the_nearest_price_within_the_gap() {
        // 5-minute points around 2026-10-05 02:00 UTC.
        let t0 = 1_791_165_600;
        let series = vec![(t0 - 300, 1_340.10), (t0, 1_338.64), (t0 + 300, 1_343.20)];
        // 0.00355556 ZEC paid 100 s after t0: nearest point is t0.
        let v = value_at(&series, t0 + 100, 355_556, 900, "usd").unwrap();
        assert_eq!(v.currency, "USD");
        assert_eq!(v.price_cents, 133_864);
        // 355,556 zat x 1,338.64 = 4.7596... -> 4.76
        assert_eq!(v.value_cents, 476);
        assert_eq!(v.priced_at, "2026-10-05T02:00:00Z");
        // Too far from any point: no value rather than a stale one.
        assert!(value_at(&series, t0 + 5_000, 355_556, 900, "usd").is_none());
        assert!(value_at(&[], t0, 1, 900, "usd").is_none());
    }

    #[test]
    fn whole_coins_round_to_the_cent() {
        let v = value_at(&[(0, 128_978.613)], 0, 250_000_000, 60, "inr").unwrap();
        assert_eq!(v.price_cents, 12_897_861);
        assert_eq!(v.value_cents, 32_244_653);
        assert_eq!(v.currency, "INR");
    }

    #[test]
    fn currencies_are_checked() {
        assert_eq!(parse_currency(None).as_deref(), Some("usd"));
        assert_eq!(parse_currency(Some(" EUR ")).as_deref(), Some("eur"));
        assert_eq!(parse_currency(Some("btc")), None);
        assert_eq!(parse_currency(Some("xyz")), None);
    }
}
