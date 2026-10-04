# Progress log

Newest entry first. One entry per session: what moved, commit hashes, what is next, what is blocked and why.

## 5 Oct 2026, M0 Verify

- M0 done. All five VERIFY items in docs/SPEC.md resolved and recorded under Verified facts in docs/TECH-DECISIONS.md, with ADR-013 to ADR-019.
- Wallet pin: `zcash_client_backend` 0.25.0-pre.0 (ADR-013). 0.24.0 scans Ironwood, but testnet activated NU7 at 4,465,026 on 4 Oct and only the 0.25.0-pre.0 stack knows that height.
- Primary swap venue: NEAR Intents 1Click (ADR-015). It delivers USDC to ZEC into the Ironwood pool for any UA with an Orchard receiver. Maya is the fallback (Sapling only). Testnet uses the fixed-rate TestnetVenue because 1Click has no testnet.
- Solana OUSD rail stays out of scope: the mint has confidential transfers but no auditor key.
- Next: M1 scaffold (service, web, CI).
- Blocked: nothing.

## 5 Oct 2026

- Repo initialised with README, docs/SPEC.md, docs/TECH-DECISIONS.md, CLAUDE.md, LICENSE (MIT).
- Current milestone: M0 Verify. Nothing started.
- Next: resolve the five VERIFY items in docs/SPEC.md and record them in docs/TECH-DECISIONS.md under Verified facts.
- Blocked: nothing.
