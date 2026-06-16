# CLAUDE.md — Assay

Guidance for Claude Code working in this repo, plus the **living spec and roadmap**. This file is the source of truth for what Assay is and what's left to build. Edit the checklist as we go.

> Assay (verb): to test the quality and composition of a metal or ore. Here: to test whether a stock is worth buying.

## What Assay is

A **Claude-driven research canvas for US stocks & ETFs.** You ask Claude (in Claude Code) to research a ticker; Claude gathers data, reasons over it, and streams a live, panel-by-panel dossier into the Assay desktop app — chart, earnings dates, SEC filing summary, a recommendation, a value chain, and more.

**Claude is the analyst; the app is the dashboard.** The app self-fetches the fast structured data (chart, quote, fundamentals, earnings dates) and renders instantly; Claude supplies the judgment layer (SEC summary, recommendation, value chain, news, risks) by POSTing panels to a localhost endpoint the app runs — incrementally, so the dossier visibly fills in.

Carved out of the Pulse project's finance core but **fully decoupled** — own repo, own database (`assay.db`), shares no code or state with Pulse. We copy/adapt Pulse *patterns*; we never import from it.

> **History note:** Assay started (2026-05-31) as a self-contained rule-based scorecard app. Same day it pivoted to this Claude-driven canvas architecture. The standalone scaffold (Stooq service, DB, deep-dive quote screen) is the foundation we build the canvas on; the single-ticker quote screen will be replaced by the panel dashboard.

### Decisions locked (planning, 2026-05-31)

| Decision | Choice |
|---|---|
| Architecture | Claude-driven canvas: **Claude = brain, app = renderer**. Pivoted from standalone |
| Division of labor | **Split** — app fetches numeric/chart data; Claude supplies qualitative panels |
| Handoff | App runs a **localhost HTTP server**; Claude POSTs panels; live + incremental |
| Trigger | `/research <TICKER>` **skill** (also responds to natural language) |
| Driven from | **Claude Code** (this CLI) |
| Data gathering (Claude side) | **Both** — built-in WebSearch/WebFetch + finance MCP servers (SEC EDGAR, yfinance, FRED) |
| Coverage | US stocks + ETFs only |
| Data cost | Free sources only |
| Recommendation panel | **Claude's thesis + analyst consensus, side by side** |
| Value chain panel | **Visual node graph** (suppliers → company → customers + competitors) |
| Panels included | chart · key stats · earnings dates · rule scorecards · SEC summary · recommendation · value chain · news/catalysts · peer comparison · risks |
| History | **Lightweight** — store tickers researched + dates; re-runs fetch fresh |
| Windows | **New window per ticker** (may revisit: tabs later) |
| AI in the app itself | None — Claude is the external brain; the app renders |

## Architecture

```
You: "/research AAPL" in Claude Code
  ├─ skill ensures app running (GET /health, else launch + wait)
  ├─ POST /research {ticker}  → app opens window, fetches & renders its OWN
  │                             numeric panels immediately
  └─ Claude gathers qualitative layer, streams panels as each completes:
       POST /panel/sec-summary | recommendation | value-chain | news | risks | peers
       → main forwards via IPC → renderer updates that panel live
```

- **Main process** (`src/main/`): owns the DB, the app's own data fetching, and the **localhost control server** (`127.0.0.1`, fixed port, per-launch token in `userData/server-token.json`; reject non-local origins). Endpoints: `GET /health`, `POST /research`, `POST /panel/:type`, `POST /peers`. Forwards pushes to the target window via `webContents.send`.
- **Preload** (`src/preload/index.ts`): typed `window.api` bridge; renderer subscribes to panel-update events. No direct `ipcRenderer` in React.
- **Renderer** (`src/renderer/`): panel dashboard grid; each panel has loading / filled / empty states. Tailwind only.
- **Shared types** (`src/shared/types.ts`): dossier + panel payload contracts used by app *and* documented for the skill.
- **DB**: `better-sqlite3` at `userData/assay.db`, versioned migrations.
- **Skill**: a Claude Code skill (`/research`) encoding the orchestration; this repo holds its definition.

