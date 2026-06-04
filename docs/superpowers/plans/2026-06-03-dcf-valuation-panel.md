# DCF Valuation Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an app-owned "Valuation (DCF)" panel that computes a stock's intrinsic value per share via a 2-stage equity DCF + reverse-DCF check, and feed the result into the `/research` data bundle so Claude's recommendation references it.

**Architecture:** A pure, vitest-tested `dcf.ts` engine (no I/O, like `scoring.ts`) computes a `ValuationData` from an already-fetched `YahooResearch`. Two consumers share it: `valuationService.ts` → `stocks:valuation` IPC → a `ValuationPanel` renderer (like `ScorecardGrid`), and the control server's `/research` data handler which embeds `valuation` into `ResearchData`. Claude pushes nothing for this panel.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), React + Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-06-03-dcf-valuation-panel-design.md`

---

### Task 1: Shared types

**Files:**
- Modify: `src/shared/types.ts` (add `DcfAssumption`, `ValuationData`; extend `ResearchData`; add `getValuation` to `AssayApi`)

- [ ] **Step 1: Add the `DcfAssumption` and `ValuationData` interfaces**

Insert among the structured-payload interfaces (e.g. right after the `EtfData` interface, before `SecSummaryData`). Add:

```ts
// ── DCF valuation (app-owned, computed in main from Yahoo) ───────────────────

export interface DcfAssumption {
  label: string // "Stage-1 growth (5yr)", "Discount rate (CAPM)", …
  value: string // pre-formatted: "12.0%", "9.8%", "$98.5B"
}

export type ValuationVerdict = 'undervalued' | 'fair' | 'overvalued'

export interface ValuationData {
  symbol: string
  applicable: boolean
  reason?: string // set when applicable === false (e.g. "Not applicable to funds.")
  // Present only when applicable === true:
  fairValue?: number // center case, per share
  fairValueLow?: number // sensitivity band min
  fairValueHigh?: number // sensitivity band max
  price?: number // current, for comparison
  marginOfSafety?: number // fraction; (fairValue − price) / price
  verdict?: ValuationVerdict
  impliedGrowth?: number // reverse-DCF g1, fraction
  impliedGrowthRead?: string // "demanding" | "undemanding" | "in line"
  assumptions?: DcfAssumption[]
  note: string // methodology caveat — always present
  asOf: string // ISO timestamp
}
```

- [ ] **Step 2: Extend `ResearchData` with the valuation field**

Modify the existing interface (currently around line 287):

```ts
export interface ResearchData extends YahooResearch {
  symbol: string
  sec?: SecData | null
  valuation?: ValuationData | null
}
```

- [ ] **Step 3: Add `getValuation` to the `AssayApi` interface**

In `AssayApi`, immediately after the `getScorecards` line:

```ts
  getScorecards(symbol: string): Promise<Scorecards | null>
  getValuation(symbol: string): Promise<ValuationData | null>
```

- [ ] **Step 4: Verify it type-checks**

Run: `npm run lint`
Expected: PASS (no errors). Unused-type warnings are fine at this stage.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): ValuationData + DcfAssumption + getValuation api"
```

---

### Task 2: Pure DCF engine + tests (TDD)

**Files:**
- Create: `src/main/services/dcf.ts`
- Test: `src/main/services/dcf.test.ts`

The engine is pure — no network, no Electron imports — so it unit-tests in plain Node like `scoring.ts`. Exposes helpers (`costOfEquity`, `blendGrowth`, `fairValuePerShare`, `impliedGrowth`) plus the orchestrator `computeValuation`.

- [ ] **Step 1: Write the failing test file**

Create `src/main/services/dcf.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  costOfEquity,
  blendGrowth,
  fairValuePerShare,
  impliedGrowth,
  computeValuation
} from './dcf'
import type { YahooResearch } from '../../shared/types'

const ASOF = '2026-06-03T00:00:00.000Z'

