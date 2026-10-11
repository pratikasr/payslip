# Payslip design

The design system, the research it is based on, and the behaviour of every screen in `web/`. Written 5 Oct 2026. The code is the source of truth for exact values; this document says what they are and why.

Section 15 supersedes the visual direction, tokens, layout and navigation in sections 2 to 9 and 14: on 5 Oct 2026 the owner rejected the first look as too basic and approved a redesign whose layout conventions are informed by Mercury's banking app, with Payslip's own mark, colour and components. The earlier sections remain as the record of what was tried. Their routes (`/app/...`) and file paths (`components/payer`, `components/statement`, `components/landing`, `components/insights`, `components/app/status-badge.tsx`, `ui/table.tsx`, and the `screenshots-states.mjs` and `screenshots-live.mjs` scripts) belong to the first build and no longer exist; section 15 gives the current structure, and `web/scripts/screenshots.mjs` is the one screenshot script.

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
13. Screenshot reviews
14. Round 6: storytelling, first run, insights and demo polish
15. Redesign: layout informed by Mercury's banking app

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

One word per state, defined once in `web/src/components/runs/run-meta.tsx` and drawn by the one `StatusTag` (`web/src/components/ds/status.tsx`): a 13px tag on a tint with the state's sentence in its tooltip. Tones: neutral (grey) for normal states, success (green) only for a run that is paid, warning (amber) for something that needs the payer, danger (red) for a failure, and a dot beside the word for a state that is still moving. Colour is never the only signal: the word is always there. The table below replaces the first build's vocabulary (updated 5 Oct 2026).

| Run status | Tag | Meaning shown to the user |
| --- | --- | --- |
| `draft` | Draft | Approved. Fund it to continue. |
| `awaiting_funds` | Awaiting funds (amber) | Waiting for the USDC deposit. |
| `funded` | Ready to pay | Funds are in the treasury. Pay to send. |
| `swapping`, `swapped`, `allocating`, `paying` | Paying (dot) | One word for the executor's steps; the run page says which step in plain words. |
| `paid` | Paid (green) | Every payment is confirmed on chain. |
| `failed` | Failed (red) | The run stopped. Open it to resume. |
| `cancelled` | Cancelled | Closed before any money reached it. Nobody was paid. |
| awaiting funds with a closed quote | Quote expired (amber), Refunded (amber), Swap failed (red) | What happened to the funding, when that is the news. |

