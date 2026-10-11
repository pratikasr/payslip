//! Fund with ZEC (ADR-025): the executor's watch on the treasury for a run whose funding venue
//! is the treasury. The payer sends ZEC to the treasury address; nothing ties a deposit to a
//! run, so the run is funded when the treasury's confirmed balance, net of what other runs hold
//! a claim on, covers it at the market rate of the tip block. That rate is the run's USD basis
//! and goes into the funding record on chain exactly as a venue's fill rate does.

use super::*;

/// A Fund with ZEC request past its deadline (plus the grace) is expired while the run is still
/// unfunded, whether nothing or only part of the ZEC arrived. What did arrive stays in the
/// treasury and counts toward the next request.
pub fn apply_zec_deadline(mut f: Funding, now: OffsetDateTime) -> Funding {
    if matches!(f.status.as_str(), "awaiting_deposit" | "deposit_seen") {
        if let Some(deadline) = f
            .deadline
            .as_deref()
            .and_then(|d| OffsetDateTime::parse(d, &Rfc3339).ok())
        {
            if now > deadline + time::Duration::minutes(DEADLINE_GRACE_MINUTES) {
                f.status = "expired".into();
                f.venue_status = Some("EXPIRED".into());
            }
        }
    }
    f
}

fn funding_of(run: &RunRow) -> Option<Funding> {
    run.venue_state
        .as_deref()
        .and_then(|s| serde_json::from_str::<Funding>(s).ok())
}

fn zec_expired() -> StepError {
    permanent(
        "funding_expired",
        "The request to fund with ZEC expired before enough ZEC confirmed in the treasury.",
        "Fund the run again: ZEC already in the treasury counts toward the new request. Or cancel the run.",
    )
}

impl Executor {
    /// True for a Fund with ZEC request.
    pub(super) fn is_treasury(f: &Funding) -> bool {
        f.venue == VenueKind::Treasury.as_str()
    }

    pub(super) fn is_treasury_run(run: &RunRow) -> bool {
        funding_of(run).is_some_and(|f| Self::is_treasury(&f))
    }

    /// The venue a funding record belongs to: the treasury for a Fund with ZEC request, else the
    /// configured USDC venue.
    pub(super) fn venue_of(&self, f: &Funding) -> Arc<dyn SwapVenue> {
        if Self::is_treasury(f) {
            self.inner.treasury.clone()
        } else {
            self.inner.venue.clone()
        }
    }

    /// ZEC in the treasury that other runs hold a claim on, so one deposit is never counted for
    /// two runs: every run funded but not yet allocated (once its allocation is built the wallet
    /// balance already reflects it), a failed run whose ZEC was recorded, and every earlier run
    /// still awaiting its own ZEC. A deposit the venue is still swapping for a USDC run is
    /// claimed from the moment the venue reports it, which only delays a ZEC run by the swap.
    /// Runs awaiting ZEC claim the balance in the order they were created.
    async fn reserved_by_others(&self, run: &RunRow) -> anyhow::Result<u64> {
        let mut reserved = 0u64;
        let runs = db::runs_oldest_first(&self.inner.db).await?;
        let mine = runs.iter().position(|r| r.id == run.id).unwrap_or(usize::MAX);
        for (pos, r) in runs.iter().enumerate() {
            if r.id == run.id || r.allocation_txid.is_some() {
                continue;
            }
            let f = funding_of(r);
            let recorded = r.zec_acquired.map(|z| z as u64);
            let claim = match r.status.as_str() {
                "funded" | "swapping" | "swapped" => recorded
                    .or_else(|| f.as_ref().and_then(|f| f.zec_acquired_zat))
                    .or_else(|| f.as_ref().map(|f| f.quoted_zat)),
                "failed" => recorded.or_else(|| f.as_ref().and_then(|f| f.zec_acquired_zat)),
                "awaiting_funds" => f
                    .as_ref()
                    .filter(|f| Self::is_treasury(f) && !funding_closed(&f.status) && pos < mine)
                    .map(|f| f.zec_required_zat.unwrap_or(f.quoted_zat)),
                _ => None,
            };
            reserved = reserved.saturating_add(claim.unwrap_or(0));
        }
        Ok(reserved)
    }