describe('costOfEquity (CAPM, clamped 0.07–0.14)', () => {
  it('uses rf + beta*ERP for a normal beta', () => {
    // 0.043 + 1.0 * 0.05 = 0.093
    expect(costOfEquity(1.0)).toBeCloseTo(0.093, 3)
  })
  it('floors at 0.07 for a tiny beta', () => {
    expect(costOfEquity(0.2)).toBeCloseTo(0.07, 3)
  })
  it('caps at 0.14 for a huge beta', () => {
    expect(costOfEquity(5)).toBeCloseTo(0.14, 3)
  })
  it('defaults beta to 1.1 when missing', () => {
    // 0.043 + 1.1 * 0.05 = 0.098
    expect(costOfEquity(undefined)).toBeCloseTo(0.098, 3)
  })
})

describe('blendGrowth (clamped 0.04–0.20)', () => {
  it('averages earnings and revenue growth', () => {
    expect(blendGrowth(0.1, 0.2)).toBeCloseTo(0.15, 5)
  })
  it('uses the single present value', () => {
    expect(blendGrowth(0.12, undefined)).toBeCloseTo(0.12, 5)
  })
  it('falls back to 0.08 when both absent', () => {
    expect(blendGrowth(undefined, undefined)).toBeCloseTo(0.08, 5)
  })
  it('clamps an absurd growth down to 0.20', () => {
    expect(blendGrowth(0.6, 0.6)).toBeCloseTo(0.2, 5)
  })
  it('clamps a tiny growth up to 0.04', () => {
    expect(blendGrowth(0.0, 0.0)).toBeCloseTo(0.04, 5)
  })
})

describe('fairValuePerShare (2-stage, gTerm=0.025)', () => {
  it('matches a hand-computed value when g1 == r', () => {
    // fcf0=100, shares=100, g1=r=0.10:
    //   each explicit year PV = 100 → 5yr sum = 500
    //   FCF5 = 100*1.1^5 = 161.051; terminal = 161.051*1.025/0.075 = 2201.03
    //   PV(terminal) = 2201.03 / 1.1^5 = 1366.66
    //   total = 1866.66; / 100 shares = 18.6666
    expect(fairValuePerShare(100, 100, 0.1, 0.1)).toBeCloseTo(18.67, 1)
  })
})

describe('impliedGrowth (reverse DCF round-trip)', () => {
  it('recovers g1 when fed the engine’s own fair value as price', () => {
    const fair = fairValuePerShare(100, 100, 0.12, 0.1)
    expect(impliedGrowth(100, 100, 0.1, fair)).toBeCloseTo(0.12, 2)
  })
})

describe('computeValuation — applicable path', () => {
  const research: YahooResearch = {
    quoteType: 'EQUITY',
    price: 100,
    marketCap: 10_000, // shares = 100
    freeCashflow: 100,
    beta: 1.0,
    earningsGrowth: 0.1,
    revenueGrowth: 0.1
  }
  it('returns an applicable valuation with an ordered sensitivity band', () => {
    const v = computeValuation(research, 'TEST', ASOF)
    expect(v.applicable).toBe(true)
    expect(v.symbol).toBe('TEST')
    expect(v.fairValue).toBeGreaterThan(0)
    expect(v.fairValueLow!).toBeLessThan(v.fairValue!)
    expect(v.fairValueHigh!).toBeGreaterThan(v.fairValue!)
    expect(v.verdict).toBeDefined()
    expect(v.assumptions!.length).toBeGreaterThanOrEqual(4)
    expect(v.asOf).toBe(ASOF)
  })
})

describe('computeValuation — N/A paths', () => {
  it('gates out ETFs', () => {
    const v = computeValuation({ quoteType: 'ETF', price: 500, marketCap: 1e9 }, 'SPY', ASOF)
    expect(v.applicable).toBe(false)
    expect(v.reason).toMatch(/fund/i)
  })
  it('gates out negative free cash flow', () => {
    const v = computeValuation(
      { quoteType: 'EQUITY', price: 10, marketCap: 1000, freeCashflow: -50 },
      'XYZ',
      ASOF
    )
    expect(v.applicable).toBe(false)
    expect(v.reason).toMatch(/free cash flow/i)
  })
  it('gates out missing price', () => {
    const v = computeValuation({ quoteType: 'EQUITY', marketCap: 1000, freeCashflow: 100 }, 'XYZ', ASOF)
    expect(v.applicable).toBe(false)
    expect(v.reason).toMatch(/insufficient/i)
  })
  it('returns insufficient-data for null research', () => {
    const v = computeValuation(null, 'XYZ', ASOF)
    expect(v.applicable).toBe(false)
  })
})

