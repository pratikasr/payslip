# Payslip design

The design system, the research it is based on, and the behaviour of every screen in `web/`. Written 5 Oct 2026. The code is the source of truth for exact values; this document says what they are and why.

## Contents

1. Research notes
2. Design principles
3. Visual direction
4. Color tokens and contrast
5. Type, spacing, radius, elevation
6. Numbers, identifiers and dates
7. Status vocabulary
8. Component inventory
9. Screens and their states
10. Role flows
11. Accessibility and performance
12. Verified facts used by the web app

## 1. Research notes

Seven products were studied on 5 Oct 2026: five finance or product-tool leaders and two crypto payroll and treasury products. Where a page refused automated fetching (Deel, Mercury and Request Finance help centers, Rippling's site) it was read through a reader proxy or by viewing the product screenshots on the page. Mercury's public demo was rendered and inspected. Anything not visible on a fetched page is marked "not confirmed".

### Deel

Sources: help.letsdeel.com/hc/en-gb/articles/14145053795857, /4407737772689, /18940617896593; deel.com/global-payroll; deel.com/blog/deel-update-payments-invoices-contracts-more

- A small, defined set of payment statuses (Processing, Approved, Complete, Cancelled, Failed), each explained in one sentence; bank transfers add "Waiting for funds to arrive".
- Payroll cycle badges carry the deadline ("Approval is due today").
- Review and approve are separate steps. The approval dialog restates the entity and period; the buttons say exactly what happens ("Yes, Approve Payroll", "No, Go Back").
- The pay flow is four steps, and the fee breakdown and exact conversion rate are shown before money moves.
- Payments are split by lifecycle: Unpaid, Processing, Payment History with timestamps.
- Statements download as PDF or CSV in detailed and summary views.
- Not confirmed: in-app font, how long IDs are copied.

### Rippling

Sources: rippling.com/products/payroll; rippling.com/blog/rippling-payroll-review (product screenshots on both pages)

- Running payroll is a wizard ("Step 1 of 2") with a thin progress bar and a sticky footer holding Back and one primary action.
- The editable grid mutes zero values in grey so non-zero amounts stand out.
- A person drawer opens with a summary strip, label above value.
- "Compare to last pay run" puts the current value on top and the change underneath.
- Multi-currency amounts show sign, symbol and ISO code ("+$1,400.00 CAD").
- Not confirmed: font.

### Mercury

Sources: demo.mercury.com/transactions and /home (rendered); mercury.com/blog/updated-transactions-page; support.mercury.com articles 28768700685844 and 28768764276756

- Amount column right-aligned; money in is green, money out stays in the text color with a true minus sign (U+2212); no plus sign.
- Failed rows strike the amount through and add a small red "Failed" pill. The row is never removed.
- A summary strip above the table: net change, money in, money out. Charts abbreviate; tables never do.
- Rows about 50 px tall, hairline separators, no zebra stripes, small muted headers.
- Long account numbers are masked to the last four digits.
- A dismissible onboarding checklist teaches the next action.
- Exports everywhere: all or filtered, CSV or XLSX; monthly statements per account.
- Font: the app loads Arcadia Text and Arcadia Display at weights 400 and 480. Tabular figures not confirmed.

### Ramp

Sources: support.ramp.com/managing-bills-and-payments-on-bill-pay; support.ramp.com/bill-pay-payment-release; support.ramp.com/hc/en-us/articles/4417836454419; ramp.com/bill-pay; builders.ramp.com/post/bootstrapping-a-ui-component-library

- Views follow the lifecycle (Drafts, For approval, Payment required, In-flight, History).
- Explicit statuses with a separate release step; three named dates per payment (due, payment date, estimated arrival).
- A timeline on the record page (scheduled, mailed, paid).
- Batch cards: count, total, due date, each label above value, one "Release all" action.
- The component library gives colors semantic names (destructive, constructive) rather than hues.
- Not confirmed: in-app font.

### Linear

Sources: linear.app/now/how-we-redesigned-the-linear-ui; linear.app/now/behind-the-latest-design-refresh; linear.app/changelog/2026-03-12-ui-refresh; linear.app/docs/display-options; linear.app/now/invisible-details

- "Structure should be felt, not seen": fewer and softer separators, chrome dimmer than content.
- Theme colors generated in LCH from a base, an accent and a contrast value, which yields high-contrast themes automatically.
- Inter Display for headings, Inter for text; marketing CSS shows tabular numbers and a small set of weights.
- Short IDs with keyboard copy shortcuts; menus show their shortcuts.
- Not confirmed: empty states.

### Request Finance (crypto payroll)

Sources: help.request.finance/en/articles/8624295-how-to-run-payroll; requestfinance.com/blog/crypto-mass-payments-guide

- Status tabs show counts; filters by network, currency and date; search accepts a wallet address.
- The empty state keeps the column headers and gives one sentence plus the primary action.
- Contract currency (USD) and payment currency (USDC on a chain) are separate fields: the same split as Payslip's USD basis versus ZEC paid.
- Addresses shortened in the middle ("0xEc4...083A"); the asset shows its network.
- Batch results show total, recipient count and payout method, exportable to CSV, timestamped and attributed.

### Safe (crypto treasury)

Sources: github.com/safe-global/safe-wallet-monorepo (address display, copy button, formatters, transaction status); help.safe.global/articles/7125131043

- Address display: optional name, chain prefix, shortened address (first 6, last 4), copy button, explorer button.
- Copy confirms in place (the icon turns into a check).
- Plain statuses with an action-oriented variant when the viewer must act ("Needs your confirmation").
- A signing timeline (Created, Signed 1 of 2, Executed). Hash copy and explorer buttons are disabled with an explanation until the transaction exists.
- CSV export with a date range and stable columns including the transaction hash.

### What Payslip takes from this

| Pattern | Seen in | Where Payslip uses it |
| --- | --- | --- |
| Right-aligned tabular figures, full precision in tables | Mercury, Linear | Every amount column; `.num` utility |
| True minus sign | Mercury | `formatUsd`, `formatZec` |
| Lifecycle grouping with counts | Ramp, Request Finance | Runs list filters |
| Wizard with a thin progress bar | Rippling | Run stepper: Fund, Execute, Paid |
| Restate totals before money moves | Deel | Fund step shows the exact amount, chain and address |
| Failed rows stay, amount struck through | Mercury | Pay lines |
| Middle truncation, copy, explorer link | Safe, Request Finance | `Hash` component |
| Empty state: one sentence, one action | Request Finance, Mercury | Every list |
| Summary strip, label above value | Rippling, Ramp, Mercury | Treasury, run summary, statement and reconciliation totals |
| Onboarding checklist | Mercury | Payer overview setup checklist |
| Exports with stable columns | Deel, Mercury, Safe | Service CSV for statements and reconciliation |

## 2. Design principles

1. **The chain is the record.** Every figure on screen comes from the service; nothing is invented. The only illustrative values are on the landing page, labelled as such.
2. **Two amounts, always labelled.** ZEC is what moved; USD basis is what it was worth at the run's fill rate. Both carry their unit or column header.
3. **Show what is hidden.** Privacy is the product, so the interface shows it: redaction bars stand where the explorer sees nothing.
4. **Errors name the fix.** Every error shows the service's message and its `hint`. "Service is not reachable" says how to start it.
5. **Empty states teach the next action** in one sentence with one button.
6. **Nothing is silently dropped.** Unlabelled and pending lines get their own sections, even when empty.
7. **Quiet chrome, loud numbers.** Hairline borders, no decorative shadows or gradients, one accent reserved for the primary action, focus and progress.
8. **Plain words for statuses**, each defined once (section 7).
9. **Keys are handled with care.** Spending material is refused before it leaves the browser; viewing keys stay in the tab.
10. **Light by default, dark on request.** First visit follows the system; the header toggle remembers a choice.

## 3. Visual direction

- **Memorable element: the redaction bar.** A solid rounded bar (`--redact`) stands in for a value that exists on chain but is encrypted. It appears on the landing comparison, in the run page's "What the Zcash explorer shows" panel, and in the logo, where one line of the payslip is written and one is sealed in gold.
- **Accent: Zcash gold** `#f4b728`, used only for primary buttons, the current step, focus rings in dark mode and the sealed line in the logo. Text on gold is near-black (10.06:1).
- **Neutrals are cool slate**, not warm cream, so the gold reads as a signal rather than a theme.
- **Layout:** a top bar with the role switch and live network badge; payer pages add a second row of tabs. Content is left-aligned in a 72rem column. Panels are bordered sections with a header row, used for real groups of data rather than a grid of identical cards.
- **Motion:** none on load. Only responses to actions (dialog open, copy check mark, progress bar width, spinner on sync). `prefers-reduced-motion` turns transitions off.

## 4. Color tokens and contrast

Defined in `web/src/app/globals.css` as CSS variables and exposed to Tailwind (`bg-card`, `text-muted-foreground`, `text-success`, and so on). Contrast ratios computed with the WCAG 2.1 relative luminance formula on 5 Oct 2026. Targets: 4.5:1 for text, 3:1 for focus rings, input borders and other non-text indicators.

### Light

| Token | Hex | Use |
| --- | --- | --- |
| `--background` | `#f6f7f9` | Page |
| `--card` | `#ffffff` | Panels, inputs, dialogs |
| `--foreground` | `#14171c` | Text |
| `--muted-foreground` | `#575f6d` | Secondary text, table headers |
| `--muted` | `#edeff2` | Subtle fills, hover, active tab |
| `--border` | `#dee1e6` | Hairlines |
| `--input` | `#8c94a2` | Form control borders |
| `--primary` | `#f4b728` | Primary button fill |
| `--primary-foreground` | `#1c1503` | Text on primary |
| `--primary-edge` | `#b3820e` | Primary button border, selected outlines, active tab underline |
| `--ring` | `#9a6400` | Focus outline |
| `--link` | `#8a5a00` | Inline links |
| `--success` / `--success-bg` | `#12703a` / `#e6f4eb` | Confirmed, paid, reconciled |
| `--destructive` / `--danger-bg` | `#b42318` / `#fceae8` | Failed, errors |
| `--warning` / `--warning-bg` | `#8a5a00` / `#fdf3d7` | Awaiting, not shared, degraded |
| `--info` / `--info-bg` | `#2f4a7a` / `#e8eef8` | In progress, notes |
| `--redact` | `#2a2f38` | Redaction bars |

| Pair | Ratio | Target |
| --- | --- | --- |
| foreground on background | 16.76 | 4.5 |
| foreground on card | 17.96 | 4.5 |
| muted-foreground on background | 6.00 | 4.5 |
| muted-foreground on card | 6.44 | 4.5 |
| muted-foreground on muted | 5.59 | 4.5 |
| primary-foreground on primary | 10.06 | 4.5 |
| link on card | 5.93 | 4.5 |
| ring on card | 5.00 | 3 |
| ring on background | 4.67 | 3 |
| input border on card | 3.06 | 3 |
| primary-edge on card | 3.43 | 3 |
| success on success-bg | 5.44 | 4.5 |
| destructive on danger-bg | 5.66 | 4.5 |
| warning on warning-bg | 5.36 | 4.5 |
| info on info-bg | 7.57 | 4.5 |
| muted-foreground on warning-bg | 5.82 | 4.5 |
| muted-foreground on danger-bg | 5.54 | 4.5 |
| redact on card | 13.44 | 3 |

### Dark

| Token | Hex |
| --- | --- |
| `--background` | `#0e1116` |
| `--card` | `#151920` |
| `--foreground` | `#e8ebf0` |
| `--muted-foreground` | `#9ba3b1` |
| `--muted` | `#1d222b` |
| `--border` | `#2a303a` |
| `--input` | `#5f6876` |
| `--primary` | `#f4b728` |
| `--primary-foreground` | `#1c1503` |
| `--primary-edge` | `#f4b728` |
| `--ring` | `#f4b728` |
| `--link` | `#f6c453` |
| `--success` / `--success-bg` | `#5ccb8a` / `#12291c` |
| `--destructive` / `--danger-bg` | `#ff8a80` / `#33171a` |
| `--warning` / `--warning-bg` | `#f6c453` / `#2e2512` |
| `--info` / `--info-bg` | `#9db7e8` / `#17223a` |
| `--redact` | `#c9ced6` |

| Pair | Ratio | Target |
| --- | --- | --- |
| foreground on background | 15.83 | 4.5 |
| foreground on card | 14.74 | 4.5 |
| muted-foreground on background | 7.45 | 4.5 |
| muted-foreground on card | 6.94 | 4.5 |
| muted-foreground on muted | 6.28 | 4.5 |
| primary-foreground on primary | 10.06 | 4.5 |
| link on card | 10.86 | 4.5 |
| ring on card | 9.78 | 3 |
| input border on card | 3.13 | 3 |
| success on success-bg | 7.62 | 4.5 |
| destructive on danger-bg | 7.20 | 4.5 |
| warning on warning-bg | 9.31 | 4.5 |
| info on info-bg | 7.82 | 4.5 |
| muted-foreground on danger-bg | 6.47 | 4.5 |
| redact on card | 11.15 | 3 |

### Print

Under `@media print` every token falls back to black on white with 0.5 pt grey rules, so statements print cleanly regardless of theme.

## 5. Type, spacing, radius, elevation

**Typeface.** Geist Sans for everything, Geist Mono only for long identifiers (txids, addresses, keys, run ids), where fixed width helps people compare characters. Both come from the `geist` npm package through `next/font`, so builds need no network. Numbers use tabular figures (`.num`) wherever they line up in columns.

| Step | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Display | 40 px mobile, 52 px desktop / 1.05, tracking -0.03em | 600 | Landing headline only |
| Title | 24 px / 32 | 600 | Page titles |
| Heading | 20 px / 28 | 600 | Statement and reconciliation titles |
| Figure | 18 px / 28 | 500 | Stat values |
| Lead | 18 px / 1.6 | 400 | Landing paragraph |
| Body | 14 px / 20 | 400 | App text, table cells |
| Small | 12 px / 16 | 400 to 500 | Table headers, labels above values, help text |
| Print | 10.5 pt body, 8 pt table cells, 7 pt full txids | | Statements on paper |

Sentence case everywhere. No all-caps labels.

**Spacing.** 4 px base (Tailwind scale): 4, 8, 12, 16, 24, 32, 40, 64. Panels pad 16 px; page sections are 24 px apart; the landing uses 56 to 96 px between sections. Table rows are 44 px tall with 12 px horizontal cell padding and 16 px at the panel edge.

**Radius.** `--radius` is 8 px: buttons, inputs and panels use it; small buttons 6 px; dialogs 12 px; redaction bars 3 px. Badges and status pills are fully rounded.

**Elevation.** Panels have a 1 px border and no shadow. Only floating layers (dialogs, menus, toasts) get a ring and a soft shadow. The sticky header uses a translucent background with blur.

## 6. Numbers, identifiers and dates

Implemented in `web/src/lib/format.ts`; all from integers, never floating point.

| Kind | Rule | Example |
| --- | --- | --- |
| ZEC | Always 8 decimals, thousands separators, from zatoshis | `3.54262000`, `21,000.00000000` |
| USD | 2 decimals, thousands separators, `$` prefix, from cents | `$28,462.15` |
| Negative | True minus sign U+2212 | `−$12.15` |
| Rate | USD per ZEC to 2 decimals; exact 6-decimal value in the tooltip | `$1,354.93 per ZEC` |
| Testnet rate | Labelled "Testnet fixed rate" wherever a rate shows on testnet | |
| Height | Thousands separators | `4,465,123` |
| Date | Day, short month, year, UTC | `5 Oct 2026` |
| Timestamp | Date plus 24-hour time and the zone | `5 Oct 2026, 11:42 UTC` |
| Log time | `11:42:10 UTC` | |
| Period | Short month and year | `Sep 2026` |
| Range | "to", never a dash | `1 Sep 2026 to 30 Sep 2026` |
| Txid, address, key | Middle truncation, full value in the tooltip, copy button, explorer link when the API gives `explorer_url` | `3c5513c5…83bd08` |
| Token amount | As the venue states it, grouped | `28,462.150000 USDC` |

Month names come from a fixed table rather than `Intl`, so the server and every browser render the same string. Native date inputs show the browser's locale format, so the chosen range is repeated underneath in the unambiguous format. Explorer links always come from the API (`explorer_url`, `allocation_explorer_url`); the web app never builds a Zcash explorer URL itself.

## 7. Status vocabulary

| Run status | Label | Meaning shown to the user |
| --- | --- | --- |
| `draft` | Draft | Created. Fund it to continue. |
| `awaiting_funds` | Awaiting funds | Waiting for the USDC deposit to reach the swap venue. |
| `funded` | Funded | ZEC is in the treasury. Execute the run to pay. |
| `swapping` | Swapping | The venue is converting USDC to ZEC. |
| `swapped` | Swapped | ZEC received at the recorded fill rate. |
| `allocating` | Allocating | Moving each line's ZEC from the treasury to the contractor's account. |
| `paying` | Paying | Broadcasting one shielded payment per contractor. |
| `paid` | Paid | Every line is paid. |
| `failed` | Failed | The run stopped. Read the error, fix it, then resume. |

| Pay line status | Label | Meaning |
| --- | --- | --- |
| `pending` | Pending | Not started yet. |
| `allocated` | Allocated | ZEC moved to this contractor's account; payment not sent yet. |
| `broadcast` | Broadcast | Sent to the network; waiting to be mined. |
| `confirmed` | Confirmed | Mined in a block. |
| `failed` | Failed | Did not go through. Resume the run to retry it. |

| Funding status | Label |
| --- | --- |
| `awaiting_deposit` | Awaiting deposit |
| `processing` | Processing |
| `success` | Received |
| `refunded`, `failed`, `expired` | Refunded, Failed, Expired (with "Request a new deposit address") |

| Reconciliation status | Label | Meaning |
| --- | --- | --- |
| `reconciled` | Reconciled | Funded minus paid equals the ZEC not paid out, valued at the fill rate. |
| `variance_unexplained` | Unexplained variance | The variance is larger than fees plus unspent ZEC can explain. |
| `missing_funding_record` | No funding record | Payments found, but no funding visible with these keys. Include the treasury key. |
| `incomplete` | Incomplete | Some lines are not mined yet or not visible with these keys. |

Tones: neutral (grey), progress (info blue), success (green), warning (amber), danger (red). A colored dot always sits next to a word, so color is never the only signal.

## 8. Component inventory

| Component | File | Notes |
| --- | --- | --- |
| Button, Input, Textarea, Label, Dialog, Tabs, RadioGroup, Skeleton, Sonner toaster | `web/src/components/ui/` | shadcn/ui on Radix, tuned: 36 px default height, gold primary with an edge, 2 px focus outline |
| Table | `ui/table.tsx` | Scrolls inside its own focusable, labelled region; `numeric` cells right-align with tabular figures |
| NativeSelect | `ui/native-select.tsx` | Styled native `<select>` (lighter and better on phones than a custom listbox) |
| AppHeader, PayerNav, Logo, ThemeToggle | `components/app`, `components/payer` | Role switch with `aria-current`; payer tabs |
| NetworkBadge, ServiceStatus, HealthWarnings, HealthProvider | `components/app` | One `GET /api/health` for the app, refreshed every 30 s; warnings and degraded state |
| ErrorState, EmptyState, TableSkeleton, PageHeader, Panel, Stat | `components/app/states.tsx` | The building blocks of every screen state |
| Zec, Usd, Rate | `components/app/amount.tsx` | Formatting rules from section 6 |
| Hash, CopyButton | `components/app` | Middle truncation, copy with check mark and toast, explorer link |
| Badge and status maps | `components/app/status-badge.tsx` | Section 7 |
| QrCode | `components/app/qr-code.tsx` | Client-rendered SVG, black on white in both themes |
| ScanDialog, QrScanner, KeyStatus | `components/keys` | Camera scanning with a photo fallback; key classification message |
| ContractorFormDialog, ShareKeyDialog, ExportKeysDialog | `components/payer` | Add and edit, share one key, export all keys |
| RunsTable, NewRunForm, RunStepper, FundStep, WalletPay, RunDetail, RunComparison | `components/payer` | The run lifecycle |
| PeriodPicker, StatementLinesTable, UnlabelledTable, FundingTable, StatementActions, KeyCollection | `components/statement` | Contractor statement and accountant reconciliation |

Every table that matters on a phone (contractors, runs, pay lines, statement lines) switches to stacked rows below 768 px; wider secondary tables scroll inside their container. The page itself never scrolls sideways (checked at 375 px on every route).

## 9. Screens and their states

"Offline" below means the service is unreachable; the error names the URL and says "Start it with: cd service && cargo run", plus the `PAYSLIP_WEB_ORIGIN` setting when a CORS block is the cause.

### `/` Landing

- Content: headline "Private to the world, transparent to your accountant.", one paragraph, Launch app and Read the code, the explorer versus accountant comparison (labelled as an illustration), How it works in three steps, Who sees what table, footer with the GitHub link and "Built on Zcash".
- States: static; no data is fetched.

### `/app` Role chooser

- Content: three role links with one-line descriptions, network status (network, chain tip, wallet synced height, venue).
- Loading: skeleton figures. Error: offline state with retry. Degraded: the service's warnings listed under the status.

### `/app/payer` Overview

- Loading: skeletons for treasury, runs and contractors.
- Empty: setup checklist (add contractors, share keys, create a run, fund and execute) with the next step highlighted; "No runs yet" with Create a run.
- Error: a single offline state for the page, or a compact error inside the panel that failed.
- Success: treasury spendable, pending and total ZEC, synced height, treasury address; Sync wallet (toast "Wallet synced to height N"); recent runs; key sharing count with a nudge when keys are unshared.

### `/app/payer/contractors`

- Loading: table skeleton. Empty: "Add your first contractor" with the button. Error: offline or API error with hint.
- Add or edit dialog: name, optional email, unified address (checked for network and pool before sending), settlement (Hold ZEC or Convert to USDC with payout chain and EVM address). Service errors land on the field they concern (`invalid_address`, `address_without_shielded_receiver`, `duplicate_address`, `payout_address_required`).
- Share viewing key dialog: loading skeleton, error with retry, then QR, key text with copy and download, network and birthday height, Mark as shared.
- Export dialog: network, key count, birthday height, list of labels, Copy JSON and Download JSON (`payslip-viewing-keys-<network>-<date>.json`).
- Archive dialog: explains past payments stay; shows `contractor_in_active_run` with its hint.

### `/app/payer/runs`

- Loading: skeleton. Empty: "No runs yet" with Create your first run. Filtered empty: says which statuses would appear. Error: offline or API error.
- Success: filters All, To fund, In progress, Paid, Failed with counts; period, status, contractors (paid of total while paying), totals, created date.

### `/app/payer/runs/new`

- Loading: skeleton. Empty: "Add contractors before creating a run". Error: offline.
- Form: period defaults to the previous calendar month; one row per contractor with include tick, USD amount and invoice reference; live total. Validation: at least one line, amounts above zero with at most two decimals, invoice reference up to 64 characters, start not after end. The idempotency key is generated once per form, so a double submit returns the same run. Server errors (`invalid_amount`, `invalid_period`, `unknown_contractor`, `duplicate_contractor_line`, `invoice_ref_too_long`) show with their hint.

### `/app/payer/runs/[id]`

- Loading: header and table skeletons. Error: offline or `not_found` with hint.
- Stepper: Fund, Execute, Paid; a failed run shows the failure on the step it stopped in (`failed_from`).
- Fund, testnet venue: note that the testnet fixed-rate venue draws from the treasury, Confirm funding; `treasury_insufficient` shows the hint with the treasury address. Draft runs offer Discard draft.
- Fund, real venue: origin chain and refund address, Get deposit address; then the exact amount, chain, deposit address with QR and copy, token contract, quote deadline, Pay with a browser wallet (connect, switch chain, send, deposit transaction link), and polling every 5 seconds. Expired, refunded or failed quotes offer Request a new deposit address.
- Execute: Execute run; while executing, payments sent and confirmed with a progress bar. Failed: the run error with its hint and Resume run.
- Paid: confirmation with Share viewing keys and Open accountant view.
- Always: pay lines (status, txid with copy and explorer link, height, failed lines struck through with their error), run summary (owed, ZEC paid, fill rate or testnet fixed rate, fees, funded, ZEC acquired, allocation transaction), the comparison panel built from the run's own lines, and the activity feed (history from `GET /log`, then live). A live indicator shows the stream state.

### `/app/contractor`

- Input: viewing key by paste or QR scan (camera, or a photo of the code), period presets and dates. The key is checked as typed: seed phrases and spending keys are refused with a warning, incoming viewing keys, addresses and Sapling-only keys are explained, wrong network is caught before sending.
- Loading: "Scanning the chain with your key" with a table skeleton. Empty (no key yet): explains what the statement will contain. Error: API error with hint (for example `lightwalletd_unreachable`).
- Success: title with the account label, period, network, scanned height, generated time, fingerprint; totals; payments with running totals; pending (only when present); unlabelled (always shown, with "No unlabelled transactions" when empty); funding into the account (collapsed, opened automatically for print); Export CSV and Print / Save as PDF.

### `/app/accountant`

- Input: Paste (live-parsed, one key per line), Import file (the payer's JSON export; labels shown locally, never sent), Scan QR (one at a time, appended). The key list shows each entry as ready or refused with the reason; only ready keys are sent.
- Loading: "Scanning the chain with these keys" with a skeleton. Empty: explains the reconciliation. Error: API error with hint.
- Success: totals (funded, paid, variance, paid ZEC, lines); a notice when the Treasury key is missing; runs table (status, funded USD, ZEC acquired, fill rate or testnet fixed rate, paid USD and ZEC, fees, unspent, variance, explained) with totals; all pay lines filterable by contractor; pending; unlabelled; Export CSV and Print.

### Not found

A short page with Open the app and Home.

## 10. Role flows

### Payer

1. Open `/app`, choose Payer. If the service is offline, the page says how to start it.
2. Overview shows the treasury. On testnet, fund the treasury address from a faucet, then Sync wallet.
3. Contractors: Add contractor with name, unified address and settlement choice. Repeat for each person.
4. For each contractor, Share viewing key: send the key text or let them scan the QR, then Mark as shared.
5. Export all viewing keys for accountant and send the JSON file privately.
6. Runs, New run: check the period, enter USD amounts and invoice references, Create run.
7. Fund: on testnet, Confirm funding. On mainnet, choose the origin chain and refund address, Get deposit address, then Connect Wallet and send, or send the exact amount from any wallet. The page moves on when the venue reports the ZEC in the treasury.
8. Execute run. Watch each line go from Pending to Confirmed with its txid and height.
9. Paid: open any txid in the explorer and see a shielded transaction with no amount or parties; the comparison panel shows what a public chain would have exposed.

### Contractor

1. Receive the viewing key from the payer (text or QR).
2. Open `/app/contractor`, paste the key or Scan QR code.
3. Choose a period (Year to date by default) and Show statement.
4. Read each payment: date, ZEC, USD basis, rate, invoice, period, txid, height, running totals.
5. Export CSV for bookkeeping, or Print / Save as PDF for a clean statement.

### Accountant

1. Receive the payer's viewing key export file.
2. Open `/app/accountant`, Import file (or paste keys, or scan them one by one).
3. Choose the period and Reconcile.
4. Check each run: funded USD against paid USD, and whether the variance is explained by network fees and unspent ZEC at the fill rate. A missing Treasury key is called out.
5. Filter pay lines by contractor, review pending and unlabelled transactions, Export CSV.

## 11. Accessibility and performance

- Landmarks: one `banner` header, `main#main` with a skip link, labelled `nav` regions, headed sections.
- Every input has a label; errors are tied to inputs with `aria-describedby` and `aria-invalid`; alerts use `role="alert"`, live progress uses `aria-live` and a `progressbar`.
- Visible 2 px focus outline in `--ring` on every interactive element; all actions reachable by keyboard; scrollable tables are focusable regions.
- Status is never color alone (dot plus word, struck-through amount plus Failed badge).
- Lighthouse 13.5.0, default mobile profile, production build (`next start`), 5 Oct 2026:

| Route | Performance | Accessibility | Best practices |
| --- | --- | --- | --- |
| `/` | 96 | 100 | 100 |
| `/app` | 96 | 100 | 100 |
| `/app/payer` | 95 | 100 | 100 |
| `/app/payer/contractors` | 94 | 100 | 100 |
| `/app/payer/runs` | 95 | 100 | 100 |
| `/app/payer/runs/new` | 95 | 100 | 100 |
| `/app/payer/runs/[id]` | 93 | 100 | 100 |
| `/app/contractor` | 94 | 100 | 100 |
| `/app/accountant` | 94 | 100 | 100 |

Final pass after the screenshot reviews, with the service running on testnet and real runs loaded (the first pass, with the service down, scored best practices 96 for console errors). Two fixes came out of it: the run page renders the run on the server for its first paint (performance 89 to 93, LCP 3.8 s to 3.2 s), and the payer overview's statistics list no longer holds a paragraph inside its `<dl>` (accessibility 96 to 100).

  The app routes lose 4 best-practice points for console errors logged by the browser when the service is unreachable, which it was during that run.
- First-load JavaScript: 106 kB shared; landing 126 kB; heaviest route (accountant) 172 kB. wagmi, viem and RainbowKit load only when the Fund step needs them; the QR scanner and its WebAssembly load only when a scan dialog opens.

## 12. Verified facts used by the web app

Checked 5 Oct 2026. These belong in `docs/TECH-DECISIONS.md` under Verified facts.

- npm registry: `next` latest 15.x is 15.5.27 (16.3.8 is latest overall; 15 is pinned per ADR-003). `react` 19.3.0. `tailwindcss` 4.3.3. `wagmi` latest 2.x is 2.19.5 (3.7.7 is latest overall); `@rainbow-me/rainbowkit` 2.2.11 declares `wagmi ^2.9.0` as a peer, so wagmi stays on 2.x. `viem` 2.57.2 (2.57.3 was under one day old and blocked by pnpm 11's minimum release age). `@tanstack/react-query` 5.104.1. `qrcode.react` 4.2.0. `barcode-detector` 3.2.2 with `zxing-wasm` 3.1.3. `@playwright/test` 1.63.0. Source: `npm view <pkg> dist-tags`.
- ZIP 316: unified full viewing key prefixes are `uview` (Revision 0) and `uvf` (Revision 2) on mainnet, `uviewtest` and `uvftest` on testnet; incoming viewing keys `uivk`, `uvi` (and `test` variants); addresses `u`, `zu`, `tu` (and `test` variants). ZIP 316 defines no encoding for unified spending keys. Source: https://zips.z.cash/zip-0316
- ZIP 32: Sapling extended spending keys `secret-extended-key-main` and `-test`; Sapling extended full viewing keys `zxviews` and `zxviewtestsapling`; Orchard extended spending keys `secret-orchard-extsk-main` and `-test`. Source: https://zips.z.cash/zip-0032
- The running Payslip service on testnet issues UFVKs with the `uvftest` prefix (observed via `GET /api/viewing-keys`).
- RainbowKit 2.2.11 `connectorsForWallets` passes the project id only to WalletConnect-based wallets; `injectedWallet` never reads it, so an injected-only configuration works with an empty id. Source: `node_modules/@rainbow-me/rainbowkit/dist/index.js`.
- `@coinbase/cdp-sdk` 1.57.1 (pulled in by wagmi's Base Account connector) statically imports optional peers `@x402/*`; they are aliased to empty modules in `web/next.config.ts` because Payslip never uses that connector.

## 13. Screenshot reviews

Screens are captured by `web/scripts/screenshots.mjs` (every route) and `web/scripts/screenshots-states.mjs` (statement, reconciliation, share-key dialog and dark mode, using real testnet data from the running service) at 375, 768 and 1440 px into `docs/screenshots/`. Both scripts report any page wider than the viewport; neither pass found one.

### Pass 1, 5 Oct 2026

| Finding | Fix |
| --- | --- |
| Testnet amounts were labelled ZEC; testnet coins are TAZ | Units come from the service's network: values, table headers and stat labels show TAZ on testnet and ZEC on mainnet |
| Landing hero: the memo value broke inside the invoice reference ("INV-" / "2026-014") | The reference never wraps |
| Accountant runs table clipped its last column at 1440 px | App shell widened to 1,360 px and the table's minimum width tightened; it fits at 1440 and scrolls inside its card below that |
| Accountant runs table at 375 px showed two columns and a sideways scroll | Stacked run cards below the md breakpoint: period, status, funded, paid, variance, explained, paid coin, fees, run id |
| Payout and origin chains offered Optimism and Polygon, which the service does not route | Options match the service: Base, Arbitrum, Ethereum |
| A converting pay line appeared as an unlabelled outflow and its run as zero lines | Service fix: the statement engine pairs the venue deposit with the memo on the change output regardless of which account the deposit lands in; lines show "Converted to USDC via the venue" |
| The Convert to USDC option did not say what it gives up | The option now states that the venue's explorer shows that payment's amount and USDC address |

### Pass 2, 5 Oct 2026

| Finding | Outcome |
| --- | --- |
| Runs table at 1440 px | Fits, all eleven columns visible |
| Runs at 375 px | Cards, no sideways scroll |
| Unit labels | TAZ throughout on testnet |
| Long unlabelled list on testnet | Kept: faucet and fund-recycling deposits carry no Payslip memo and nothing is hidden. Recycling transfers now carry a descriptive memo |
| Sticky header shown mid-page in full-page captures | Capture artifact of a sticky header in a scrolled page, not a layout defect |
