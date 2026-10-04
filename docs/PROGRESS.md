# Progress log

Newest entry first. One entry per session: what moved, commit hashes, what is next, what is blocked and why.

## 5 Oct 2026, M2 to M4 on testnet

- M2 Wallet core: done (ddb3004). Seed to ZIP-32 accounts, per-account UFVK export, sync with memo enhancement, shielded send with memo, memo codec with tests. Evidence: service-built tx fe28107b172e6891a21375047515ae691d5725b22f7c876dea18fc767c07b068 (testnet height 4,465,646, v6, two Ironwood actions, fee 10,000 zat) was recovered by `payslip-service scan` with only the exported treasury UFVK, memo decoded as a PS1 pay line.
- M3 Runs: done (4de4284). REST API, SwapVenue trait with NEAR Intents 1Click, Maya quote client and the testnet fixed-rate venue, persisted executor, SSE. Evidence: run 9145b60b-f19a-4467-ad8a-78a14bd642f6 paid three testnet contractors from the API: allocation f5c142569ab980447bd79d4bbb6b3457e9e1789e46e2b3425ee453d608b0400e at 4,465,670; payments 3c5513c5aaee0def9244a5fb02a32681a0c9b0046a0e1a16b1964c8ede83bd08 (4,465,671), a21fabe27fc81085dd47b5e59bf04f466bda90ec12b24f151248484593691b62 and 3952333d5466eed83b3fc3bad1ee82865708e54500c0d0520bad5d90d0464026 (4,465,672).
- M4 Statement engine: done (4de4284). Evidence: Amara Okafor's statement from her account UFVK alone listed exactly her pay line (txid 3c5513c5..., height 4,465,671, 355,555 zat, 4,800.00 USD, INV-2026-014); the accountant reconciliation over all exported keys marked run 9145b60b reconciled with variance 1,215.01 USD equal to the unpaid ZEC at the fill rate; the faucet deposit is listed as unlabelled and the manual M2 test payment as missing a funding record, so nothing is dropped.
- Hardening (90ed68a): executor crash, expiry, reorg and duplicate-execute tests against an in-memory chain; panic left a run stuck as running (fixed); reorg-aware confirmation; clock skew in health; live testnet integration tests; dev-sweep recycles testnet payouts.
- M1 Scaffold: service and CI done; web scaffold in progress, CI web job fails until web/ is committed.
- Testnet funds: Valar faucet paid 0.125 TAZ. fauzec reported a 1 TAZ payout confirmed at height 4,465,299 that no testnet explorer knows; its node appears to be on the pre-NU7 fork, so that payout is unusable. Payouts to the dev contractor wallets are swept back to the treasury between rehearsals.
- Next: commit the web app (closes M1), M5 web against the live testnet service, then the five test rounds.
- Blocked: nothing.

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
