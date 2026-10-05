# Payslip web

Next.js 15 dashboards for the three Payslip roles: payer, contractor and accountant. The app talks directly to the Payslip service REST API described in [`docs/API.md`](../docs/API.md) and never holds keys that can spend. Design system, research notes and every screen state are in [`docs/DESIGN.md`](../docs/DESIGN.md).

## Run it

Requirements: Node 22 or newer and pnpm (developed with pnpm 11).

```
cd web
cp .env.example .env.local     # optional; defaults work for a local service
pnpm install
pnpm dev                       # http://localhost:3000
```

Start the service too (`cd service && cargo run`). The web app expects it at `http://127.0.0.1:8080` unless `NEXT_PUBLIC_PAYSLIP_API_URL` says otherwise.

Open the app at **http://localhost:3000**, not http://127.0.0.1:3000. The service allows one browser origin through CORS (`PAYSLIP_WEB_ORIGIN`, default `http://localhost:3000`); any other origin is blocked by the browser and the app shows the "service is not reachable" state with that fix.

## Environment

| Variable                               | Purpose                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_PAYSLIP_API_URL`          | Base URL of the Payslip service. Empty means `http://127.0.0.1:8080`.                                                                                                    |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project id for mobile wallets on the Fund step. Empty means only browser extension wallets (MetaMask, Rabby and other injected wallets) are offered. |

Both are read at build time (`NEXT_PUBLIC_`), so rebuild after changing them.

## Scripts

| Command                             | What it does                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm dev`                          | Copies the QR decoder WebAssembly into `public/zxing/`, then starts the dev server. |
| `pnpm build`                        | Same copy, then a production build.                                                 |
| `pnpm start`                        | Serves the production build.                                                        |
| `pnpm lint`                         | ESLint (Next.js core web vitals and TypeScript rules), zero warnings allowed.       |
| `pnpm typecheck`                    | `tsc --noEmit` in strict mode.                                                      |
| `pnpm format` / `pnpm format:check` | Prettier.                                                                           |
| `pnpm screenshots`                  | Captures every route at 375, 768 and 1440 px into `docs/screenshots/` (see below).  |

## Routes

| Route                    | Role       | What it shows                                                                                                                                                                 |
| ------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                      | Everyone   | Pitch, how it works, who sees what.                                                                                                                                           |
| `/app`                   | Everyone   | Role chooser and live network status from `GET /api/health`.                                                                                                                  |
| `/app/payer`             | Payer      | Treasury balance with sync, setup checklist, recent runs, contractor key sharing status.                                                                                      |
| `/app/payer/contractors` | Payer      | Contractors table, add and edit, share viewing key (text and QR), mark as shared, archive, export all viewing keys for the accountant.                                        |
| `/app/payer/runs`        | Payer      | Runs with status filters.                                                                                                                                                     |
| `/app/payer/runs/new`    | Payer      | Period, one line per contractor (USD amount, invoice reference), totals, validation, idempotent submit.                                                                       |
| `/app/payer/runs/[id]`   | Payer      | Fund, Execute, Paid stepper; live progress over SSE; pay lines with txids; run summary; public chain versus Zcash explorer comparison; activity feed.                         |
| `/app/contractor`        | Contractor | Paste or scan a viewing key, choose a period, read the statement, export CSV, print to PDF.                                                                                   |
| `/app/accountant`        | Accountant | Paste keys, import the payer's export file or scan QR codes; reconciliation per run, all pay lines filterable by contractor, pending and unlabelled lines, export CSV, print. |

## How it is built

- Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS 4, shadcn/ui (Radix), Geist fonts from the `geist` package (no network fetch at build).
- `src/lib/api.ts` is the typed client for `docs/API.md`. Every failure becomes an `ApiError` with the service's `message` and `hint`; a network failure becomes `service_unreachable` with a hint that names the fix.
- `src/hooks/use-run-events.ts` subscribes to `GET /api/runs/{id}/events` (events `snapshot` and `log`) and reconnects with backoff when the browser gives up. The run page also loads `GET /api/runs/{id}/log` so the activity feed survives a reload.
- Viewing keys are checked in the browser before anything is sent (`src/lib/keys.ts`): seed phrases, spending keys, raw hex, addresses and incoming viewing keys are refused with a reason. Only unified full viewing keys (`uview`, `uvf`, `uviewtest`, `uvftest`) and the period are sent to the statement endpoints; labels from an imported file stay in the browser.
- Funding with a browser wallet (`src/components/payer/wallet-pay.tsx`) uses wagmi 2, viem 2 and RainbowKit 2. It is the only module that loads them and it is imported with `next/dynamic` and `ssr: false` on the Fund step, so every other route stays light. It sends an ERC-20 `transfer` of `amount_in_base_units` to `deposit_address` on `chain_id`, switching chain first if needed, posts the hash to `POST /api/runs/{id}/funding/deposit-tx`, and the page polls `GET /api/runs/{id}/funding` every 5 seconds. With the testnet fixed-rate venue there is no deposit; the Fund step explains that and offers "Confirm funding".
- QR codes are rendered in the browser with `qrcode.react`. QR scanning uses the `barcode-detector` ponyfill (ZXing compiled to WebAssembly); the `.wasm` file is copied from `node_modules` into `public/zxing/` by `scripts/copy-zxing-wasm.mjs` so it is served by this app instead of a CDN. `public/zxing/` is generated and ignored by git.
- Statements print as a clean document through a print stylesheet in `src/app/globals.css` (navigation, buttons and controls hidden; full txids; collapsed sections opened).
- `next.config.ts` aliases a few optional modules that wagmi's connector bundle imports but Payslip never runs (Coinbase CDP SDK's `@x402/*` peers, `pino-pretty`, React Native storage) and enables `optimizePackageImports` for `radix-ui`, which keeps the landing page at about 126 kB of first-load JavaScript.

## Screenshots

`scripts/screenshots.mjs` captures every route at 375, 768 and 1440 px into `docs/screenshots/` and flags any page that scrolls horizontally.

```
pnpm exec playwright install chromium     # once
pnpm build && pnpm start                  # in one terminal, with the service running
pnpm screenshots                          # in another
```

Options: `BASE_URL` (default `http://localhost:3000`), `RUN_ID=<uuid>` to include a run page, `THEME=dark` for dark mode.

`scripts/screenshots-states.mjs` adds the data-bearing states from the running service (statement, reconciliation, share-key dialog, insights as tables, dark mode, presenter mode at 1280x720); with `EMPTY_API_URL` pointing at a second service on an empty testnet wallet it also captures the first-run payer pages. `scripts/screenshots-live.mjs` captures the run page mid-execution by replaying a paid run's own lines through their earlier statuses in the browser only; nothing is sent to the chain and the files are named `-replay`. Both take `BASE_URL` and `API_URL`.

Presenter mode for recordings: add `?present=1` to any URL or press Alt+P (Option+P on a Mac). It enlarges type and hides secondary chrome for the browser tab; `?present=0` or Alt+P turns it off.

## Notes

- `pnpm-workspace.yaml` sets `allowBuilds` to `false` for four packages whose install scripts only build optional native accelerators; each has a JavaScript fallback or prebuilt binary.
- pnpm 11 enforces a minimum release age; versions are pinned to releases older than one day at install time.
