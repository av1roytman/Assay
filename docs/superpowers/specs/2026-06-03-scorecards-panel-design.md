# Rule Scorecards Panel — Design Spec

**Date:** 2026-06-03
**Status:** Approved (pending spec review)
**Roadmap item:** v2 — "Rule-scorecards panel (app-computed from SEC EDGAR + Yahoo fundamentals)"

> First of six candidate sub-projects identified from the 2026-06-03 skills/MCP research
> (the others: DCF recommendation, News+Risks, Peer comparison, FRED macro, Value-chain graph).
> Each gets its own spec → plan → build cycle. This spec covers **only** the scorecards panel.

## Overview

An **app-owned, app-computed** dashboard panel showing Green / Yellow / Red rule scorecards for
the researched ticker. Stocks get four cards (💰 Value, 📈 Growth, 💵 Dividend, 📉 Technical);
ETFs get a tailored set (profile + technical). Each card shows its metrics with per-metric tone
and a single rolled-up card status. **No composite score across cards** (locked decision).

This is a numeric panel like Key Stats — the app fetches and computes it; **Claude is not involved**
(no control-server push, no `/research` skill changes, no `PushPanelType` entry).

## Architecture

```
Renderer: ScorecardPanel.tsx (fetches on init)
   └─ window.api.getScorecards(symbol)            ← new IPC method on AssayApi
        └─ src/main/ipc/handlers.ts               ← new handler
             └─ src/main/services/scorecardService.ts   (NEW — orchestration)
                  ├─ yahooService.getResearch(symbol)       ← extended (more fields + ETF modules)
                  ├─ yahooService.getDailyHistory(symbol)   ← for Technical (RSI / MA / momentum)
                  └─ src/main/services/scoring.ts           (NEW — pure, no I/O)
                       → Scorecards
```

**Separation of concerns:**
- `scorecardService.ts` — orchestrates fetches, decides stock vs ETF, assembles the `Scorecards` object. Owns all I/O.
- `scoring.ts` — **pure, side-effect-free**: takes already-fetched data (a `YahooResearch`, an optional `EtfData`, and a `DailyBar[]`) and returns scored cards. No network, no Electron imports → unit-testable in isolation.

This boundary is the reusable pattern the later sub-projects (DCF, peers) will follow: *thin I/O service over a pure compute module.*

## Data layer (Yahoo-primary)

Single primary source: Yahoo `quoteSummary` via the existing `yahooService.ts` (`net.fetch` +
cookie/crumb flow). Yahoo already returns most "gap" metrics **pre-computed**, so no SEC XBRL work
in this cut.

**Extend `YahooResearch`** with fields Yahoo already exposes:
`enterpriseToEbitda`, `currentRatio`, `debtToEquity`, `payoutRatio`, `returnOnAssets`.
(`pegRatio`, margins, `freeCashflow`, `totalDebt`, `dividendYield`, 50/200-day avgs, 52wk hi/lo,
`revenueGrowth`, `earningsGrowth`, `returnOnEquity`, `marketCap` already present.)

**New `EtfData`** (from Yahoo `topHoldings` / `fundProfile` modules):
`expenseRatio`, `distributionYield`, `totalAssets` (AUM), `topHoldings: {symbol, name, weight}[]`,
`sectorWeights: {sector, weight}[]`.

**Stock vs ETF detection:** Yahoo `quoteType` (`EQUITY` → stock cards; `ETF` → ETF cards).

**Missing data:** any field Yahoo omits → that metric renders as "—" and is excluded from the card
rollup (graceful degradation, same philosophy as the current Fundamentals panel). **SEC fallback is
out of scope for this cut** — revisit only if real-world coverage proves too thin.

## Scoring model

Reuses the existing `Metric` type (`label / value / sub / tone: 'good'|'bad'|'neutral'`).

- **Per-metric scoring:** each metric is graded against a **flat threshold table** of tunable
  constants in `scoring.ts` → `good | bad | neutral`. Example: trailing P/E `<15` good, `15–30`
  neutral, `>30` bad. Missing value → omitted (no tone).
