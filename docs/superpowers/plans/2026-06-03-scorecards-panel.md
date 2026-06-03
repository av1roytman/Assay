# Rule Scorecards Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an app-owned "Scorecards" dashboard panel that grades the researched ticker on Value/Growth/Dividend/Technical (stocks) or Profile/Technical (ETFs) with green/yellow/red cards computed from Yahoo data.

**Architecture:** A pure, testable `scoring.ts` module computes cards from already-fetched data; a thin `scorecardService.ts` orchestrates Yahoo fetches and hands them to `scoring.ts`; the result reaches the renderer via a new `stocks:scorecards` IPC channel and a `ScorecardPanel` component mounted in the dashboard grid. Claude/control-server are NOT involved — this mirrors the existing Key Stats path.

**Tech Stack:** TypeScript, Electron `net.fetch` (Yahoo quoteSummary + v8 chart), React + Tailwind, Vitest (new — for the pure scoring tests).

**Spec:** `docs/superpowers/specs/2026-06-03-scorecards-panel-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `package.json` | add `vitest` devDep + `test` script | Modify |
| `vitest.config.ts` | Vitest config (node env) | Create |
| `src/shared/types.ts` | `ScorecardTone`, `Scorecard`, `Scorecards`, `EtfData`; extend `YahooResearch`; add `getScorecards` to `AssayApi` | Modify |
| `src/main/services/scoring.ts` | **pure** — data → scored cards (no I/O) | Create |
| `src/main/services/scoring.test.ts` | unit tests for `scoring.ts` | Create |
| `src/main/services/yahooService.ts` | parse extra fields + ETF modules + `quoteType` | Modify |
| `src/main/services/scorecardService.ts` | orchestrate fetch → scoring | Create |
| `src/main/ipc/handlers.ts` | register `stocks:scorecards` | Modify |
| `src/preload/index.ts` | expose `getScorecards` | Modify |
| `src/renderer/components/ScorecardPanel.tsx` | render the cards | Create |
| `src/renderer/App.tsx` | fetch + mount the panel | Modify |

---

## Task 1: Add Vitest test runner

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/main/services/_smoke.test.ts` (temporary, deleted in Step 5)

- [ ] **Step 1: Install Vitest**

Run:
```
npm install -D vitest@^2.0.0
```
Expected: `vitest` appears under `devDependencies`. (If npm hits the AVG TLS issue, use `$env:NODE_OPTIONS="--use-system-ca"; npm install -D vitest@^2.0.0` for THIS install command only — see CLAUDE.md gotchas — then clear the env var.)

- [ ] **Step 2: Add the `test` script**

In `package.json`, add to `"scripts"` (after the `"lint"` line):
```json
    "test": "vitest run",
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
```

- [ ] **Step 4: Add a smoke test to prove the runner works**

Create `src/main/services/_smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('vitest runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run: `npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 5: Delete the smoke test and commit**

```bash
rm src/main/services/_smoke.test.ts
git add package.json vitest.config.ts package-lock.json
git commit -m "chore: add vitest test runner"
```

---

## Task 2: Define the panel contracts in shared types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the scorecard types**

In `src/shared/types.ts`, directly AFTER the `Metric` interface (the one ending with the `tone?: 'good' | 'bad' | 'neutral'` field and its closing `}`), add:
```ts
// ── Scorecards (app-owned, computed in main from Yahoo) ──────────────────────

export type ScorecardTone = 'good' | 'bad' | 'neutral'

export type ScorecardKey =
  | 'value'
  | 'growth'
  | 'dividend'
  | 'technical'
  | 'etf-profile'
  | 'etf-technical'

export interface Scorecard {
  key: ScorecardKey
  title: string // e.g. "💰 Value"
  status: ScorecardTone // rolled-up card color
  metrics: Metric[] // reuses the Metric type above
  note?: string // e.g. "No dividend" or a data caveat
}

export interface Scorecards {
  symbol: string
  kind: 'stock' | 'etf'
  cards: Scorecard[]
  asOf: string // ISO timestamp
}

// ETF-specific data from Yahoo's topHoldings / fundProfile modules. All weights
// and ratios are stored as fractions (0.0009 = 0.09%), formatted at render time.
export interface EtfData {
  expenseRatio?: number // fraction, e.g. 0.0009
  distributionYield?: number // fraction, e.g. 0.013
  totalAssets?: number // AUM in USD
  topHoldings?: { symbol?: string; name?: string; weight?: number }[] // weight as fraction
  sectorWeights?: { sector: string; weight: number }[] // weight as fraction
}
```

