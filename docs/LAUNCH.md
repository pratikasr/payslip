# Launch kit

Scripts for the two submission videos, and drafts for finding the first real users before 12 Oct 2026. Every claim below is something the repo shows working; the bracketed parts are filled in after the mainnet run.

## Presentation video (2 to 3 minutes, English)

Read at a normal pace this runs about two and a half minutes. Film your face for the first and last parts; the middle can be slides or the landing page.

**1. The problem (0:00)**

"If your team pays contractors in crypto, every salary you pay is public. Anyone with a block explorer can see who you pay, how much, and when. Your competitors can read your payroll. Your contractors can read each other's. And their landlord, their ex, anyone, can follow their money."

"The usual fix is to stop paying on chain. Then you lose what made crypto payroll good: paying anyone, anywhere, in minutes."

**2. The insight (0:25)**

"Zcash can hide a payment completely. The hard part has never been hiding it. It is everything after: the contractor needs a statement for tax, and the accountant needs to reconcile every dollar."

"Payslip gives every contractor their own Zcash account. That means a viewing key for that account shows that person's pay and nothing else. The contractor gets their key. The accountant gets all of them. The rest of the world gets nothing."

**3. The product (0:50)**

"Here is a payroll run. The payer funds it in USDC from any wallet. NEAR Intents swaps it into ZEC straight into Zcash's shielded pool, and the fill rate becomes the USD basis for the books."

"One click pays six contractors. Each payment is shielded and carries an encrypted memo: the run, the period, the invoice and the dollar amount."

"The contractor pastes their key and gets a statement, with what each payment was worth when it arrived, in their own currency, ready for Koinly or their accountant. If they need to prove one payment to a landlord or a bank, they send a link that opens that one payment and nothing else."

"The accountant imports every key and gets a reconciliation: dollars funded against dollars paid for every run, with the difference explained by network fees and unspent ZEC, down to rounding of a cent per payment. Exports go straight into Xero or QuickBooks."

**4. Proof (1:40)**

"This ran on Zcash mainnet. [Six] contractors paid on [date]. Here are the transactions in the explorer: no amounts, no parties. And here is the same run, read back by the accountant from the chain alone."

**5. Business (1:55)**

"Teams pay Deel or Rise 49 dollars per contractor per month today, and their payroll is still public on chain. Payslip is 19 dollars per active contractor per month hosted, plus a quarter of a percent on the swap. Self-hosting is free and open source. Contractors and accountants never pay."

"We start with Zcash ecosystem teams and grantees who already pay in crypto, then DAOs and remote teams paying contractors in stablecoins."

**6. Close (2:20)**

"Payslip. Private to the world, transparent to your accountant."

## Product demo video (3 minutes at most)

Record during the mainnet run, following the click path in [DEMO.md](DEMO.md). Say this over it:

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | Landing page | "Payroll on a public chain is a public document. Payslip pays contractors on Zcash, shielded, and gives each person a key to exactly their slice." |
| 0:15 | Payer, Contractors, Share viewing key | "Every contractor gets their own account, so their viewing key shows their pay and nothing else." |
| 0:30 | The run, Fund step, wallet confirmation | "The payer funds the run in USDC from any wallet. NEAR Intents swaps it into ZEC in the shielded pool, and the fill rate is the USD basis." |
| 0:55 | Execute run, rows turning Confirmed | "One click: six shielded payments, each with an encrypted memo carrying the run, period, invoice and dollar amount." |
| 1:15 | A txid in zecblock.com | "This is what the world sees. A shielded transaction. No amount, no sender, no recipient." |
| 1:30 | Contractor page, paste key, statement | "The contractor pastes their key. Their statement comes straight from the chain, with each payment's market value when it arrived. Export to Koinly or CoinTracker, or print it." |
| 1:55 | Prove this payment, then the /verify page | "To prove one payment to a landlord, the contractor sends this link. It opens that payment, checked against the chain, and nothing else." |
| 2:15 | Accountant page, import keys, Reconciled | "The accountant imports every key. Every run reconciles: funded against paid, the difference explained down to rounding. Export to Xero or QuickBooks." |
| 2:45 | Landing headline | "Private to the world, transparent to your accountant." |

## First users before the deadline

The submission asks for demand validation. The strongest evidence is a real team running a real payroll, even a small one, and a contractor or accountant saying it saved them work. In order of likely payoff:

1. **Your own contractors.** Pay one real invoice through Payslip on mainnet and ask the contractor for one sentence about the statement.
2. **Zcash ecosystem teams and grantees.** They already hold ZEC and pay contributors. Post in the Zcash Community Forum and ZecHub.
3. **One crypto accountant.** Ask them to open the accountant view with the judge kit and say whether it would save them time.

### Zcash Community Forum post

Title: Payslip: private payroll for teams that pay contributors in ZEC or stablecoins

> Hi all. I built Payslip for the Zcash track of Colosseum's Crypto World's Fair. It pays contractors with shielded Ironwood transactions and gives each contractor a viewing key for their own account only, so they can produce their own statement for tax. An accountant holding all the keys gets a reconciliation of every run from the chain alone.
>
> It is open source (MIT): https://github.com/pratikasr/payslip. There is a judge kit with testnet viewing keys in the README if you want to try the contractor and accountant views without running anything.
>
> I am looking for two or three teams who pay contributors in ZEC or USDC to run one real payroll through it before 12 Oct. I will set it up with you and handle anything that breaks. If you are a grantee paying contributors, I would especially like to hear how you do statements today.

### Direct message to a team that pays contributors

> Hi [name], I saw [team] pays contributors in [ZEC / USDC]. I built Payslip, a payroll tool on Zcash: every payment is shielded, and each contributor gets a viewing key that shows only their own pay, with statements ready for tax. Would you run one payroll through it this week? I will do the setup and cover the network fees. Two minutes of your feedback afterwards would help a lot.

### Message to an accountant who serves crypto clients

> Hi [name], I built a payroll tool on Zcash where every payment is private on chain, but the accountant holds viewing keys for every account and gets a reconciliation of each payroll run from the chain: dollars funded against dollars paid, with the difference explained, exported to Xero or QuickBooks. Could you spend ten minutes with the demo keys and tell me whether this would replace work you do by hand today? Link: [hosted URL]/app/accountant, keys: [link to judge kit].

### Reply to keep for the submission

When someone tries it, ask: "Can I quote you in my hackathon submission, with your name and team, or anonymously?" Record each answer in docs/SUBMISSION.md under Demand validation.