- **Card rollup (CHOSEN: ratio-based):** card `status` is derived from the ratio of `good` vs `bad`
  metrics among the metrics that *have* a tone: predominantly good → 🟢, predominantly bad → 🔴,
  mixed or too few scored metrics → 🟡. (Alternative considered: "worst metric dominates" — rejected
  as too punishing for a single weak metric. Flag at review if you prefer it.)
- **No cross-card composite.** Each card stands alone.

### ⚠️ Future work — sector-aware thresholds (NOT in this cut)

Thresholds are **flat / sector-agnostic** in v1 (a P/E of 30 scores the same for a utility and a
SaaS name). This is a deliberate YAGNI simplification. **Sector-aware thresholds are explicitly
deferred to a later pass** — when added, the threshold table becomes a function of the Yahoo
`sector`/`industry` already present on `YahooResearch`. Tracked as a follow-up; do not build now.

## Card definitions

| Card | Metrics (data permitting) |
|---|---|
| 💰 Value | trailing P/E, forward P/E, P/B, P/S, EV/EBITDA, FCF yield (FCF ÷ market cap), ROE, ROA, debt/equity, current ratio |
| 📈 Growth | revenue growth (YoY), earnings growth, gross/operating/profit margins, PEG |
| 💵 Dividend | dividend yield, payout ratio, FCF coverage. Non-payer → single neutral note "No dividend", card 🟡 |
| 📉 Technical | price vs 50-day MA, price vs 200-day MA, distance from 52wk high/low, 3-/6-mo momentum, RSI(14) — all computed from `DailyBar[]` |
| 🧺 ETF profile | expense ratio, distribution yield, AUM, top holdings, sector weights |
| 📉 ETF technical | same technical metrics as stocks (price vs MAs, 52wk, momentum, RSI) |

Technical/RSI/MA/momentum are computed in `scoring.ts` from the daily history array — pure functions.

## Panel contract (`src/shared/types.ts`)

```ts
export type ScorecardTone = 'good' | 'bad' | 'neutral'

export interface Scorecard {
  key: 'value' | 'growth' | 'dividend' | 'technical' | 'etf-profile' | 'etf-technical'
  title: string            // e.g. "💰 Value"
  status: ScorecardTone    // rolled-up card color
  metrics: Metric[]        // reuses existing Metric
  note?: string            // e.g. "No dividend" or a data caveat
}

export interface Scorecards {
  symbol: string
  kind: 'stock' | 'etf'
  cards: Scorecard[]
  asOf: string             // ISO timestamp
}
```

Add to `AssayApi`: `getScorecards(symbol: string): Promise<Scorecards | null>` (returns `null` on
total failure, mirroring `getFundamentals`).

## Renderer (`src/renderer/components/ScorecardPanel.tsx`)

- Fetches via `window.api.getScorecards(symbol)` on init; loading / empty / filled states like
  other panels.
- Grid of cards. Each card: header (emoji title + colored status dot) over a metric list
  (`label · value · sub`, tinted by `tone`). `note` shown beneath the metrics.
- ETF tickers render the ETF card set; same component, different `cards` array (driven by `kind`).
- **Tailwind only.** No new dependencies.

## Testing

- **`scoring.ts` unit tests** (pure → no network): table-driven fixtures of `YahooResearch` +
  `EtfData` + `DailyBar[]` → asserted metric tones and card rollups.
- **Required edge cases:** missing fields ("—", excluded from rollup); non-dividend payer; negative
  earnings (P/E undefined); ETF path (`kind: 'etf'`); too-short price history for 200-day MA / RSI.
- **Success criterion:** given fixture X, `scoring.ts` produces tones/rollups Y — fully offline.
- `npm run lint` green; manual `npm run dev` + `/research AAPL` (stock) and an ETF (e.g. `SPY`) to
  confirm both card sets render.

## Out of scope (this cut)

- SEC XBRL as a data source for scorecards (Yahoo-primary only; SEC fallback deferred).
- Sector-aware thresholds (deferred — see Future work above).
- Composite / overall score across cards (intentionally never).
- Any Claude / control-server / `/research` skill involvement.
- The other five sub-projects (DCF, News+Risks, Peers, FRED, Value-chain).

## Open items for spec review

1. Rollup rule defaulted to **ratio-based**; confirm or switch to worst-metric-dominates.
2. Commit policy: this repo's convention is "commit only when asked" — confirm whether to commit
   this spec (and later the implementation).