describe('computeValuation — financials caveat', () => {
  it('still computes but flags banks/insurers in the note', () => {
    const v = computeValuation(
      {
        quoteType: 'EQUITY',
        sector: 'Financial Services',
        price: 100,
        marketCap: 10_000,
        freeCashflow: 100,
        beta: 1.0
      },
      'BANK',
      ASOF
    )
    expect(v.applicable).toBe(true)
    expect(v.note).toMatch(/bank|insurer|financial/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/services/dcf.test.ts`
Expected: FAIL — `Cannot find module './dcf'` (file doesn't exist yet).

- [ ] **Step 3: Implement the engine**

Create `src/main/services/dcf.ts`:

```ts
// Pure 2-stage equity-DCF engine for the Valuation panel. NO I/O — callers pass an
// already-fetched YahooResearch; this returns a ValuationData. Kept free of
// Electron/network imports so it is unit-testable in plain Node (vitest), exactly
// like scoring.ts.
//
// Methodology (see docs/superpowers/specs/2026-06-03-dcf-valuation-panel-design.md):
//   5 explicit years of FCF growth at a clamped blended rate, then a Gordon
//   perpetuity at 2.5%, discounted at CAPM cost of equity. Treats Yahoo
//   freeCashflow as cash flow to equity (no WACC bridge) off a single TTM base.
//   A transparent model, not a forecast.

import type { YahooResearch, ValuationData, DcfAssumption, ValuationVerdict } from '../../shared/types'

const RF = 0.043 // risk-free (hardcoded; live FRED feed is sub-project E)
const ERP = 0.05 // equity risk premium
const G_TERM = 0.025 // terminal growth
const YEARS = 5 // explicit forecast horizon
const DEFAULT_BETA = 1.1
const DEFAULT_G1 = 0.08
const G1_FLOOR = 0.04
const G1_CAP = 0.2
const R_FLOOR = 0.07
const R_CAP = 0.14

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

function num(x: number | undefined | null): x is number {
  return x != null && Number.isFinite(x)
}

// CAPM cost of equity, clamped to a sane band.
export function costOfEquity(beta: number | undefined): number {
  const b = num(beta) ? beta : DEFAULT_BETA
  return clamp(RF + b * ERP, R_FLOOR, R_CAP)
}

// Stage-1 growth: average of earnings & revenue growth (whichever present),
// fallback 0.08, clamped to [0.04, 0.20].
export function blendGrowth(
  earningsGrowth: number | undefined,
  revenueGrowth: number | undefined
): number {
  const vals = [earningsGrowth, revenueGrowth].filter(num) as number[]
  const raw = vals.length === 2 ? (vals[0] + vals[1]) / 2 : vals.length === 1 ? vals[0] : DEFAULT_G1
  return clamp(raw, G1_FLOOR, G1_CAP)
}

// 2-stage equity DCF: PV of 5yr explicit FCF + PV of Gordon terminal, per share.
export function fairValuePerShare(fcf0: number, shares: number, g1: number, r: number): number {
  let pv = 0
  let fcf = fcf0
  for (let t = 1; t <= YEARS; t++) {
    fcf = fcf0 * Math.pow(1 + g1, t)
    pv += fcf / Math.pow(1 + r, t)
  }
  const terminal = (fcf * (1 + G_TERM)) / (r - G_TERM)
  pv += terminal / Math.pow(1 + r, YEARS)
  return pv / shares
}

// Reverse DCF: the stage-1 growth that makes fair value == price. Fair value is
// monotonically increasing in g1, so a binary search converges.
export function impliedGrowth(fcf0: number, shares: number, r: number, price: number): number {
  let lo = -0.5
  let hi = 1.0
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (fairValuePerShare(fcf0, shares, mid, r) < price) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}

function compactUsd(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e12) return `$${(n / 1e12).toFixed(1)}T`
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toFixed(0)}`
}

function compactNum(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return n.toFixed(0)
}

const BASE_NOTE =
  '2-stage DCF: 5yr at a blended growth rate, then a 2.5% perpetuity, discounted at CAPM cost of equity. ' +
  'Treats free cash flow as equity cash flow (no WACC bridge) off a single TTM base. A transparent model, not a forecast.'

function naResult(symbol: string, asOf: string, reason: string): ValuationData {
  return { symbol, applicable: false, reason, note: BASE_NOTE, asOf }
}

// Orchestrator. Pure — caller supplies symbol + asOf (so tests are deterministic).
export function computeValuation(
  research: YahooResearch | null,
  symbol: string,
  asOf: string
): ValuationData {
  const sym = symbol.toUpperCase()
  if (!research) return naResult(sym, asOf, 'Insufficient data.')
  if ((research.quoteType ?? '').toUpperCase() === 'ETF') {
    return naResult(sym, asOf, 'Not applicable to funds.')
  }
  const { price, marketCap, freeCashflow } = research
  if (!num(price) || !num(marketCap) || price <= 0) {
    return naResult(sym, asOf, 'Insufficient data — no price or market cap.')
  }
  if (!num(freeCashflow) || freeCashflow <= 0) {
    const fig = num(freeCashflow) ? ` (${compactUsd(freeCashflow)})` : ''
    return naResult(sym, asOf, `DCF not applicable — negative/insufficient free cash flow${fig}.`)
  }

  const shares = marketCap / price
  const r = costOfEquity(research.beta)
  const g1 = blendGrowth(research.earningsGrowth, research.revenueGrowth)

  const fairValue = fairValuePerShare(freeCashflow, shares, g1, r)
  // Sensitivity corners: fair value rises with g1, falls with r → extremes are the
  // diagonal corners of the r±0.01 × g1±0.03 grid.
  const fairValueLow = fairValuePerShare(freeCashflow, shares, g1 - 0.03, r + 0.01)
  const fairValueHigh = fairValuePerShare(freeCashflow, shares, g1 + 0.03, r - 0.01)

  const marginOfSafety = (fairValue - price) / price
  const verdict: ValuationVerdict =
    marginOfSafety >= 0.2 ? 'undervalued' : marginOfSafety < -0.15 ? 'overvalued' : 'fair'

  const implied = impliedGrowth(freeCashflow, shares, r, price)
  const impliedGrowthRead =
    implied > g1 + 0.02 ? 'demanding' : implied < g1 - 0.02 ? 'undemanding' : 'in line'

  const isFinancial = (research.sector ?? '').toLowerCase().includes('financial')
  const note = isFinancial
    ? `${BASE_NOTE} FCF-based DCF is unreliable for banks/insurers — read with caution.`
    : BASE_NOTE

  const assumptions: DcfAssumption[] = [
    { label: 'FCF base (TTM)', value: compactUsd(freeCashflow) },
    { label: 'Stage-1 growth (5yr)', value: pct(g1) },
    { label: 'Terminal growth', value: pct(G_TERM) },
    { label: 'Discount rate (CAPM)', value: pct(r) },
    { label: 'Shares', value: compactNum(shares) }
  ]

  return {
    symbol: sym,
    applicable: true,
    fairValue,
    fairValueLow,
    fairValueHigh,
    price,
    marginOfSafety,
    verdict,
    impliedGrowth: implied,
    impliedGrowthRead,
    assumptions,
    note,
    asOf
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/services/dcf.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/dcf.ts src/main/services/dcf.test.ts
git commit -m "feat(valuation): pure 2-stage DCF engine + reverse check (vitest)"
```

---

### Task 3: I/O layer — service, IPC handler, preload bridge

**Files:**
- Create: `src/main/services/valuationService.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

No unit test here (this layer is thin I/O, like `scorecardService.ts` which has none); correctness is covered by the engine tests + the live smoke test in Task 6.

- [ ] **Step 1: Create the valuation service**

Create `src/main/services/valuationService.ts`:

```ts
// Orchestrates the Valuation panel: fetch Yahoo research, hand it to the pure DCF
// engine, return the ValuationData. All I/O lives here; the math lives in dcf.ts.
// Returns null only for an empty symbol — otherwise always returns a ValuationData
// (applicable:false carries the reason), so the renderer can show "why not".

import { getResearchData } from './yahooService'
import { computeValuation } from './dcf'
import type { ValuationData } from '../../shared/types'

export async function getValuation(symbol: string): Promise<ValuationData | null> {
  const sym = symbol.trim().toUpperCase()
  if (!sym) return null
  const research = await getResearchData(sym)
  const valuation = computeValuation(research, sym, new Date().toISOString())
  console.log(
    '[valuation] for',
    sym,
    '->',
    valuation.applicable
      ? `$${valuation.fairValue?.toFixed(2)}/sh (${valuation.verdict})`
      : valuation.reason
  )
  return valuation
}
```

- [ ] **Step 2: Register the IPC handler**

In `src/main/ipc/handlers.ts`, add the import and the handler line:

```ts
import { getScorecards } from '../services/scorecardService'
import { getValuation } from '../services/valuationService'
```

```ts
  ipcMain.handle('stocks:scorecards', (_e, symbol: string) => getScorecards(symbol))
  ipcMain.handle('stocks:valuation', (_e, symbol: string) => getValuation(symbol))
```

- [ ] **Step 3: Add the preload bridge method**

In `src/preload/index.ts`, add `ValuationData` to the type import and the method after `getScorecards`:

```ts
import type {
  AssayApi,
  StockQuote,
  DailyBar,
  IntradayBar,
  Fundamentals,
  Scorecards,
  ValuationData,
  HistoryEntry,
  PushPanel,
  ResearchInit
} from '../shared/types'
```

```ts
  getScorecards: (symbol: string): Promise<Scorecards | null> =>
    ipcRenderer.invoke('stocks:scorecards', symbol),
  getValuation: (symbol: string): Promise<ValuationData | null> =>
    ipcRenderer.invoke('stocks:valuation', symbol),
```

- [ ] **Step 4: Verify it type-checks**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/valuationService.ts src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "feat(valuation): valuationService + stocks:valuation IPC + preload bridge"
```

---

### Task 4: Renderer — ValuationPanel component + dashboard wiring

**Files:**
- Create: `src/renderer/components/ValuationPanel.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create the ValuationPanel component**

Create `src/renderer/components/ValuationPanel.tsx`:

```tsx
import type { ValuationData } from '../../shared/types'

const VERDICT_STYLES: Record<string, { label: string; cls: string }> = {
  undervalued: { label: 'UNDERVALUED', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
  fair: { label: 'ROUGHLY FAIR', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  overvalued: { label: 'OVERVALUED', cls: 'bg-red-500/15 text-red-300 ring-red-500/30' }
}

function money(n: number): string {
  return `$${n.toFixed(2)}`
}

function signedPct(x: number): string {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`
}

export function ValuationPanel({ data }: { data: ValuationData }): JSX.Element {
  if (!data.applicable) {
    return <p className="py-6 text-center text-sm text-zinc-500">{data.reason ?? 'Not available'}</p>
  }

  const style = VERDICT_STYLES[data.verdict ?? 'fair'] ?? VERDICT_STYLES.fair
  const mos = data.marginOfSafety ?? 0

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className={`rounded-md px-2.5 py-1 text-sm font-bold tracking-wide ring-1 ${style.cls}`}>
          {style.label}
        </span>
        <span className="text-sm text-zinc-300">{signedPct(mos)} margin of safety vs price</span>
      </div>

      <div className="mt-4 flex items-baseline gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Fair value / share</div>
          <div className="text-lg font-semibold tabular-nums text-zinc-100">
            {data.fairValueLow != null && data.fairValueHigh != null
              ? `${money(data.fairValueLow)} – ${money(data.fairValueHigh)}`
              : money(data.fairValue ?? 0)}
          </div>
          {data.fairValue != null && (
            <div className="text-xs tabular-nums text-zinc-500">center {money(data.fairValue)}</div>
          )}
        </div>
        {data.price != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Current price</div>
            <div className="text-lg tabular-nums text-zinc-300">{money(data.price)}</div>
          </div>
        )}
      </div>

      {data.impliedGrowth != null && (
        <p className="mt-4 text-[13px] leading-relaxed text-zinc-400">
          <span className="font-medium text-zinc-300">Reverse DCF:</span> to justify today’s price, FCF
          must grow ~{(data.impliedGrowth * 100).toFixed(0)}%/yr for 5 yr
          {data.impliedGrowthRead ? ` — ${data.impliedGrowthRead}` : ''}.
        </p>
      )}

      {data.assumptions && data.assumptions.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Assumptions</div>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-3">
            {data.assumptions.map((a) => (
              <div key={a.label} className="flex justify-between gap-2">
                <dt className="text-zinc-500">{a.label}</dt>
                <dd className="tabular-nums text-zinc-300">{a.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-zinc-600">{data.note}</p>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the dashboard — imports + type**

In `src/renderer/App.tsx`, add `ValuationData` to the type import block and import the component beside `ScorecardGrid`:

```ts
  Scorecards,
  ValuationData
} from '../shared/types'
import { ChartPanel } from './components/ChartPanel'
import { ScorecardGrid } from './components/ScorecardPanel'
import { ValuationPanel } from './components/ValuationPanel'
```

- [ ] **Step 3: Add state + fetch in the Dashboard**

Add the state declaration next to `scorecards`:

```ts
  const [scorecards, setScorecards] = useState<Scorecards | null | undefined>(undefined)
  const [valuation, setValuation] = useState<ValuationData | null | undefined>(undefined)
```

In the same `useEffect` that fetches scorecards (keyed on `[ticker]`), append:

```ts
    setValuation(undefined)
    void window.api
      .getValuation(ticker)
      .then(setValuation)
      .catch(() => setValuation(null))
```

- [ ] **Step 4: Render the panel in the grid**

Immediately after the closing `</Panel>` of the Scorecards panel (before `<RecommendationCard …>`), add:

```tsx
        <Panel title="Valuation (DCF)">
          {valuation === undefined ? (
            <Loading />
          ) : valuation === null ? (
            <Empty msg="No valuation data" />
          ) : (
            <ValuationPanel data={valuation} />
          )}
        </Panel>
```

- [ ] **Step 5: Verify build**

Run: `npm run lint`
Expected: PASS.
Run: `npm run build`
Expected: build completes into `out/` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/ValuationPanel.tsx src/renderer/App.tsx
git commit -m "feat(valuation): ValuationPanel renderer + dashboard wiring"
```

---

### Task 5: Feed the valuation into the recommendation flow

**Files:**
- Modify: `src/main/index.ts` (the control server `onData` handler)
- Modify: `.claude/skills/research/SKILL.md`

- [ ] **Step 1: Embed `valuation` in the data bundle**

In `src/main/index.ts`, add the import near the other service imports:

```ts
import { getResearchData } from './services/yahooService'
import { getSecData } from './services/secService'
import { computeValuation } from './services/dcf'
```

Update the `onData` handler to compute and include the valuation:

```ts
      onData: async (ticker) => {
        const [yahoo, sec] = await Promise.all([getResearchData(ticker), getSecData(ticker)])
        const valuation = computeValuation(yahoo ?? null, ticker, new Date().toISOString())
        return { symbol: ticker, ...(yahoo ?? {}), sec, valuation }
      }
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Update the `/research` skill to reference the DCF**

In `.claude/skills/research/SKILL.md`, in the **"Recommendation (you, the main agent on Opus, write & push this)"** section, add a bullet after the "Call + thesis" bullet (around line 114):

```markdown
- **Reference the DCF when present:** the `data` bundle now carries `valuation` (an app-computed 2-stage DCF). When `valuation.applicable` is true, weave its read into your thesis — e.g. "trades ~20% below a ~$X DCF fair value (margin of safety +20%)" or "priced for demanding ~18%/yr FCF growth (reverse DCF)". Treat it as **one input among many, not a mechanical buy/sell trigger**, and respect its caveats (FCFE approximation, single TTM FCF base; unreliable for financials). When `valuation.applicable` is false, ignore it. The Valuation panel renders itself — you do **not** push it.
```

Also update the data-bundle field list in the **Sub-agent prompt** (step 2, around line 34–38) so the sub-agent passes the field through — append a bundle-field bullet:

```markdown
> - **`valuation`:** app-computed 2-stage DCF — `applicable`, and when true `fairValue`, `fairValueLow/High`, `marginOfSafety`, `verdict`, `impliedGrowth`. Pass it through verbatim; the caller uses it for the recommendation.
```

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts .claude/skills/research/SKILL.md
git commit -m "feat(valuation): feed DCF into /research data bundle + recommendation skill"
```

---

### Task 6: Docs, roadmap, and final verification

**Files:**
- Modify: `CLAUDE.md` (roadmap checkbox + status)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — both `scoring.test.ts` and `dcf.test.ts` green.

- [ ] **Step 2: Lint + build clean**

Run: `npm run lint`
Expected: PASS.
Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Live smoke test**

Run `npm run dev` (NEVER with `NODE_OPTIONS=--use-system-ca` — see CLAUDE.md gotchas). Then from another shell:

```bash
node scripts/assay.mjs ensure
node scripts/assay.mjs research AAPL
```

Confirm in the AAPL window: the **Valuation (DCF)** panel renders a fair-value range, a margin-of-safety badge, the reverse-DCF line, and the assumptions table. Then run:

```bash
node scripts/assay.mjs data AAPL
```

Confirm the JSON includes a `valuation` object with `applicable: true` and a `fairValue`. Spot-check an ETF (e.g. `research SPY` → panel shows "Not applicable to funds.") and, if convenient, an unprofitable name (panel shows the FCF reason).

- [ ] **Step 4: Update the roadmap**

In `CLAUDE.md`, under **v2 — fill out the panels**, add a checked line near the recommendation/scorecards entries:

```markdown
- [x] DCF valuation panel — app-owned, app-computed 2-stage equity DCF + reverse check (pure `dcf.ts` engine, vitest-tested → `valuationService.ts` → `stocks:valuation` IPC → `ValuationPanel`); also feeds `valuation` into the `/research` data bundle so the recommendation references it. See [spec](docs/superpowers/specs/2026-06-03-dcf-valuation-panel-design.md)
```

Also add a row to the **Panel ownership** table near the scorecards row: `| Valuation (DCF) | App | computed from Yahoo FCF + beta |`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: check off DCF valuation panel (sub-project B)"
```

---

## Self-Review

**Spec coverage:**
- Architecture (pure engine + 2 consumers) → Tasks 2, 3, 5 ✓
- 2-stage methodology, clamps, CAPM, terminal → Task 2 (`dcf.ts`) ✓
- Sensitivity range → Task 2 (`fairValueLow/High` corners) ✓
- Reverse DCF → Task 2 (`impliedGrowth`) ✓
- Verdict bands → Task 2 ✓
- Applicability gating (ETF / neg-FCF / missing price / financials) → Task 2 + tests ✓
- `ValuationData` / `DcfAssumption` / `AssayApi` / `ResearchData` types → Task 1 ✓
- Renderer panel (range, badge, reverse line, assumptions, note, N/A) → Task 4 ✓
- Feeds recommendation (data bundle + skill) → Task 5 ✓
- Testing (known-input, round-trip, clamps, band, N/A) → Task 2 ✓
- Caveats in `note` → Task 2 (`BASE_NOTE` + financial append) ✓

**Type consistency:** `computeValuation(research, symbol, asOf)` signature is identical in the engine (Task 2), service (Task 3), and `index.ts` (Task 5). `getValuation` matches across `AssayApi` (Task 1), handler (Task 3), and preload (Task 3). `ValuationData` field names used in the renderer (Task 4) match the Task 1 definition (`fairValueLow/High`, `marginOfSafety`, `impliedGrowthRead`, `verdict`, `assumptions`, `note`).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result.
