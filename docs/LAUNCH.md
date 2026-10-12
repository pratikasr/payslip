# Launch kit

The pitch video script, a pointer to the demo video script, and drafts for finding the first real users before 12 Oct 2026. Every claim below is something the repo shows working. The run-day order for recording and submitting is in [RUN-DAY.md](RUN-DAY.md).

## Pitch video (2 minutes at most, English)

The submission form's rule: at most 2 minutes, in English, the founder introduces himself, says what he is building and why he is the person to build it, nothing fancy. Face to camera on a phone or a webcam, one take, no slides, no music.

**273 spoken words.** At 140 words per minute, a calm reading pace, the close lands at 1:52 and the end at 1:56. The time stamps below use that pace; if a take runs past 2:00, read faster rather than cutting a section. Count again after any edit: `awk '/^## Pitch video/{p=1} /^## Product demo/{p=0} p && /^> /' docs/LAUNCH.md | sed 's/^> //' | wc -w` prints the number of words inside the quoted lines (273 today).

Record it after the mainnet run, because the proof section is true only then.

**1. Who I am (0:00)**

> Hi, I'm Pratik, and I'm building Payslip: private payroll on Zcash.

**2. The problem (0:04)**

> If your team pays contractors on a public chain, every salary is a public document: who you pay, how much, and when, for anyone with a block explorer. In January, Toku, Aleo and Paxos launched private stablecoin payroll, and Aleo's page calls Zcash a legacy privacy coin.

**3. The insight (0:24)**

> I think that is backwards. Zcash already hides a payment completely; the hard part is everything after. The contractor needs a statement for tax. The accountant needs to reconcile every dollar. Viewing keys make privacy and accounting compatible: one account per contractor, so that account's key shows their pay and nothing else, with no power to spend.

**4. What Payslip does (0:49)**

> The company signs in, runs payroll and funds it with ZEC from its own wallet; every payment goes out shielded, with an encrypted memo carrying period, invoice and dollar amount. The contractor opens payslips with their key and proves one payment to a landlord with a link that opens that payment alone. The accountant loads every key and sees every run reconciled, funded against paid, ready for Xero.

**5. Proof (1:18)**

> This is not a mockup. Payslip has run a real payroll on Zcash mainnet. The explorer shows those transactions with no amounts and no parties; the judge kit in the README holds the viewing keys, so you can read the same payroll back yourself.

**6. Why me (1:36)**

> I spent years around THORChain, where every vault is a threshold key and nobody trusts a single machine. Custody and auditability are the product, not an afterthought. I built Payslip alone; every commit is in the repo.

**7. Close (1:52)**

> Payslip. Private to the world, transparent to your accountant.

Facts the script leans on, with their sources: Toku, Aleo and Paxos Labs launched private stablecoin payroll (USAD on Aleo) on 29 Jan 2026 (https://www.paxoslabs.com/posts/usad-now-on-toku); Aleo's payroll page lists "Zcash, Monero" as "Legacy privacy coins" (https://aleo.org/payroll/). Both checked on 11 Oct 2026. The THORChain line is the only personal detail; do not add others. If a judge asks about limits: one copy of Payslip serves one company today, as self-hosted software does; hosted multi-company, each company with its own treasury key, people and runs on one host, is the next milestone.

## Product demo video (3 minutes at most)

The demo video script, with the exact clicks, the sentence spoken over each step and the shot list, is in [DEMO.md](DEMO.md) under Demo video. It is recorded during the mainnet run, on the hosted app, browser only.

## First users before the deadline

The submission asks for demand validation. The strongest evidence is a real team running a real payroll, even a small one, and a contractor or accountant saying it saved them work. In order of likely payoff:

1. **Your own contractors.** Pay one real invoice through Payslip on mainnet and ask the contractor for one sentence about the statement. Use a separate seed and data directory for this, never the demo seed: the demo seed's viewing keys are published in the judge kit, so anything it pays is public.
2. **Zcash ecosystem teams and grantees.** They already hold ZEC and pay contributors. Post in the Zcash Community Forum and ZecHub.
3. **One crypto accountant.** Ask them to open the accountant view with the judge kit and say whether it would save them time.

The hosted Books page's address is the Books CloudFront hostname that `deploy/aws/provision.sh` prints (VERIFY: run it, or read it from the runbook in `deploy/README.md`); the bracketed names below are per-recipient fields.

### Zcash Community Forum post

Post this only once the statements page is hosted and the repository is public, with the Books hostname in place of the hosted address.

Title: Payslip: private payroll for teams that pay contributors in ZEC or stablecoins

> Hi all. I built Payslip for the Zcash track of Colosseum's Crypto World's Fair. It pays contractors with shielded Ironwood transactions and gives each contractor a viewing key for their own account only, so they can produce their own statement for tax. An accountant holding all the keys gets a reconciliation of every run from the chain alone.
>
> It is open source (MIT): https://github.com/pratikasr/payslip. To try the contractor and accountant views without installing anything, open the hosted Books page with the judge kit of viewing keys linked from the README.
>
> I am looking for two or three teams who pay contributors in ZEC or USDC to run one real payroll through it before 12 Oct. I will set it up with you and handle anything that breaks. If you are a grantee paying contributors, I would especially like to hear how you do statements today.

### Direct message to a team that pays contributors

> Hi [name], I saw [team] pays contributors in [ZEC / USDC]. I built Payslip, a payroll tool on Zcash: every payment is shielded, and each contributor gets a viewing key that shows only their own pay, with statements ready for tax. Would you run one payroll through it this week? I will do the setup and cover the network fees. Two minutes of your feedback afterwards would help a lot.

### Message to an accountant who serves crypto clients

> Hi [name], I built a payroll tool on Zcash where every payment is private on chain, but the accountant holds viewing keys for every account and gets a reconciliation of each payroll run from the chain: dollars funded against dollars paid, with the difference explained, exported to Xero or QuickBooks. Could you spend ten minutes with the demo keys and tell me whether this would replace work you do by hand today? The link is the hosted Books page, and the keys are the judge kit linked from the README.

### Reply to keep for the submission

When someone tries it, ask: "Can I quote you in my hackathon submission, with your name and team, or anonymously?" Record each answer in docs/SUBMISSION.md under Demand validation.