- [ ] **Step 2: Extend `YahooResearch` with the gap fields, `quoteType`, and ETF data**

In `src/shared/types.ts`, inside `interface YahooResearch`, add these fields just before the `analyst?: AnalystConsensus` line:
```ts
  enterpriseToEbitda?: number
  currentRatio?: number
  debtToEquity?: number
  payoutRatio?: number // fraction, e.g. 0.25 = 25%
  returnOnAssets?: number
  quoteType?: string // Yahoo price.quoteType: "EQUITY" | "ETF" | …
  etf?: EtfData // present only for ETFs
```

- [ ] **Step 3: Add the IPC method to `AssayApi`**

In `src/shared/types.ts`, inside `interface AssayApi`, add after the `getFundamentals` line:
```ts
  getScorecards(symbol: string): Promise<Scorecards | null>
```

- [ ] **Step 4: Verify it type-checks**

Run: `npm run lint`
Expected: PASS (no errors). The new types aren't used yet, which is fine.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add scorecard panel contracts"
```

---

## Task 3: Build the pure scoring module (TDD)

This is the heart of the feature. `scoring.ts` takes already-fetched data and returns `Scorecard[]`. It does NO I/O — only `YahooResearch` and `DailyBar[]` go in. All thresholds live in one place.

**Files:**
- Create: `src/main/services/scoring.ts`
- Create: `src/main/services/scoring.test.ts`

- [ ] **Step 1: Write the failing test for the rollup rule**

Create `src/main/services/scoring.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { rollup, buildScorecards } from './scoring'
import type { YahooResearch, DailyBar } from '../../shared/types'

