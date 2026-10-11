# Payslip web

Next.js 15 app for the three Payslip roles: the company console for the payer, the contractor portal and the accountant's books, plus the landing page and the public payslip page. The app talks directly to the Payslip service REST API described in [`docs/API.md`](../docs/API.md) and never holds keys that can spend. Design system, research notes and every screen state are in [`docs/DESIGN.md`](../docs/DESIGN.md).

## Run it

Requirements: Node 22 or newer and pnpm (developed with pnpm 11).

```
cd web
cp .env.example .env.local     # optional; defaults work for a local service
pnpm install
pnpm dev                       # http://127.0.0.1:3000
```

Start the service too (`cd service && cargo run`). The web app expects it at `http://127.0.0.1:8080` unless `NEXT_PUBLIC_PAYSLIP_API_URL` says otherwise.

Open the app at **http://127.0.0.1:3000**. `localhost` works too, but on some machines it resolves to an IPv6 address that another local app holds. The service allows the browser origins in `PAYSLIP_WEB_ORIGIN` through CORS, by default `http://localhost:3000` and `http://127.0.0.1:3000`; on another port, add that origin (for example `PAYSLIP_WEB_ORIGIN=http://127.0.0.1:3100`) and restart the service. Any other origin is blocked by the browser and the app shows the "service is not reachable" state with that fix.

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
| `pnpm screenshots`                  | Captures every route at 375, 768 and 1440 px into `web/screenshots/` (see below).   |

## Structure

One product per role, from [`docs/DESIGN.md`](../docs/DESIGN.md) section 15:

| Product           | Route               | Shell                                 | Pages                                                                                                                 |
| ----------------- | ------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Landing           | `/`                 | marketing header, dark hero           | hero with sealed payroll, product accordion, proof strip, how it works, who sees what, security, pricing, FAQ, footer |
| Company console   | `/console`          | ConsoleShell (sidebar)                | Home, Payroll runs, run page (Pay lines, Privacy view, Audit trail), People with drawer, Payslip access, Treasury     |
| Run payroll       | `/console/runs/new` | FocusShell (full screen)              | Amounts, Review and approve, Fund, Pay                                                                                |
| Contractor portal | `/portal`           | PortalShell                           | Unlock, Home, Payslips, payslip document, Tax documents                                                               |
| Accountant books  | `/books`            | BooksShell (Books side of the switch) | Reconciliation, Ledger, Exceptions, Exports                                                                           |
| Public payslip    | `/verify`           | none                                  | one document card on a soft grid                                                                                      |

The dark demo bar's "Viewing as" menu switches between Company, Contractor and Accountant. The old `/app/...` routes redirect to these. Money never moves without a review step that restates people, total, coin, rate and fees.

## How it is built

- Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS 4, shadcn/ui (Radix). Instrument Sans (text), Bricolage Grotesque with its optical-size axis (titles, the company name, headline money) and IBM Plex Mono (chain data) through `next/font/google` (docs/DESIGN.md section 16), which downloads them at build time and serves them from this app.
- `src/lib/api.ts` is the typed client for `docs/API.md`. Every failure becomes an `ApiError` with the service's `message` and `hint`; a network failure becomes `service_unreachable` with a hint that names the fix.
- `src/hooks/use-run-events.ts` subscribes to `GET /api/runs/{id}/events` (events `snapshot` and `log`) and reconnects with backoff when the browser gives up. The run page also loads `GET /api/runs/{id}/log` so the activity feed survives a reload.
- Viewing keys are checked in the browser before anything is sent (`src/lib/keys.ts`): seed phrases, spending keys, raw hex, addresses and incoming viewing keys are refused with a reason. Only unified full viewing keys (`uview`, `uvf`, `uviewtest`, `uvftest`) and the period are sent to the statement endpoints; labels from an imported file stay in the browser.
- Funding with a browser wallet (`src/components/runs/new-run/wallet-pay.tsx`) uses wagmi 2, viem 2 and RainbowKit 2. It is the only module that loads them and it is imported with `next/dynamic` and `ssr: false` on the Fund step, so every other route stays light. It sends an ERC-20 `transfer` of `amount_in_base_units` to `deposit_address` on `chain_id`, switching chain first if needed, posts the hash to `POST /api/runs/{id}/funding/deposit-tx`, and the page polls `GET /api/runs/{id}/funding` every 5 seconds. With the testnet fixed-rate venue there is no deposit; the Fund step explains that and offers "Fund from treasury".
- QR codes are rendered in the browser with `qrcode.react`. QR scanning uses the `barcode-detector` ponyfill (ZXing compiled to WebAssembly); the `.wasm` file is copied from `node_modules` into `public/zxing/` by `scripts/copy-zxing-wasm.mjs` so it is served by this app instead of a CDN. `public/zxing/` is generated and ignored by git.
- Statements print as a clean document through a print stylesheet in `src/app/globals.css` (navigation, buttons and controls hidden; full txids; collapsed sections opened).
- `next.config.ts` aliases a few optional modules that wagmi's connector bundle imports but Payslip never runs (Coinbase CDP SDK's `@x402/*` peers, `pino-pretty`, React Native storage) and enables `optimizePackageImports` for `radix-ui`, which keeps the landing page at about 123 kB of first-load JavaScript (`pnpm build`, 5 Oct 2026).

## Screenshots

`scripts/screenshots.mjs` captures every screen at 375, 768 and 1440 px into `web/screenshots/` (git-ignored; screenshots are not kept in the repo) from live data and flags any page that scrolls horizontally. The contractor portal is opened with the first contractor's invite link and the books with "Load this company's keys", both from the running service; the run page uses the latest pay period's run, and the public payslip uses the payment proof in `docs/judge/judge-kit-testnet.json`.

```
pnpm exec playwright install chromium     # once
pnpm build && pnpm start                  # in one terminal, with the service running
pnpm screenshots                          # in another
```

Options: `BASE_URL` (default `http://localhost:3000`), `API_URL` (default `http://127.0.0.1:8080`), `THEME=dark` for dark mode, `WIDTHS` (default `375,768,1440`) and `PROOF_TOKEN` for another payment proof. The script only reads from the service.

Presenter mode for recordings: add `?present=1` to any URL or press Alt+P (Option+P on a Mac). It enlarges type and hides secondary chrome for the browser tab; `?present=0` or Alt+P turns it off.

## Notes

- `pnpm-workspace.yaml` sets `allowBuilds` to `false` for four packages whose install scripts only build optional native accelerators; each has a JavaScript fallback or prebuilt binary.
- pnpm 11 enforces a minimum release age; versions are pinned to releases older than one day at install time.