    /// One look at the treasury for a run awaiting ZEC. Records what has arrived (confirmed and
    /// still confirming, net of other runs' claims) and the shortfall at the current rate, and
    /// when the confirmed balance covers the run, funds it: the rate of the tip block becomes
    /// the USD basis, the ZEC set aside is what was asked for (at least what the run needs now,
    /// at most what is free), and the run moves to `funded`. `sync` first brings the wallet to
    /// the tip; the API's poll relies on the background sync instead. Returns the record as
    /// stored.
    pub(super) async fn watch_treasury(&self, run: &RunRow, f: &Funding, sync: bool) -> anyhow::Result<Funding> {
        let db = &self.inner.db;
        let chain = &self.inner.chain;
        let now = OffsetDateTime::now_utc();
        if sync {
            chain.sync().await?;
        }
        let tip = chain.tip().await?;
        let spendable = chain.spendable(TREASURY_INDEX).await?;
        let total = chain.total(TREASURY_INDEX).await?;
        let reserved = self.reserved_by_others(run).await?;
        let free = spendable.saturating_sub(reserved);
        let pending = total.saturating_sub(reserved).saturating_sub(free);
        let lines = db::lines(db, &run.id).await?;
        let converting = lines.iter().filter(|l| converts(l)).count();
        let reserve = fee_estimate_zat(lines.len(), converting);
        // The rate of the tip block, as statements value a payment mined in it.
        let at = match chain.block_time(tip).await {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!(run = run.id, "block time at {tip} not available: {e:#}");
                now.unix_timestamp()
            }
        };
        let rate = match self.inner.treasury.rate_at(at).await {
            Ok(r) => Some(r),
            Err(e) => {
                tracing::warn!(run = run.id, "market price not available: {e}");
                None
            }
        };
        let need = rate.as_ref().and_then(|r| {
            lines.iter().try_fold(reserve, |need, l| {
                need.checked_add(money::usd_cents_to_zat(l.amount_usd_basis as u64, r.rate_e6)?)
            })
        });
        let asked = f.zec_required_zat.unwrap_or(f.quoted_zat);
        let mut g = f.clone();
        g.zec_received_zat = Some(free);
        g.zec_pending_zat = Some(pending);
        let seen = if free > 0 || pending > 0 {
            "deposit_seen"
        } else {
            "awaiting_deposit"
        };
        let mut funded: Option<(u64, u64)> = None;
        match (&rate, need) {
            (Some(r), Some(need)) if free >= need => {
                let acquired = asked.max(need).min(free);
                g.status = "success".into();
                g.zec_shortfall_zat = Some(0);
                g.funded_at_height = Some(tip);
                g.rate_usd_per_zec_e6 = Some(r.rate_e6);
                g.priced_at = Some(r.priced_at.clone());
                g.zec_acquired_zat = Some(acquired);
                g.funded_usd_cents = Some(money::zat_to_usd_cents(acquired, r.rate_e6));
                g.venue_status = Some("FUNDED".into());
                funded = Some((acquired, r.rate_e6));
            }
            (_, Some(need)) => {
                g.status = seen.into();
                g.zec_shortfall_zat = Some(need - free);
                g.venue_status = Some(
                    if pending > 0 {
                        "CONFIRMING"
                    } else if free > 0 {
                        "PARTIAL"
                    } else {
                        "AWAITING_ZEC"
                    }
                    .into(),
                );
            }
            _ => {
                g.status = seen.into();
                g.zec_shortfall_zat = None;
                g.venue_status = Some("PRICE_UNAVAILABLE".into());
            }
        }
        if funded.is_none() {
            g = apply_zec_deadline(g, now);
        }
        if g != *f {
            db::set_venue(db, &run.id, &g.venue, &serde_json::to_value(&g)?).await?;
            self.notify(&run.id);
        }
        if let Some((acquired, rate_e6)) = funded {
            if db::transition(db, &run.id, &["awaiting_funds"], "funded").await? {
                self.log(
                    &run.id,
                    format!(
                        "Funded with {} ZEC from the treasury at {} USD per ZEC (block {})",
                        money::format_zec(acquired),
                        money::format_rate(rate_e6),
                        money::format_count(tip.into())
                    ),
                )
                .await;
            }
        }
        Ok(g)
    }

    /// The executor's funding step for a Fund with ZEC request: watch the treasury until it
    /// covers the run, then record the funding as a fill.
    pub(super) async fn step_zec_funding(&self, run: &RunRow, f: &Funding) -> Result<Outcome, StepError> {
        match f.status.as_str() {
            "success" => self.record_fill(run, f).await,
            "expired" => Err(zec_expired()),
            _ => {
                let g = self.watch_treasury(run, f, true).await?;
                match g.status.as_str() {
                    "success" => Ok(Outcome::Continue),
                    "expired" => Err(zec_expired()),
                    _ => Ok(Outcome::Wait(self.inner.poll)),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A partial deposit past the deadline expires the request too; a funded one never does.
    #[test]
    fn the_deadline_expires_an_unfunded_request_only() {
        let at = |s: &str| OffsetDateTime::parse(s, &Rfc3339).unwrap();
        let f = Funding {
            venue: "treasury".into(),
            status: "deposit_seen".into(),
            deadline: Some("2026-10-12T10:00:00Z".into()),
            ..Default::default()
        };
        assert_eq!(
            apply_zec_deadline(f.clone(), at("2026-10-12T10:09:00Z")).status,
            "deposit_seen"
        );
        assert_eq!(
            apply_zec_deadline(f.clone(), at("2026-10-12T10:11:00Z")).status,
            "expired"
        );
        let awaiting = Funding {
            status: "awaiting_deposit".into(),
            ..f.clone()
        };
        assert_eq!(
            apply_zec_deadline(awaiting, at("2026-10-13T00:00:00Z")).status,
            "expired"
        );
        let funded = Funding {
            status: "success".into(),
            ..f
        };
        assert_eq!(apply_zec_deadline(funded, at("2026-10-13T00:00:00Z")).status, "success");
    }
}