describe('rollup', () => {
  it('is good when good metrics exceed bad by >= 2', () => {
    expect(rollup(['good', 'good', 'bad'])).toBe('good')
  })
  it('is bad when bad metrics exceed good by >= 2', () => {
    expect(rollup(['bad', 'bad', 'good'])).toBe('bad')
  })
  it('is neutral when the margin is < 2', () => {
    expect(rollup(['good', 'bad'])).toBe('neutral')
  })
  it('is neutral when fewer than 2 metrics are scored', () => {
    expect(rollup(['good'])).toBe('neutral')
    expect(rollup([])).toBe('neutral')
  })
  it('ignores neutral tones in the margin', () => {
    expect(rollup(['good', 'good', 'neutral'])).toBe('good')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot import `rollup`/`buildScorecards` from `./scoring` (module not found).

- [ ] **Step 3: Create `scoring.ts` with the rollup + threshold engine**

Create `src/main/services/scoring.ts`:
```ts
// Pure scoring engine for the Scorecards panel. NO I/O — callers pass already-
// fetched Yahoo research + daily bars; this returns scored cards. Kept free of
// Electron/network imports so it is unit-testable in plain Node (vitest).
//
// THRESHOLDS ARE FLAT / SECTOR-AGNOSTIC by design (v1). Sector-aware thresholds
// are deferred — see docs/superpowers/specs/2026-06-03-scorecards-panel-design.md
// ("Future work — sector-aware thresholds"). Do not add per-sector logic here
// without revisiting that spec.

import type {
  YahooResearch,
  DailyBar,
  Metric,
  Scorecard,
  ScorecardKey,
  ScorecardTone
} from '../../shared/types'

// Roll a list of metric tones into one card status. Margin rule: a card is good
// (bad) only when good (bad) metrics outnumber the other by >= 2; otherwise
// neutral. Pure neutrals don't count toward the margin. Fewer than 2 scored
// metrics → neutral (not enough signal).
export function rollup(tones: ScorecardTone[]): ScorecardTone {
  const good = tones.filter((t) => t === 'good').length
  const bad = tones.filter((t) => t === 'bad').length
  if (good + bad < 2) return 'neutral'
  if (good - bad >= 2) return 'good'
  if (bad - good >= 2) return 'bad'
  return 'neutral'
}

// 'high' = bigger is better (margins, ROE); 'low' = smaller is better (P/E, D/E).
type Dir = 'high' | 'low'

// Score a value: for 'high', >= goodAt → good, <= badAt → bad. For 'low', the
// comparison flips (goodAt <= badAt, e.g. P/E good <=15, bad >=30).
function score(value: number | undefined, dir: Dir, goodAt: number, badAt: number): ScorecardTone {
  if (value == null || !Number.isFinite(value)) return 'neutral'
  if (dir === 'high') {
    if (value >= goodAt) return 'good'
    if (value <= badAt) return 'bad'
    return 'neutral'
  }
  if (value <= goodAt) return 'good'
  if (value >= badAt) return 'bad'
  return 'neutral'
}

// Build a toned Metric, or undefined when the source value is missing (so the
// card omits it). Mirrors how the Key Stats panel degrades to "—".
function metric(
  label: string,
  value: number | undefined,
  fmt: (n: number) => string,
  tone: ScorecardTone,
  sub?: string
): Metric | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  return { label, value: fmt(value), tone, sub }
}

const x = (n: number): string => `${n.toFixed(1)}×`
const pct = (n: number): string => `${(n * 100).toFixed(1)}%` // input is a fraction
const pctRaw = (n: number): string => `${n.toFixed(1)}%` // input is already a percent
const ratio = (n: number): string => n.toFixed(2)

function compact(...m: (Metric | undefined)[]): Metric[] {
  return m.filter((v): v is Metric => v != null)
}

function card(key: ScorecardKey, title: string, metrics: Metric[], note?: string): Scorecard {
  return { key, title, status: rollup(metrics.map((m) => m.tone ?? 'neutral')), metrics, note }
}

function fmtBigUsd(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  return '$' + n.toFixed(0)
}

// ── Stock cards ──────────────────────────────────────────────────────────────

function valueCard(r: YahooResearch): Scorecard {
  const fcfYield = r.freeCashflow != null && r.marketCap ? r.freeCashflow / r.marketCap : undefined
  const metrics = compact(
    metric('P/E (ttm)', r.trailingPE, x, score(r.trailingPE, 'low', 15, 30)),
    metric('Fwd P/E', r.forwardPE, x, score(r.forwardPE, 'low', 15, 30)),
    metric('P/B', r.priceToBook, x, score(r.priceToBook, 'low', 1.5, 5)),
    metric('P/S', r.priceToSales, x, score(r.priceToSales, 'low', 2, 8)),
    metric('EV/EBITDA', r.enterpriseToEbitda, x, score(r.enterpriseToEbitda, 'low', 10, 20)),
    metric('FCF yield', fcfYield, pct, score(fcfYield, 'high', 0.05, 0.01)),
    metric('ROE', r.returnOnEquity, pct, score(r.returnOnEquity, 'high', 0.15, 0.05)),
    metric('ROA', r.returnOnAssets, pct, score(r.returnOnAssets, 'high', 0.08, 0.02)),
    metric('Debt/Equity', r.debtToEquity, ratio, score(r.debtToEquity, 'low', 50, 150)),
    metric('Current ratio', r.currentRatio, ratio, score(r.currentRatio, 'high', 1.5, 1))
  )
  return card('value', '💰 Value', metrics)
}

function growthCard(r: YahooResearch): Scorecard {
  const metrics = compact(
    metric('Revenue growth', r.revenueGrowth, pct, score(r.revenueGrowth, 'high', 0.1, 0)),
    metric('Earnings growth', r.earningsGrowth, pct, score(r.earningsGrowth, 'high', 0.1, 0)),
    metric('Gross margin', r.grossMargins, pct, score(r.grossMargins, 'high', 0.4, 0.2)),
    metric('Operating margin', r.operatingMargins, pct, score(r.operatingMargins, 'high', 0.15, 0.05)),
    metric('Profit margin', r.profitMargins, pct, score(r.profitMargins, 'high', 0.1, 0.02)),
    metric('PEG', r.pegRatio, ratio, score(r.pegRatio, 'low', 1, 2))
  )
  return card('growth', '📈 Growth', metrics)
}

function dividendCard(r: YahooResearch): Scorecard {
  if (r.dividendYield == null || r.dividendYield === 0) {
    return { key: 'dividend', title: '💵 Dividend', status: 'neutral', metrics: [], note: 'No dividend' }
  }
  const metrics = compact(
    // dividendYield is stored as a percent (yahooService multiplies by 100).
    metric('Yield', r.dividendYield, pctRaw, score(r.dividendYield, 'high', 2, 0.5)),
    // payoutRatio is a fraction; <0.6 healthy, >0.9 stretched.
    metric('Payout ratio', r.payoutRatio, pct, score(r.payoutRatio, 'low', 0.6, 0.9))
  )
  return card('dividend', '💵 Dividend', metrics)
}

// ── Technical (computed from daily bars) ─────────────────────────────────────

export function sma(closes: number[], period: number): number | undefined {
  if (closes.length < period) return undefined
  let sum = 0
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i]
  return sum / period
}

// Simple (non-Wilder) RSI over `period` (default 14). Needs > period bars.
export function rsi(closes: number[], period = 14): number | undefined {
  if (closes.length <= period) return undefined
  let gain = 0
  let loss = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gain += diff
    else loss -= diff
  }
  const avgGain = gain / period
  const avgLoss = loss / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

// Percent return over the trailing `days` (calendar) using the bar nearest the cutoff.
function momentum(bars: DailyBar[], days: number): number | undefined {
  if (bars.length === 0) return undefined
  const last = bars[bars.length - 1]
  const cutoff = Date.parse(last.time) - days * 86_400_000
  if (Date.parse(bars[0].time) > cutoff) return undefined
  const base = bars.find((b) => Date.parse(b.time) >= cutoff)
  return base && base.close ? ((last.close - base.close) / base.close) * 100 : undefined
}

function technicalCard(bars: DailyBar[], key: ScorecardKey): Scorecard {
  const closes = bars.map((b) => b.close)
  const price = closes.length ? closes[closes.length - 1] : undefined
  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  const vs50 = ma50 != null && price != null ? ((price - ma50) / ma50) * 100 : undefined
  const vs200 = ma200 != null && price != null ? ((price - ma200) / ma200) * 100 : undefined
  const window52 = bars.slice(-252)
  const hi52 = window52.length ? Math.max(...window52.map((b) => b.high)) : undefined
  const lo52 = window52.length ? Math.min(...window52.map((b) => b.low)) : undefined
  const fromHigh = hi52 && price != null ? ((price - hi52) / hi52) * 100 : undefined
  const fromLow = lo52 && price != null ? ((price - lo52) / lo52) * 100 : undefined
  const r = rsi(closes, 14)
  const mom3 = momentum(bars, 90)
  const mom6 = momentum(bars, 180)

  // RSI is a band, not monotonic: overbought (>70) and oversold (<30) are both
  // cautionary; a healthy trend sits ~45–65.
  const rsiTone: ScorecardTone =
    r == null ? 'neutral' : r > 70 || r < 30 ? 'bad' : r >= 45 && r <= 65 ? 'good' : 'neutral'

  const metrics = compact(
    metric('vs 50-day MA', vs50, pctRaw, score(vs50, 'high', 2, -2)),
    metric('vs 200-day MA', vs200, pctRaw, score(vs200, 'high', 2, -2)),
    metric('From 52wk high', fromHigh, pctRaw, score(fromHigh, 'high', -10, -25)),
    metric('From 52wk low', fromLow, pctRaw, score(fromLow, 'high', 20, 5)),
    metric('3-mo momentum', mom3, pctRaw, score(mom3, 'high', 5, -5)),
    metric('6-mo momentum', mom6, pctRaw, score(mom6, 'high', 10, -10)),
    metric('RSI (14)', r, (n) => n.toFixed(0), rsiTone)
  )
  return card(key, '📉 Technical', metrics)
}

// ── ETF profile ──────────────────────────────────────────────────────────────

function etfProfileCard(r: YahooResearch): Scorecard {
  const e = r.etf ?? {}
  const top = (e.topHoldings ?? [])
    .slice(0, 5)
    .map((h) =>
      `${h.symbol ?? h.name ?? '?'} ${h.weight != null ? (h.weight * 100).toFixed(1) + '%' : ''}`.trim()
    )
    .join(', ')
  const metrics = compact(
    metric('Expense ratio', e.expenseRatio, (n) => `${(n * 100).toFixed(2)}%`, score(e.expenseRatio, 'low', 0.002, 0.0075)),
    metric('Distribution yield', e.distributionYield, (n) => `${(n * 100).toFixed(2)}%`, 'neutral'),
    metric('AUM', e.totalAssets, fmtBigUsd, score(e.totalAssets, 'high', 1e9, 5e7))
  )
  const note = top ? `Top holdings: ${top}` : undefined
  return card('etf-profile', '🧺 ETF Profile', metrics, note)
}

// ── Public entry point ───────────────────────────────────────────────────────

export function buildScorecards(research: YahooResearch | null, bars: DailyBar[]): Scorecard[] {
  const isEtf = (research?.quoteType ?? '').toUpperCase() === 'ETF'
  if (isEtf) {
    return [etfProfileCard(research ?? {}), technicalCard(bars, 'etf-technical')]
  }
  const r = research ?? {}
  return [valueCard(r), growthCard(r), dividendCard(r), technicalCard(bars, 'technical')]
}
```

- [ ] **Step 4: Run the rollup tests to verify they pass**

Run: `npm test`
Expected: PASS — the 5 `rollup` tests pass.

- [ ] **Step 5: Add card-building tests (stocks, ETF, edge cases)**

Append to `src/main/services/scoring.test.ts`:
```ts
function bars(closes: number[]): DailyBar[] {
  // Daily bars one calendar day apart, oldest first.
  const start = Date.parse('2023-01-01')
  return closes.map((c, i) => ({
    time: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1000
  }))
}

describe('buildScorecards — stock', () => {
  const research: YahooResearch = {
    quoteType: 'EQUITY',
    trailingPE: 12, // good (<=15)
    returnOnEquity: 0.2, // good (>=0.15)
    grossMargins: 0.5, // good
    revenueGrowth: 0.15, // good
    dividendYield: 1.5, // payer
    payoutRatio: 0.3,
    freeCashflow: 1000,
    marketCap: 10000 // FCF yield 10% → good
  }
  const cards = buildScorecards(research, bars(Array.from({ length: 60 }, (_, i) => 100 + i)))

  it('returns the four stock cards in order', () => {
    expect(cards.map((c) => c.key)).toEqual(['value', 'growth', 'dividend', 'technical'])
  })
  it('scores a cheap, profitable name as a good value card', () => {
    expect(cards[0].status).toBe('good')
  })
  it('omits metrics whose source data is missing', () => {
    // priceToBook was not supplied → no "P/B" metric present
    expect(cards[0].metrics.find((m) => m.label === 'P/B')).toBeUndefined()
  })
})

describe('buildScorecards — non-dividend payer', () => {
  it('shows a neutral dividend card with a note and no metrics', () => {
    const cards = buildScorecards({ quoteType: 'EQUITY' }, [])
    const div = cards.find((c) => c.key === 'dividend')!
    expect(div.metrics).toHaveLength(0)
    expect(div.note).toBe('No dividend')
    expect(div.status).toBe('neutral')
  })
})

describe('buildScorecards — ETF', () => {
  it('returns the ETF card set', () => {
    const cards = buildScorecards(
      { quoteType: 'ETF', etf: { expenseRatio: 0.0009, totalAssets: 5e10 } },
      bars(Array.from({ length: 5 }, (_, i) => 100 + i))
    )
    expect(cards.map((c) => c.key)).toEqual(['etf-profile', 'etf-technical'])
  })
})

describe('buildScorecards — short history', () => {
  it('omits MA/RSI metrics when there are too few bars', () => {
    const cards = buildScorecards({ quoteType: 'EQUITY' }, bars([100, 101, 102]))
    const tech = cards.find((c) => c.key === 'technical')!
    expect(tech.metrics.find((m) => m.label === 'vs 200-day MA')).toBeUndefined()
    expect(tech.metrics.find((m) => m.label === 'RSI (14)')).toBeUndefined()
  })
})
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — all `rollup` + `buildScorecards` tests green.

- [ ] **Step 7: Lint and commit**

Run: `npm run lint`
Expected: PASS.
```bash
git add src/main/services/scoring.ts src/main/services/scoring.test.ts
git commit -m "feat(scoring): pure scorecard engine with tests"
```

---

## Task 4: Extend yahooService to fetch the new fields + ETF modules

`getResearchData` already returns a `YahooResearch`. Add the gap fields, `quoteType`, and the ETF modules to its module list and parser.

**Files:**
- Modify: `src/main/services/yahooService.ts`

- [ ] **Step 1: Add the ETF modules to `RESEARCH_MODULES`**

In `src/main/services/yahooService.ts`, change the `RESEARCH_MODULES` constant to:
```ts
const RESEARCH_MODULES =
  'assetProfile,price,summaryDetail,defaultKeyStatistics,financialData,topHoldings,fundProfile'
```

- [ ] **Step 2: Add `EtfData` to the type import**

In `src/main/services/yahooService.ts`, extend the existing `import type { … } from '../../shared/types'` line to include `EtfData`:
```ts
import type { DailyBar, IntradayBar, Fundamentals, YahooResearch, EtfData } from '../../shared/types'
```

- [ ] **Step 3: Add the `parseEtf` helper**

Add this helper directly ABOVE the `parseResearch` function:
```ts
interface HoldingNode {
  symbol?: string
  holdingName?: string
  holdingPercent?: unknown
}

// Pull ETF-specific fields from the topHoldings / fundProfile modules. Returns
// undefined for non-ETFs (modules absent), so YahooResearch.etf stays unset.
function parseEtf(r: Record<string, Record<string, unknown>>): EtfData | undefined {
  const th = r.topHoldings
  const fp = r.fundProfile
  if (!th && !fp) return undefined
  const holdings = Array.isArray(th?.holdings)
    ? (th.holdings as HoldingNode[]).map((h) => ({
        symbol: typeof h.symbol === 'string' ? h.symbol : undefined,
        name: typeof h.holdingName === 'string' ? h.holdingName : undefined,
        weight: rawNum(h.holdingPercent)
      }))
    : undefined
  const sectorWeights = Array.isArray(th?.sectorWeightings)
    ? (th.sectorWeightings as Record<string, unknown>[])
        .map((node) => {
          const entry = Object.entries(node)[0]
          if (!entry) return undefined
          const [sector, val] = entry
          const weight = rawNum(val)
          return weight != null ? { sector, weight } : undefined
        })
        .filter((s): s is { sector: string; weight: number } => s != null)
    : undefined
  const feesNode = (fp?.feesExpensesInvestment as Record<string, unknown>) ?? {}
  const sd = r.summaryDetail ?? {}
  const ks = r.defaultKeyStatistics ?? {}
  return {
    expenseRatio: rawNum(feesNode.annualReportExpenseRatio),
    distributionYield: rawNum((th as Record<string, unknown>)?.yield),
    totalAssets: rawNum(sd.totalAssets) ?? rawNum(ks.totalAssets),
    topHoldings: holdings,
    sectorWeights
  }
}
```

- [ ] **Step 4: Parse the new fields in `parseResearch`**

In `parseResearch`, add these properties to the returned object, just BEFORE the `analyst:` property:
```ts
    enterpriseToEbitda: rawNum(ks.enterpriseToEbitda) ?? rawNum(fd.enterpriseToEbitda),
    currentRatio: rawNum(fd.currentRatio),
    debtToEquity: rawNum(fd.debtToEquity),
    payoutRatio: rawNum(sd.payoutRatio),
    returnOnAssets: rawNum(fd.returnOnAssets),
    quoteType: strVal((pr as Record<string, unknown>).quoteType),
    etf: parseEtf(r),
```

- [ ] **Step 5: Verify type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/yahooService.ts
git commit -m "feat(yahoo): parse scorecard gap fields + ETF modules"
```

---

## Task 5: Add the orchestration service

**Files:**
- Create: `src/main/services/scorecardService.ts`

- [ ] **Step 1: Create the service**

Create `src/main/services/scorecardService.ts`:
```ts
// Orchestrates the Scorecards panel: fetch Yahoo research + daily history, hand
// them to the pure scoring engine, assemble the Scorecards payload. All I/O lives
// here; the math lives in scoring.ts. Returns null only when we have neither
// research nor price history (panel then renders empty).

import { getResearchData, getDailyHistory } from './yahooService'
import { buildScorecards } from './scoring'
import type { Scorecards } from '../../shared/types'

export async function getScorecards(symbol: string): Promise<Scorecards | null> {
  const sym = symbol.trim().toUpperCase()
  if (!sym) return null
  const [research, bars] = await Promise.all([getResearchData(sym), getDailyHistory(sym)])
  if (!research && bars.length === 0) return null
  const kind = (research?.quoteType ?? '').toUpperCase() === 'ETF' ? 'etf' : 'stock'
  const cards = buildScorecards(research, bars)
  console.log('[scorecards] for', sym, '->', kind, cards.length, 'cards')
  return { symbol: sym, kind, cards, asOf: new Date().toISOString() }
}
```

- [ ] **Step 2: Verify type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/scorecardService.ts
git commit -m "feat(scorecards): orchestration service"
```

---

## Task 6: Wire the IPC channel through preload

**Files:**
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Register the handler**

In `src/main/ipc/handlers.ts`, add this import below the existing service imports:
```ts
import { getScorecards } from '../services/scorecardService'
```
Then inside `registerIpc()`, add after the `stocks:fundamentals` line:
```ts
  ipcMain.handle('stocks:scorecards', (_e, symbol: string) => getScorecards(symbol))
```

- [ ] **Step 2: Expose it in preload**

In `src/preload/index.ts`, add `Scorecards` to the `import type { … }` list, then add to the `api` object after the `getFundamentals` entry:
```ts
  getScorecards: (symbol: string): Promise<Scorecards | null> =>
    ipcRenderer.invoke('stocks:scorecards', symbol),
```

- [ ] **Step 3: Verify type-check**

Run: `npm run lint`
Expected: PASS — `AssayApi` is now fully satisfied by the preload `api` object.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "feat(ipc): expose getScorecards to renderer"
```

---

## Task 7: Render the panel and mount it in the dashboard

**Files:**
- Create: `src/renderer/components/ScorecardPanel.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create the component**

Create `src/renderer/components/ScorecardPanel.tsx`:
```tsx
import type { Scorecards, Scorecard, ScorecardTone, Metric } from '../../shared/types'

const DOT: Record<ScorecardTone, string> = {
  good: 'bg-emerald-400',
  bad: 'bg-red-400',
  neutral: 'bg-amber-400'
}

const VALUE_TONE: Record<ScorecardTone, string> = {
  good: 'text-emerald-300',
  bad: 'text-red-300',
  neutral: 'text-zinc-100'
}

export function ScorecardGrid({ data }: { data: Scorecards }): JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.cards.map((c) => (
        <Card key={c.key} card={c} />
      ))}
    </div>
  )
}

function Card({ card }: { card: Scorecard }): JSX.Element {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-800/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${DOT[card.status]}`} />
        <span className="text-sm font-medium text-zinc-200">{card.title}</span>
      </div>
      {card.metrics.length > 0 ? (
        <div className="space-y-1">
          {card.metrics.map((m, i) => (
            <Row key={i} m={m} />
          ))}
        </div>
      ) : (
        <div className="text-xs text-zinc-500">{card.note ?? 'No data'}</div>
      )}
      {card.metrics.length > 0 && card.note && (
        <div className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">{card.note}</div>
      )}
    </div>
  )
}

function Row({ m }: { m: Metric }): JSX.Element {
  const tone = VALUE_TONE[m.tone ?? 'neutral']
  return (
    <div className="flex items-baseline justify-between gap-2 text-[13px]">
      <span className="text-zinc-500">{m.label}</span>
      <span className={`tabular-nums font-medium ${tone}`}>{m.value}</span>
    </div>
  )
}
```

- [ ] **Step 2: Mount it in the dashboard**

In `src/renderer/App.tsx`:

(a) Merge `Scorecards` into the existing `import type { … } from '../shared/types'` list.

(b) Add the component import directly after the `import { ChartPanel } …` line:
```ts
import { ScorecardGrid } from './components/ScorecardPanel'
```

(c) Inside `Dashboard`, add state next to the other `useState` hooks:
```ts
  const [scorecards, setScorecards] = useState<Scorecards | null | undefined>(undefined)
```

(d) In the first `useEffect` (the `[ticker]` data-fetch effect, alongside the `getFundamentals` call), add:
```ts
    setScorecards(undefined)
    void window.api
      .getScorecards(ticker)
      .then(setScorecards)
      .catch(() => setScorecards(null))
```

(e) In the returned grid, add a new `Panel` immediately after the `<Panel title="Key stats">…</Panel>` block:
```tsx
        <Panel title="Scorecards">
          {scorecards === undefined ? (
            <Loading />
          ) : scorecards === null || scorecards.cards.length === 0 ? (
            <Empty msg="No scorecard data" />
          ) : (
            <ScorecardGrid data={scorecards} />
          )}
        </Panel>
```

- [ ] **Step 3: Verify type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ScorecardPanel.tsx src/renderer/App.tsx
git commit -m "feat(renderer): scorecards panel"
```

---

## Task 8: End-to-end verification

**Files:** none (manual), plus a roadmap doc update.

- [ ] **Step 1: Full test + lint**

Run: `npm test`
Expected: PASS (all scoring tests).
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 2: Manual click-through (stock)**

Run `npm run dev` (⚠ never with `NODE_OPTIONS=--use-system-ca` — see CLAUDE.md), then in Claude Code run `/research AAPL`.
Expected: the new "Scorecards" panel renders four cards (💰 Value, 📈 Growth, 💵 Dividend, 📉 Technical), each with a colored status dot and metric rows. Main-process console shows `[scorecards] for AAPL -> stock 4 cards`.

- [ ] **Step 3: Manual click-through (ETF)**

Run `/research SPY`.
Expected: the panel renders 🧺 ETF Profile (expense ratio, AUM, top-holdings note) + 📉 Technical. Console shows `[scorecards] for SPY -> etf 2 cards`. If expense ratio / AUM show "—", inspect a real `SPY` quoteSummary response and adjust the field paths in `parseEtf` (see Self-Review note).

- [ ] **Step 4: Update CLAUDE.md roadmap**

In `CLAUDE.md`, under "### v2 — fill out the panels", replace the scorecards line with:
```md
- [x] Rule-scorecards panel (app-computed, Yahoo-primary; SEC + sector-aware thresholds deferred — see docs/superpowers/specs/2026-06-03-scorecards-panel-design.md)
```
And in the Yahoo source row note that scorecards now consume `topHoldings`/`fundProfile` + the extra `financialData` ratios.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: check off scorecards panel in roadmap"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** app-owned IPC panel ✓ (Tasks 5–7); Yahoo-primary + graceful "—"/omit ✓ (Task 4 + `metric()` returns undefined); all 4 stock cards + ETF set ✓ (Task 3); flat thresholds with sector-aware explicitly deferred in code comment + roadmap note ✓; ratio-based rollup (margin ≥ 2) ✓ (`rollup`); reuse `Metric` ✓; pure module + unit tests covering required edge cases — missing fields, non-payer, short history, ETF path ✓ (Task 3). Negative-earnings case: Yahoo omits `trailingPE` when EPS<0 → that metric is omitted, exercised by the "omits missing" test.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `getScorecards` signature identical across types.ts / preload / handler / service; `Scorecard`/`Scorecards`/`ScorecardTone`/`ScorecardKey`/`EtfData` defined once (Task 2) and reused; `buildScorecards(research, bars)` and `rollup(tones)` signatures match between `scoring.ts` and `scoring.test.ts`; `technicalCard(bars, key)` always called with a `ScorecardKey`.
- **Known approximation to confirm during build:** Yahoo's exact ETF field paths (`fundProfile.feesExpensesInvestment.annualReportExpenseRatio`, `topHoldings.yield`, `topHoldings.sectorWeightings`) and the `totalAssets` location vary by ticker — Task 8 Step 3 is where you confirm/adjust against a real `SPY` response. The graceful-omit design means a wrong path degrades to "—", never a crash.