### Panel ownership ("split")

| Panel | Owner | Source |
|---|---|---|
| Price chart (candles, 50/200 MA, vol, 52wk) | App | Stooq history |
| Key stats & quote | App | Stooq + Yahoo |
| Earnings / notable dates | App | Yahoo calendar |
| Rule scorecards (Value/Growth/Dividend/Technical) | App | computed from SEC EDGAR + Yahoo |
| Valuation (DCF intrinsic value) | App | computed from Yahoo FCF + beta |
| Analyst consensus (½ of recommendation) | App | Yahoo estimates |
| SEC filings summary | Claude | EDGAR via WebFetch/MCP |
| Recommendation thesis (½) | Claude | reasoning |
| Value chain (node graph) | Claude picks entities → App renders graph | Claude reasoning |
| News & catalysts | Claude | WebSearch |
| Peer comparison | Claude picks peers → App fills metrics | mix |
| Risks / red flags | Claude | reasoning over filings |

### Data sources (free, US stocks + ETFs)

| Source | Provides | Status |
|---|---|---|
| **Stooq** | Live quotes (CSV) | ✅ quotes only — history moved to Yahoo (Stooq's `q/d/l` download now requires an API key, 2026-05-31) |
| **`yfinance` MCP** (yfmcp) | Claude-side: quotes, financials, analyst estimates, news, holders, options | ✅ data fetches working (after AVG CA-bundle fix — see Environment gotchas) |
| **`sec-edgar` MCP** (sec-edgar-mcp) | Claude-side: 10-K/10-Q/8-K, XBRL financials, company facts, insider trades | ✅ data fetches working (after AVG CA-bundle fix — see Environment gotchas) |
| **Yahoo Finance** (app-side) | Daily price history (v8 chart endpoint, keyless) + Key Stats fundamentals — market cap, P/E (trailing/fwd), EPS, div yield, beta — via `yahooService.ts` (`net.fetch`; fundamentals use the cookie+crumb flow, the chart endpoint doesn't). Also backs the `/research` slim `data` endpoint. Ratios/estimates/earnings dates/ETF data still to come | ✅ history + key-stats + research bundle; ⏳ rest v2 |
| **SEC EDGAR** (`companyfacts`, app-side) | Official US fundamentals for the scorecards panel | ⏳ v2 |
| **FRED** | Macro context — optional, free key | ⏳ later |

### Rule scorecards (one app-owned panel)

Green / yellow / red per dimension, metrics shown, no composite. Thresholds tunable.
- **💰 Value** — P/E (trailing+forward), P/B, P/S, EV/EBITDA, FCF yield, ROE/ROIC, debt/equity, current ratio
- **📈 Growth** — revenue YoY + 3yr CAGR, EPS growth, margin trend, forward-estimate growth, revisions
- **💵 Dividend** — yield, payout ratio, FCF coverage, growth streak
- **📉 Technical** — price vs 50/200 MA, distance from 52-wk high/low, 3/6-mo momentum, RSI

ETFs get a tailored card set (expense ratio, distribution yield, top holdings, sector exposure, AUM + Technical).

## Roadmap — edit as we go

### Foundation (done — from the standalone scaffold)
- [x] Lean Electron + Vite + React + TS + Tailwind app
- [x] `better-sqlite3` connection + migrations
- [x] Stooq quote service (decoupled copy) + end-to-end IPC pipeline
- [x] Build verified green (rebuild / lint / build); runtime data path proven via `net.fetch`

### v1 — prove the Claude-driven canvas (MVP pipeline) — Slice 1 done, pending live test
- [x] Verify + wire finance MCP servers into Claude Code — `yfinance` (yfmcp) + `sec-edgar` (sec-edgar-mcp) via `uvx --system-certs` in `.mcp.json`; both handshake-verified
- [x] Local control server in main (`/health`, `/research`, `/panel`) + token auth + IPC→renderer bridge ([controlServer.ts](src/main/server/controlServer.ts), [windows.ts](src/main/windows.ts))
- [x] Panel dashboard renderer (grid, loading states, new window per ticker) — replaced the quote screen ([App.tsx](src/renderer/App.tsx))
- [x] App self-fetch numeric panels: **chart** (lightweight-charts, [ChartPanel.tsx](src/renderer/components/ChartPanel.tsx)) + key stats
- [x] `/research <TICKER>` skill (in-repo at [.claude/skills/research/SKILL.md](.claude/skills/research/SKILL.md)) + control client ([scripts/assay.mjs](scripts/assay.mjs)): ensure → research → stream panels
- [x] First Claude panels wired end-to-end: **SEC summary** + **recommendation**
- [x] Lightweight history (tickers + dates) in SQLite ([history.ts](src/main/database/history.ts), migration v2)
- [x] **Live click-through test** — `npm run dev` + `/research AAPL` confirmed 2026-06-10: chart painted (11,465 bars), sec-summary/news/recommendation/risks all streamed in `delivered:true`
- [ ] Earnings / notable-dates numeric panel (needs Yahoo service) — deferred to v2

### v2 — fill out the panels
- [x] Rule-scorecards panel — app-computed, **Yahoo-primary** (Value/Growth/Dividend/Technical + ETF Profile/Technical); pure `scoring.ts` engine (vitest-tested) → `scorecardService.ts` → `stocks:scorecards` IPC → `ScorecardPanel`. SEC-EDGAR source + sector-aware thresholds deferred (see [spec](docs/superpowers/specs/2026-06-03-scorecards-panel-design.md))
- [ ] Analyst-consensus data (Yahoo) shown beside Claude's thesis
- [x] News & catalysts panel — Claude-pushed (`NewsData`); Sonnet sub-agent gathers (yfinance news + WebSearch) & pushes. See [spec](docs/superpowers/specs/2026-06-03-news-risks-panels-design.md)
- [x] Risks / red flags panel — Claude-pushed (`RisksData`); main Opus agent writes (categorized + optional structural screens). Same spec
- [x] DCF valuation panel — app-owned, app-computed 2-stage equity DCF + reverse-DCF check (pure `dcf.ts` engine, vitest-tested → `valuationService.ts` → `stocks:valuation` IPC → `ValuationPanel`); also feeds `valuation` into the `/research` data bundle so the recommendation references it. See [spec](docs/superpowers/specs/2026-06-03-dcf-valuation-panel-design.md)
- [x] Peer comparison (2026-06-10) — `/research` skill pushes just `{tickers}`; main enriches via the cached Yahoo bundle ([peers.ts](src/main/services/peers.ts)) into a `PeersData` table (seed first), persisted like any panel; `PeersCard` renders it full-width

### v3 — the value chain + polish
- [x] Value-chain **node graph** — standalone `/value-chain` skill + dedicated radial-graph window (React Flow + d3-force); Claude pushes entities/edges (hybrid sources + confidence), app dedups/persists (migration v4: `vc_entities`/`vc_edges`/`vc_generations`) & renders an accreting cross-company map; 30-day freshness cache. See [spec](docs/superpowers/specs/2026-06-03-value-chain-map-design.md)
- [x] Reopen-from-history — clickable Home rows → `research:open` IPC → saved dossier reloads (reopen doesn't bump the research count) (2026-06-10)
- [ ] Window tabs option, settings, electron-builder packaging
- [x] Persist pushed panels to `assay.db` (migration v3, `panels` table; one row per ticker+type, upserted with `created_at`). Windows reload the last dossier with its date on open ([panels.ts](src/main/database/panels.ts), `getPanels` IPC); fresh pushes overwrite by `savedAt`. ("save full dossiers")

### Backlog — UX & indicators (noted 2026-06-05)
- [x] **RSI indicator on the price chart** (2026-06-10) — Wilder RSI(14) band between candles and volume on `ChartPanel`, with 30/70 guides; daily-derived ranges only (cleared intraday)
- [x] **Acronym tooltips** (2026-06-10) — [glossary.ts](src/renderer/glossary.ts) `explain()` → native `title` tips on metric cells in Key Stats / scorecards / valuation / peers
- [x] **Earnings date & key upcoming events panel (exact dates)** (2026-06-10) — `calendarEvents` rides the cached research-bundle fetch (`YahooResearch.calendar`); `Upcoming dates` panel shows earnings (window), ex-dividend, dividend-paid with exact dates

### Backlog — close the loop (noted 2026-06-10)
- [x] **Track record / "audit the analyst" panel** ⭐ (2026-06-10) — append-only `calls` table (migration v5) fed by every recommendation push (call + headline + price-at-call from `street.targets.current`); Home "Track record" list shows `CALL SYM @ $px · date · +X% since` (current price via Stooq, [trackRecord.ts](src/main/services/trackRecord.ts)), rows click through to the dossier.
- [ ] **"What changed since last research" diff** — builds on version history above. On a fresh `/research`, surface flips (buy→hold), new/removed risk categories, consensus shifts since the previous dossier.
- [ ] **Dossier export** (markdown/HTML serializer over the stored structured panels) — nice-to-have, after the two above.

### Out of scope (intentional)
- [ ] Idea screening / discovery — bring-your-own-ticker
- [ ] International stocks, crypto

## Commands

```
npm install     # TLS: prefix with NODE_OPTIONS=--use-system-ca (INSTALL ONLY — see gotchas)
npm run dev     # electron-vite dev (hot reload) — leave running so the canvas can receive pushes
                # ⚠ never with NODE_OPTIONS=--use-system-ca — Electron refuses to launch
npm run build   # production build into out/
npm run lint    # tsc --noEmit
npm run rebuild # electron-rebuild, run after bumping Electron major
```

## Environment gotchas (this machine)

- **AVG Antivirus TLS interception (not corporate).** AVG's "Web Shield HTTPS scanning" MITMs all HTTPS locally and re-signs it with AVG's own root CA (`CN=AVG Web/Mail Shield Root`), which lives in the **Windows cert store**. Clients that trust the OS store are fine; clients with their own bundled CA list (`certifi`) reject it. Symptoms: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `unable to get local issuer certificate`, `fetch failed`. (Confirmed 2026-05-31 by inspecting the cert served for sec.gov.)
  - **npm:** run installs as `$env:NODE_OPTIONS="--use-system-ca"; npm install`. (`use-system-ca` is *not* honored from `.npmrc` on npm 11.12, and don't disable `strict-ssl` — that turns off verification entirely.)
    - ⚠️ **Install ONLY — never carry that env var into `npm run dev`/`build`/`start`.** Electron aborts at launch with `electron: --use-system-ca is not allowed in NODE_OPTIONS` (exit 9 — the dev server dies and `assay.mjs ensure` never goes healthy). Dev/build/run don't need it anyway: the renderer + `net.fetch` already trust the OS store via Chromium. So scope `$env:NODE_OPTIONS` to the single install command; don't `export`/set it for the whole shell session. (Burned ~an hour on this 2026-05-31.)
  - **App runtime:** services must use **Electron's `net.fetch`** (from `import { net } from 'electron'`), never global `fetch`. `net.fetch` uses Chromium's stack → trusts the OS cert store automatically. `stooqService.ts` and `yahooService.ts` do this; follow the same pattern for SEC/FRED services.
  - **Yahoo fundamentals (`yahooService.ts`) need a cookie+crumb.** `quoteSummary` 401s without a per-session crumb: GET `https://fc.yahoo.com` (404s but sets the cookie in `net.fetch`'s default-session jar) → GET `/v1/test/getcrumb` → append `&crumb=` to the data call. The crumb is cached and refreshed on 401/403. Every request is **timeout-bounded** (`AbortController`) so a hang resolves to `null` (panel hides) instead of leaving the renderer stuck on "Loading…". Confirmed working in Electron 2026-05-31 (`[yahoo] fundamentals for AAPL -> ok`). Validate the flow quickly from PowerShell with `Invoke-RestMethod` + a `WebRequestSession` — .NET trusts the OS store, so it works where Node `fetch`/`certifi` won't.
- **Python MCP servers need uv.** Installed uv 0.11.17 to `<user-home>\.local\bin` (on PATH). MCP servers run via `uvx`. `--system-certs`/`UV_SYSTEM_CERTS=true` (set in `.mcp.json`) fix uv's *own* package downloads (rustls), but **NOT** the servers' child Python HTTP stacks — those still trust only `certifi` and fail every data fetch (sec-edgar uses `requests`, yfinance uses `curl_cffi`).
  - **Fix (done):** exported the Windows root store (incl. the AVG root) to `certs/windows-ca-bundle.pem` (gitignored) and pointed the Python stacks at it via `SSL_CERT_FILE` + `REQUESTS_CA_BUNDLE` + `CURL_CA_BUNDLE` in each server's `env` in `.mcp.json`. Verified both return HTTP 200.
  - **Gotchas:** MCP servers cache env at startup — **restart Claude Code** after editing `.mcp.json`. If AVG rotates its scanning root, cert errors return → re-export the bundle (PowerShell loop over `Cert:\LocalMachine\Root` + `Cert:\CurrentUser\Root` + `Cert:\LocalMachine\CA`, base64 each cert into BEGIN/END CERTIFICATE blocks).
- **`better-sqlite3` dual ABI (app vs tests).** The main copy is electron-rebuilt to **Electron's** ABI (postinstall), which vitest under system Node can't load (`NODE_MODULE_VERSION` mismatch). Tests therefore import the **`better-sqlite3-node`** npm alias (devDependency, keeps its Node prebuild — electron-rebuild's default scope is prod deps only); types shimmed in [better-sqlite3-node.d.ts](src/main/database/better-sqlite3-node.d.ts). Don't "fix" a DB test by pointing it back at `better-sqlite3`.
- **`better-sqlite3` rebuild EPERM.** The native rebuild can fail once with `EPERM: unlink ...better_sqlite3.node` (Defender scanning the freshly-extracted prebuild). Fix: `Remove-Item node_modules\better-sqlite3\build -Recurse -Force` then `npm run rebuild`. It's transient — a retry succeeds.

## Conventions

- **No direct `ipcRenderer` in React** — everything through the typed preload bridge.
- **DB ops stay in the main process** — expose via IPC, never open the DB from the renderer.
- **Control server is localhost-only** — bind `127.0.0.1`, require the per-launch token, reject non-local origins. Never expose it on `0.0.0.0`.
- **Local & private** — all data local, no accounts, no telemetry, no cloud sync.
- **Tailwind only** — no CSS-in-JS, no component libraries. (A markdown *renderer* like react-markdown was tried and removed; panels render structured data, not markdown — see below.)
- **Qualitative panels are structured, not markdown.** `sec-summary` and `recommendation` ship typed `data` payloads (`PushPanel.data` + the `RecommendationData` / `SecSummaryData` / `Metric` interfaces in `src/shared/types.ts`); the renderer has a dedicated component per panel (verdict badge, metric grid, price-target / range bars), and `Key stats` valuation comes from `yahooService`. Push JSON via `assay.mjs panel <T> <type> --data file.json`; markdown transport stays only as a fallback for panel types without a layout yet. The `/research` skill documents the exact shapes.
- **Decoupled from Pulse** — copy/adapt patterns, never import across projects.

## Behavioral rules for Claude in this repo

1. **Keep this file current.** When a roadmap item is done, check it off and update the status tables. This file is what a fresh session reads first.
2. **Pause on blockers.** Ambiguous requirements or destructive decisions → ask, don't guess.
3. **Verify builds.** After structural changes, `npm run lint` at minimum; `npm run dev` for anything user-facing.
4. **Stay lean.** Assay's reason for existing is to be light. No speculative abstractions, no features beyond the roadmap.