Approvals (sign-in on with `PAYSLIP_APPROVALS_REQUIRED` above 0; `web/src/lib/approvals.ts`, shown by `components/runs/approvals.tsx` on the run page's next-action card and the Pay step; nothing of this appears with sign-in off). One sentence, the same everywhere, with Approve beside it for a member who may give the next approval; the service decides and the page only hides a button it would refuse.

| Approval state | Sentence | Where it leads |
| --- | --- | --- |
| none recorded, one required | Waiting for one approval. | Approve, for an admin or approver. |
| none recorded, two or more required | Waiting for two approvals. | Approve, for an admin or approver who did not create the run; the creator reads "You created this run, so its approvals come from other admins or approvers." |
| some recorded, more needed | Approved by Amara, waiting for one more. | Approve, unless the reader already approved ("You approved it; another admin or approver gives the next approval."). On a funded run the card says "Funded, waiting for one more approval" and Pay is disabled. |
| count met | Approved by Amara and Ben. | Fund run, or Pay. |
| Review step, one required | Approve | Creates the run and records the first approval ("This is recorded as the run's approval."). |
| Review step, two or more required | Send for approval | Creates the run; "Two other admins or approvers must approve the run before anything is paid; I cannot approve a run I created." |
| audit trail | Approved by Amara (admin), "Approval 1 of 2."; Waiting for one more approval before the swap is recorded (amber) | The run's log lines, in the timeline; with approvals on, the first entry reads "Created: 3 payments" rather than "Approved". |

| Pay line | Where payments are listed | Meaning |
| --- | --- | --- |
| `confirmed` | the gold Shielded mark (dot and word; "Shielded · USDC" for a line paid out as USDC), with the paid time when the service gives `confirmed_at` | Nothing is wrong, so the row says what makes it different: amount, sender and recipient are hidden on chain (the tooltip). No grey "Paid" chip. |
| `pending` | Waiting; Draft or Not sent when the run is a draft, cancelled or stopped | Not started yet. |
| `allocated` | Ready to send | Funds are in this contractor's account. |
| `broadcast` | Sent (dot) | Sent to the network, waiting to be mined. |
| in progress with an error | Waiting for funds or Retrying (amber, dot) | The service is still working on it. |
| `failed` | Failed (red), amount struck through | Did not go through. Resume the run to retry it. |

| Funding status | Tag |
| --- | --- |
| `awaiting_deposit` | Awaiting deposit |
| `deposit_seen` | Deposit seen (dot) |
| `processing` | Swapping (dot) |
| `incomplete` | Deposit too small (amber) |
| `success` | Received; on testnet Set aside (nothing arrives: coins already in the treasury are set aside) |
| `refunded`, `failed`, `expired` | Refunded (amber), Swap failed (red), Quote expired |
| `awaiting_deposit`, venue `treasury` (Fund with ZEC) | Awaiting ZEC |
| `deposit_seen`, venue `treasury` | ZEC arriving (confirming, or short: the shortfall is shown) |
| `success`, venue `treasury` | Funded |
| `expired`, venue `treasury` | Request expired (with "Request again"; ZEC already in the treasury counts) |

| Payslip access | Tag |
| --- | --- |
| `fvk_shared_at` set | Shared, with the day |
| not set | Not shared |

Reconciliation statuses belong to Books (`web/src/components/books/books-data.ts`, `statusView`) and are drawn by the same `StatusTag`: Reconciled (the run reconciles, within rounding when the Difference column says so), Unexplained variance, No funding record, Incomplete, and the keys and unpaid states the service reports.

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
| `/app/payer/runs/[id]` | 94 | 100 | 100 |
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

Screens were captured by `web/scripts/screenshots.mjs` (every route) and, in the first build, `screenshots-states.mjs` (statement, reconciliation, share-key dialog and dark mode, using real testnet data from the running service; removed in the redesign) at 375, 768 and 1440 px into `docs/screenshots/`. Both scripts report any page wider than the viewport; neither pass found one.

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

### Pass 3, 5 Oct 2026

Dark mode captured for every route at 375, 768 and 1440 px, plus the statement, reconciliation and share-key states. Keyboard-only flows automated in `web/e2e/keyboard.spec.ts`.

| Finding | Fix |
| --- | --- |
| No visible focus indicator on buttons, text inputs, text areas and tabs (Tailwind 4 `outline-none` zeroes the outline style that focus-visible reuses) | Buttons draw a solid 2 px accent outline on focus; inputs and text areas show their ring |
| Date fields lost the ring while a date segment had focus | Inputs also show the ring on `:focus-within` |
| Run activity printed block heights without separators | The service formats heights in activity messages (4,465,945) |

## 14. Round 6: storytelling, first run, insights and demo polish

Built 5 Oct 2026 for the four improvements the owner chose. Everything below reads from the service except the landing hero, which stays labelled as an illustration, and the testnet records on the landing page, which are copied from `docs/proof/` and were each checked on testnet.zecblock.com (all fifteen resolve at the recorded height as shielded transactions).

### Landing (`/`)

- **Unseal comparison** (`components/landing/unseal-demo.tsx`). The same pay line twice: the block explorer's copy stays sealed; on the accountant's copy a viewing key lifts each redaction bar in turn, left to right, and the pane edge turns gold. It plays once when it comes into view (about two seconds, so no pause control is needed under WCAG 2.2.2) and Replay runs it again. CSS keyframes only; reduced motion shows the opened state at once. This is the one deliberate exception to "no motion on load" in section 3. The memo is shown as its two real fields, period and invoice, so every row stays on one line.
- **Three roles, three views** (`components/landing/roles.tsx`). Payer, contractor and accountant, each with the keys they hold (the payer's spending key drawn in gold, viewing keys in ink, seven for an accountant with six contractors), what they can see and what they cannot. An "Everyone else" strip states what an explorer sees. Replaces the old Who sees what table.
- **See it on chain** (`components/landing/on-chain.tsx`, data in `testnet-proof.ts`). Both six-contractor rehearsals with every txid linked to the explorer, the allocation of each run, and the USDC-conversion example, badged Zcash testnet. No mainnet data is shown; the copy says the mainnet run is added to the README when it runs.
- The pitch, Launch app and How it works are unchanged. A proof line under the buttons links to the on-chain section.

### Payer first run (`components/payer/setup-guide.tsx`)

Five steps, each ticked from API state, never by hand: fund the treasury (testnet: done when spendable is above zero or a run was funded; shows the full treasury address with Copy address, Open the testnet faucet and Check for funds, which syncs the wallet; mainnet: an information step saying USDC funding happens per run), add contractors (links to `/app/payer/contractors?add=1`, which opens the Add dialog), share viewing keys (done when every contractor has `fvk_shared_at`), create the first run, fund and execute it (links to the newest unfinished run). A segmented bar shows progress; done steps show one line of state ("6 contractors, accounts 1 to 6"). Hide guide is remembered in localStorage and applied before first paint by the boot script, so a hidden guide never flashes; Show setup guide in the page header brings it back while setup is incomplete. The guide disappears when every step is done. The faucet URL is a constant from Verified facts (the API does not return one).

### Payroll insights (`components/insights/`, `lib/insights.ts`)

- **Overview panel**: Paid to date (large), Not paid yet, Network fees paid (with the per-payment average; USD only on mainnet, because the testnet fixed rate is not a price), Contractors paid; a column chart of payroll by period (paid at the base, not paid yet stacked above in the lighter step, continuous months so gaps read as gaps, at least six and at most twelve); paid by contractor as horizontal bars, highest first, values at the tips, the tail past eight folded into "others"; runs by status as one part-to-whole bar in the status tones with a count beside each label. Shown once a run exists.
- **Runs page strip**: Paid to date, Not paid yet (to fund and in progress counts), Network fees paid and a sparkline of paid USD by period (history in grey, latest period in the chart hue), linking to the full insights.
- **Method** (dataviz skill): the data hue is violet, outside every status tone so a series never reads as a status; light `#4a3aa7` and dark `#9085e9` pass all six checks against the card surfaces `#ffffff` and `#151920` (contrast 8.56 and 5.64). The ordinal pair for "not paid yet", light `#a99fe0` and dark `#5a50a8`, passes the ordinal checks (2.41 and 2.64 against the card). Tokens `--viz` and `--viz-soft` in `globals.css`. Bars at most 24 px with a 4 px rounded data end and a square baseline, 2 px surface gaps between stacked segments, solid hairline grid, axis labels abbreviated ($30.4K) while tooltips and tables give full cents. Every chart has a text summary for screen readers, a Charts or Tables switch that swaps all three for real tables with totals, and the period chart takes focus and reads each month with the arrow keys (announced in a live region) as well as on hover.

### Demo polish

- **Live run progress** (`components/payer/run-progress.tsx`). One segment per pay line that fills in stages as SSE snapshots arrive (allocated a third, broadcast two thirds with a slow pulse, confirmed full), in the same tones as the line badges, names under each segment for runs of eight or fewer, counts per stage in words, the confirmed count in large type and the allocation transaction with its height. Shown while executing and kept, complete, on the Paid step. Rows whose status, txid or height changed flash once (1.6 s) and the new badge, txid and height rise in; nothing animates on page load.
- **Bigger key numbers.** `Stat size="lg"` (28 to 32 px, proportional figures, smaller unit): run summary (total owed and total paid), statement totals (USD basis, received, payments), reconciliation totals (funded, paid, variance) under a new verdict banner ("Reconciled", "All N runs reconciled" or "N of M runs reconciled" with a count per other status; icon and words carry the state).
- **Presenter mode** (`lib/presenter.ts`, `components/app/presenter-mode.tsx`). `?present=1` or Alt+P (Option+P on a Mac; a modifier so a stray key never triggers it) sets `data-present` on the root, scales the root size to 118.75 percent (type and spacing together; breakpoints unchanged), and hides `data-secondary` chrome: panel descriptions, the theme toggle, the landing footer. It lasts for the browser tab (sessionStorage), survives reloads without a flash, and `?present=0` or Alt+P turns it off.

### Performance work

The first Lighthouse pass after these changes scored the payer overview 74 (CLS 0.279) and the runs page 88 (CLS 0.154): the guide and the summary strip arrived after the client fetch and pushed content down. Fixes: the overview now renders wallet, contractors and runs on the server for its first paint (`lib/server-api.ts`, the same pattern as the run page) with the client refreshing on mount, and both pages swap their body in one step once all their data has answered.

### Lighthouse 13.5.0, mobile, production build, 5 Oct 2026

| Route | Performance | Accessibility | Best practices |
| --- | --- | --- | --- |
| `/` | 97 | 100 | 100 |
| `/app` | 96 | 100 | 100 |
| `/app/payer` | 95 | 100 | 100 |
| `/app/payer/contractors` | 94 | 100 | 100 |
| `/app/payer/runs` | 95 | 100 | 100 |
| `/app/payer/runs/new` | 95 | 100 | 100 |
| `/app/payer/runs/[id]` | 95 | 100 | 100 |
| `/app/contractor` | 94 | 100 | 100 |
| `/app/accountant` | 94 | 100 | 100 |

CLS is 0 on every route except the new run form (0.005). Landing first-load JavaScript is 127 kB; no new dependencies were added (charts are HTML and CSS).

### Pass 4 screenshot review

Captured with `screenshots.mjs`, `screenshots-states.mjs` (now also insights as tables, dark run page, presenter mode at 1280x720 and, with `EMPTY_API_URL` pointing at a service on an empty testnet wallet, the first-run payer pages) and the new `screenshots-live.mjs`, which replays a paid run's own lines through their earlier statuses in the browser only (nothing is sent to the chain; files are named `-replay`). Both scripts now scroll each page before capture so in-view animations have played. No page was wider than its viewport.

| Finding | Fix |
| --- | --- |
| Contractor bars subtracted a fixed label width from each percentage, so at 375 px a $3,950 bar drew 2 px wide | The label space is reserved outside the scale; bars are proportional; on phones the name sits above its bar |
| First period label truncated ("Apr 20...") at 375 px | Month and year on two lines; the year only on the first month and on January |
| Testnet txids wrapped onto two lines in the on-chain tables at 375 px | Links never wrap; tighter cell padding on phones |
| Memo value truncated, then wrapped, in the accountant pane | Split into its real fields, Period and Invoice |
| Run summary left a lone figure on a second row | Five columns at desktop width |
| Empty workspace showed three "Create a run" actions | Insights appear once a run exists; the guide and the runs panel cover the first run |
| "6of 6" read as one word by screen readers | A real space between the count and its label |

## 15. Redesign: layout informed by Mercury's banking app (supersedes the look in sections 2 to 9 and 14)

### Why

The owner judged the first build too basic: default Next.js and shadcn styling, every section an identical bordered panel, top tabs inside top tabs, and a demo role switcher as the main navigation. Five research agents studied Request Finance, Ontop, Wise, Remitly, Revolut Business, Mercury, Ramp, Brex, Deel, Rippling, the Zcash brand and crypto payroll tools, and audited the app. The owner then asked for an established product's layout conventions to work from. Mercury's banking app was chosen as the reference because its demo app is public (demo.mercury.com) and it is the benchmark for a calm, trustworthy finance interface. The approved mockup covered the landing page, company home, approve payroll, contractor home and public payslip.

### What Mercury informed, and what is Payslip's own

- **Layout conventions informed by Mercury's banking app:** the app shell (220px sidebar on a barely tinted ground, a quiet top bar, a centred content column about 970px wide), the two-way product switch at the top of the sidebar ("Banking | Books" becomes "Payroll | Books"), bookmarks with figures, the dark demo bar with its "Viewing as" menu, light large type (28px titles at weight 380, 15px body), money with raised cents and tabular figures, pill buttons, hairline cards with 12px corners and no shadows, tables straight on the page, the full-screen review screen with a step rail, the right-side detail drawer with a timeline, the public invoice page, and the "Choose where your books live" export layout.
- **Payslip's own mark, colour and components:** Zcash gold `#F4B728` as the one accent, only on the primary action per screen and on "Shielded" tags; Payslip's own mark (two rings and a gold sealed bar) and words; Inter (with its optical-size axis) stands in for Mercury's proprietary Arcadia, with IBM Plex Mono for keys and txids; ZEC amounts show 8 decimals with the last four dimmed; testnet rates are a small "Simulated rate" label; the funding quote card (locked rate, "You send exactly", "Contractors get", fees) follows the pattern Wise uses for transfers.

### Tokens

`web/src/app/globals.css`. Light: page `#ffffff`, sidebar `#fbfcfd`, raised `#f6f6f9`, chip `#efeff3`, ink `#1e1e2a`, strong `#363644`, muted text `#5e5f6c`, faint `#8b8c98`, border `#e3e3e9`, hairline `#ececf1`, gold `#f4b728` with ink text, link `#8a6100`, success `#036e43`, danger `#b0175f`. Dark (informed by Mercury's dark theme, tinted toward ink): page `#171721`, card `#1e1e2a`, popover `#272735`, sidebar `#1a1a24`, ink `#f4f5f9`, muted text `#a6a6b2`, success `#77c599`, danger `#fc92b4`, gold unchanged. Radius 8px for controls, 12px for cards, full pills for buttons, 4px for tags. Privacy mode (the eye in the top bar) blurs every `.money` element.

### Structure

| Product | Route | Shell | Pages |
| --- | --- | --- | --- |
| Landing | `/` | marketing header, dark hero and product section | hero with sealed payroll, product accordion, proof strip, how it works, who sees what, security, pricing, FAQ, footer |
| Company console | `/console` | ConsoleShell (sidebar) | Home (the Next payroll card and the To do list read the pay schedule and the request queue), Payroll runs, Requests (payment requests from contractors: approve or reject with a note, counts in the sidebar), run page (Pay lines, Privacy view, Audit trail), People with drawer (each person's default amount), Payslip access, Treasury, Settings (the pay schedule and who has a default amount; with sign-in on also the organisation's name and logo for admins); with sign-in on (ADR-026) also Members, Invitations and Audit log, the organisation's name and logo in the sidebar brand, who is signed in at its foot, and no demo bar |
| Sign-in | `/sign-in`, `/invite/[token]` | none | one centred card: Continue with Google (and the test login for browser tests); the invitation link's welcome |
| Run payroll | `/console/runs/new` | FocusShell (full screen) | Amounts (approved payment requests for the period prefilled and marked "From a request"), Review and approve, Fund, Pay |
| Contractor portal | `/portal` | PortalShell | Unlock, Home, Payslips, payslip document, Request a payment (the form: amount, period, invoice number, due date, note, repeat monthly; the requests sent with their status, the txid once paid, the payer's note when rejected), Tax documents |
| Accountant books | `/books` | BooksShell (Books side of the switch) | Reconciliation, Ledger, Exceptions, Exports |
| Public payslip | `/verify` | none | one document card on a soft grid |

The old `/app/...` routes redirect to these. Money never moves without a review step that restates people, total, coin, rate and fees.

### Components

`web/src/components/ds/` (Card, CardHeader, CardFoot, Tag, Initials, PageTitle, ActionRow, SectionHeader, KeyValues), `web/src/components/shell/` (AppShell, ConsoleShell, PortalShell, BooksShell, FocusShell, DemoBar, PrivacyToggle), `web/src/components/app/amount.tsx` (Usd, Zec, Fiat, Rate). Area components live in `components/console`, `components/runs`, `components/portal`, `components/verify`, `components/books` and `components/marketing`.

### Lighthouse 13.5.0, mobile, after the redesign

Production build serving the demo wallet, 5 Oct 2026, measured during the judge-path audit (docs/TEST-REPORT.md, Round 6). It replaces the tables in sections 11 and 14, whose `/app/...` routes no longer exist.

| Route | Performance | Accessibility | Best practices |
| --- | ---: | ---: | ---: |
| `/` | 96 | 100 | 100 |
| `/console` | 92 | 100 | 100 |
| `/console/runs` | 94 | 100 | 100 |
| `/books` | 92 | 100 | 100 |
| `/portal` | 94 | 100 | 100 |
| `/verify` | 95 | 100 | 100 |

### UX and accessibility pass, company side (5 Oct 2026)

After the UX audit (`audit2/ux-a11y.md`) the owner said the company dashboard still did not look premium. This pass covers the console, the runs pages, Run payroll, the shells and the shared components. It changes no figure: every number still comes from the service, and where the service has no data (a company name, an admin name, a pay schedule) nothing is invented.

**Shared pieces** (exported for the portal, Books and `/verify` to adopt):

| Piece | File | What it does |
| --- | --- | --- |
| `StatusTag`, `ShieldedMark` | `components/ds/status.tsx` | The one status tag (section 7) and the gold mark of a shielded payment: a dot and the word, tooltip "Amount, sender and recipient hidden on chain". |
| `LineStatus`, `fundingTag`, `accessTag` | `components/runs/run-meta.tsx` | A pay line shows `ShieldedMark` when confirmed and its tag otherwise; funding and payslip access in the same words everywhere. |
| `SimulatedRate` | `components/ds/simulated-rate.tsx` | The gold "Simulated rate" pill. It opens a note (click, tap or Enter, so it works on phones and by keyboard) that gives the testnet rate and says it is not a price. The rate number appears nowhere else. |
| `Sensitive`, `SENSITIVE`, `MaskedSecret` | `components/ds/sensitive.tsx` | Privacy mode now blurs keys, invite links, addresses, QR codes and raw log lines as well as amounts: a Tailwind variant on the element (`[html[data-private]_&]:blur`), so no global stylesheet is needed. Invite links show masked with Reveal and Copy. |
| `Timeline` | `components/ds/timeline.tsx` | Mercury's vertical timeline (gold done, ring current, grey upcoming, amber retry, red failure). |
| `Disclosure` | `components/ds/disclosure.tsx` | One chevron disclosure on a native `details`, for raw memos, technical details and the raw service log. |
| `TYPE` | `components/ds/type.ts` | Five sizes: 13 (labels, sublines, tags), 15 (text), 19 (section headings, card figures), 28 (titles), 34 (hero money). Console text was moved onto it; initials are 11px at least. |
| `Popover` | `components/ui/popover.tsx` | Radix popover (a toggletip) for notes like the simulated rate. |
| `useFocusReturn` | `components/ui/dialog.tsx` | Every dialog and drawer sends focus back to what opened it when it closes (Radix does this only for a `DialogTrigger`). `DialogContent` uses it by default (`restoreFocus`), the console `Drawer` too, with a fallback for an opener that is gone. |
| Dates | `lib/format.ts` | Two forms: `formatShortDate` "5 Oct" in tables and lists, `formatDateTime` "5 Oct 2026, 08:13 UTC" where the moment matters; `formatClock` "08:13 UTC" beside a date already on screen. |
| Coin and settlement words | `lib/format.ts` | `coinUnit` and `settlementName`: "Holds TAZ" on testnet, "Holds ZEC" on mainnet. |
| Memo and log readers | `lib/memo.ts`, `lib/run-log.ts` | Decode a `PS1` memo into period, invoice, amount and rate; read each service log line into a payroll sentence and group a run's log per person. |
| Payroll CSV | `lib/payroll-csv.ts` | Every run and line as CSV, made in the browser from the runs already loaded. |

Icons are drawn at stroke 1.5 everywhere in the app (`LucideProvider` in AppShell, FocusShell and the demo bar). Buttons, chips, tabs, nav items and the demo bar's controls get an invisible hit area of at least 44px on touch screens (`pointer: coarse`) without changing their size. A disabled primary button is grey, like every other disabled button.

**Honest figures.** On testnet the only rate is simulated (the service's fixed `PAYSLIP_TESTNET_RATE_USD`, now also in `/api/health` as `simulated_rate_usd_per_zec`). It converts payroll dollars into TAZ and nothing else: fees, the fee reserve, what goes back to the treasury and the treasury balance stay in TAZ, and its number lives only in the `SimulatedRate` note. On mainnet, dollars come from the venue's fill rate (a real price at the time) and are labelled so. The fee reserve shown before funding mirrors the service's own formula (`feeReserveZat`, from `service/src/runs.rs`). "Covers N payrolls" is computed in coin (what the last payroll drew against the balance), so it needs no rate.

**Company home.** "Welcome back" once a payroll is paid, "Welcome to Payslip" before, with one gold action for the company's next step (add the first contractor, fund the treasury on testnet, or run payroll); actions that cannot work yet are hidden. Get started runs full width with its four steps in order. The year chart shows January to December with empty months as faint stubs, the latest month's figure, tooltips and a table view. The treasury card shows coin on testnet and dollars at the fill rate on mainnet, with the runway. Next payroll names the period and never a due date (Payslip has no pay schedule), and appears once someone is on the people list. Payments are grouped under their run ("Sep 2026 payroll · 6 payments · $30,375.50"), each confirmed payment carries the Shielded mark, dates come from `confirmed_at` when the service gives it, and filters show only where something is in them. Export is a menu: Payroll CSV (every run and line: period, run id, contractor, invoice, USD, coin, txid, height, confirmed at, status) and the auditor package. A search in the top bar (Ctrl+K or Command+K) finds people, runs, invoice references and transaction ids; it replaces the duplicate Run payroll button there (the phone menu keeps Run payroll).

**Run page.** A hero with the amount paid, the people and the time it was paid, and a "Shielded on Zcash" tag; then a two-column strip, "On the explorer: 6 transactions. No amounts, no names." next to "Here, with your keys: $30,375.50 to 6 people.", which opens the Privacy view; then the coin figures (contractors got, rate, network fees, set aside or funded, back in treasury), all at 8 decimals. Tab panels show a focus ring. The audit trail is a timeline in payroll words, one entry per person (sent and confirmed together), with the service's raw log behind a disclosure. The payment drawer shows the memo decoded (period, invoice, amount, rate) with "Show raw memo", and the account number under Technical details.

**Run payroll.** Each step's heading takes focus when the flow moves to it, and the document title names the step ("Review and approve, Run payroll | Payslip"). A summary card sits in the right column from 1280px. Approving sends `allow_overlap: true` only when the payer ticked "This is an extra run for the same period"; a 409 `period_overlap` reloads the runs so the overlap box names them, and a 409 `idempotency_mismatch` names the earlier run with Open that run and Approve as a new run. The testnet Fund step checks the balance it already has: when the treasury is short, Fund is disabled and a Top up card gives the shortfall, the address (QR and copy), free testnet coins and Check again (which syncs the wallet).

**People, Payslip access, Treasury.** Account numbers left tables and lists (they are under Technical details in the person drawer). People shows payout, payslip access, total paid and last paid by pay period, with a Share payslips row action; long names truncate with a tooltip in tables and wrap to two lines in the drawer. Payslip access turns "0 of 6 shared" into a checklist with a three-step "How invites work", masks invite links (which now carry the person's name and their account's birthday height, read by the portal and Books), names Mark as shared for voice control ("Mark as shared, Amara Okafor") and offers Undo, which clears the record only. Treasury shows one balance (coin on testnet), its runway, "Up to date with the Zcash chain" with the block in the tooltip, a larger QR with Get free testnet coins, and funding history by run name with the shared funding tags.

**Shell.** The "Viewing as" role switcher shows on testnet; on mainnet only on a build with `NEXT_PUBLIC_PAYSLIP_DEMO=1` (for the recorded demo), so a contractor's invite link on a real deployment shows only their portal. The network badge and the demo bar are live regions only while degraded or offline, and "syncing" shows only when the wallet is more than 10 blocks behind. Console page titles describe the page ("Company home", "Sep 2026 payroll", "Payroll runs"), and an unknown console address shows "Page not found" inside the shell.

**Adopted outside the console, and still to adopt.** Books' reconciliation tag now uses `StatusTag`, the portal's simulated-rate label is the shared `SimulatedRate`, and the portal's list dates (`monthDay` in `components/portal/portal-data.ts`) read "5 Oct" like the rest of the app instead of "Oct 5". Still to switch: `components/portal/portal-states.tsx` (`SettlementTag`'s Shielded tag to `ShieldedMark`), `components/books/ledger-view.tsx` (`StatusTags` and its Shielded tag to `StatusTag` and `ShieldedMark`), `components/books/run-detail.tsx` (the "Simulated rate" text and tag to `SimulatedRate`), `components/books/books-page.tsx` (its raw `details` to `Disclosure`), `components/books/books-data.ts` (`shortRange`'s own month table to `lib/format.ts`) and `components/verify/public-payslip.tsx` (the "Simulated rate" text to `SimulatedRate`).

## 16. Identity: one payment, two views (11 Oct 2026; supersedes the visual direction in section 15, keeps its structure)

The owner judged the Mercury-informed look clean but generic: a console shape any fintech could ship, with nothing that only Payslip can show. This section sets Payslip's own identity. Section 15's structure (the three products, routes, the Run payroll flow, the status vocabulary) stays.

### The idea

Every screen that shows a payment can show it two ways: what the public explorer sees (a shielded transaction: txid, block, action count, and nothing else) and what the viewing key sees (the payslip: who, how much, for which period and invoice). Payslip's identity is that pair, side by side, joined by the one thing they share, the txid. The landing page opens on it with a real transaction; the run page and the payslip carry it as a strip; the contractor portal shows it on every payslip.

### Tokens

Colour, five names, light theme first:

| Name | Hex | Use |
| --- | --- | --- |
| Paper | #FFFFFF | the key's view: pages, payslips, the console |
| Vault | #1C2230 | the explorer's view: the dark panel, redaction bars live only here; also the text ink on paper |
| Gold | #F4B728 | the thread between the two views, primary actions, the shielded mark; as text on paper use #8A6400 |
| Ash | #5C6472 on paper, #8B93A5 on vault | secondary text |
| Mist | #EEF1F5 on paper, #2A3242 on vault | hairlines, surfaces, tracks |

Dark theme: Paper becomes #14181F and Vault panels become #0F1218 with Mist #262C38; Gold unchanged.

Type, three roles:

| Role | Face | Notes |
| --- | --- | --- |
| Display | Bricolage Grotesque (variable, optical size axis), weight 500 to 600, tight leading | headlines, the company name, the big money figure on a page. Use the optical size: large sizes get the display cut, small sizes the text cut. |
| Text | Instrument Sans, 400 and 500, `font-feature-settings: "tnum"` wherever figures align | all UI and body text; replaces Inter |
| Data | IBM Plex Mono, 400 | txids, keys, block heights, addresses, memos; never for prose |

Scale (px): 13, 15, 17, 22, 30, 44, 64 at 1440; the two largest steps drop one step at 768 and two at 375. Line length under 80 characters. Sentence case everywhere; no all-caps labels; no middle-dot joined strings (write a sentence or use a comma); no arrows appended to links.

### Layout principles

1. The split is the brand. The two-view pair is a full-width panel: vault on the left, paper on the right, the txid repeated at the top of both in Plex Mono, a gold hairline joining them. On a phone the panels stack, vault first.
2. Redaction bars only ever appear on the vault side, and only for what the chain hides: amount, sender, recipient, memo. They are Mist-on-Vault blocks the width of the hidden value, never a blur.
3. One orchestrated motion per page: the paper side resolves from redaction bars into values once, on load (landing) or when a key opens a statement (portal). Everything else moves only in answer to a click. Reduced motion shows the final state.
4. No card kit. Sections flow on Paper with space; a border appears only where it encodes a boundary (the vault panel, a payslip's edge, a table). One radius (12px) for panels, 999px for pills.
5. Gold is scarce: the thread, the primary action, the shielded mark, the active tab. Never a gold wash or gradient.
6. Numbers are typeset: display face for the headline figure with raised cents, tabular text face in tables, Plex Mono for chain data.

### Landing page

Order: header; hero with the headline "Private to the world. Transparent to your accountant." and the two-view panel on a real payment; the three people (company, contractor, accountant) as one strip with a sentence and a real figure each; how a run works as a four-step sequence (fund, allocate, pay, read back), numbered because it is a sequence; proof table from the mainnet run (testnet sample until then, labelled); pricing against the $49 products; check it yourself with the judge kit; footer. Left-aligned throughout; the headline is display at 64, two lines.

### Console, portal, books

Tokens and type apply everywhere. The run page's explorer strip becomes a two-view panel above the tabs. The payslip document gets a vault panel titled "What the world sees" with the explorer link. The console home leads with the company name in the display face and the paid-this-year figure. The demo bar stays as the sample-company notice on testnet.
