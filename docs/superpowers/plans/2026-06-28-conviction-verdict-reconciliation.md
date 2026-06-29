# Conviction Verdict + Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the recommendation panel from a summary into a stress-testable judgment by adding a Claude-pushed bull/bear case and an app-side deterministic reconciliation that flags where Claude's verdict contradicts the app's own hard numbers (DCF, scorecards, consensus).

**Architecture:** A new pure module `reconcile.ts` (no I/O, vitest-tested like `scoring.ts`/`dcf.ts`/`consensus.ts`) computes a `ConsistencyCheck` from the verdict + existing app data. It's invoked in `index.ts`'s `onPanel` recommendation block — the same enrichment seam that already merges the analyst `street` — so the result is persisted and reloaded with the dossier. No new IPC, no new endpoint, no new data sources. Claude pushes `bull`/`bear` string arrays; the renderer adds a two-column bull/bear section and a consistency badge.

**Tech Stack:** TypeScript, Electron (main process), React + Tailwind (renderer), vitest (pure-module tests). Source of truth: `docs/superpowers/specs/2026-06-28-conviction-verdict-reconciliation-design.md`.

## Global Constraints

- **No new data sources** — use only data the app already gathers (deferred to sub-projects #2/#3).
- **`consistency` is app-filled ONLY** — Claude must never send it. The reconciliation is app-owned and deterministic (the core trust mechanism: not the same brain grading its own homework).
- **`bull` / `bear` are flat `string[]`** (no nested objects, no markdown) — consistent with the repo convention that qualitative panels ship structured data.
- **`reconcile.ts` is pure** — no I/O, no Electron imports; unit-testable in plain Node via vitest. The `better-sqlite3-node` test-alias concern does not apply (touches no DB).
- **Score scale is 1 (strong buy) … 5 (sell)** — shared by `street.score` and `AnalystConsensus.score`.
- **Tailwind only** in the renderer — no CSS-in-JS, no component libraries.
- **Naming nuance:** the spec's "Value card `status === 'red'`" maps to the real type `ScorecardTone = 'good' | 'bad' | 'neutral'`, where **`'bad'` is the red status**. The rule fires on `status === 'bad'`.
- **Threshold values** (street `>= 3.5` bearish / `<= 2` bullish) are initial picks, tunable during implementation.

---

### Task 1: Data model — `RecommendationData` fields + consistency types

**Files:**
- Modify: `src/shared/types.ts` (the `RecommendationData` interface, ~lines 79-93; new types inserted directly after it)

**Interfaces:**
- Consumes: nothing (foundational).
- Produces:
  - `RecommendationData` gains `bull?: string[]`, `bear?: string[]`, `consistency?: ConsistencyCheck`.
  - `ConsistencyConflict { kind: 'dcf' | 'value' | 'street'; severity: 'conflict' | 'divergence'; message: string }`
  - `ConsistencyCheck { verdict: 'aligned' | 'mixed' | 'conflicted'; conflicts: ConsistencyConflict[] }`

- [ ] **Step 1: Add the two new types after `RecommendationData`**

In `src/shared/types.ts`, the current interface ends at line 93 (`}`). Add the three new optional fields inside it and the two new interfaces immediately after. Replace:

```ts
export interface RecommendationData {
  call: AnalystCall
  headline: string // one-line summary of the call
  thesis: string // short paragraph: the reasoning behind your call
  buyIf?: string // what would flip you to buy
  avoidIf?: string // what would flip you to avoid
  street: {
    rating?: string // "Buy", "Moderate Buy", …
    score?: number // 1 (strong buy) … 5 (sell)
    analysts?: number
    targets?: PriceTargets
    notable?: AnalystNote[] // recent / notable individual calls
  }
  asOf?: string
}
```

with:

```ts
export interface RecommendationData {
  call: AnalystCall
  headline: string // one-line summary of the call
  thesis: string // short paragraph: the reasoning behind your call
  buyIf?: string // what would flip you to buy
  avoidIf?: string // what would flip you to avoid
  bull?: string[] // concise bull-case points (Claude-pushed; plain strings)
  bear?: string[] // concise bear-case points (Claude-pushed; plain strings)
  consistency?: ConsistencyCheck // app-filled ONLY — Claude never sends it
  street: {
    rating?: string // "Buy", "Moderate Buy", …
    score?: number // 1 (strong buy) … 5 (sell)
    analysts?: number
    targets?: PriceTargets
    notable?: AnalystNote[] // recent / notable individual calls
  }
  asOf?: string
}

// App-side reconciliation between Claude's `call` and the app's own hard numbers
// (DCF, scorecards, analyst consensus). `divergence` is informational (street
// disagreement may be the user's contrarian edge); `conflict` is a genuine
// internal inconsistency with the app's own math.
export interface ConsistencyConflict {
  kind: 'dcf' | 'value' | 'street'
  severity: 'conflict' | 'divergence'
  message: string // plain string, no markdown
}

export interface ConsistencyCheck {
  verdict: 'aligned' | 'mixed' | 'conflicted'
  conflicts: ConsistencyConflict[] // empty when aligned
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run lint`
Expected: PASS (no errors). `tsc --noEmit` resolves `ConsistencyCheck` referenced from `RecommendationData`.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add bull/bear + consistency to RecommendationData" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Reconciliation engine + tests (`reconcile.ts`)

**Files:**
- Create: `src/main/services/reconcile.ts`
- Test: `src/main/services/reconcile.test.ts`

**Interfaces:**
- Consumes: `AnalystCall`, `Scorecards`, `ValuationData`, `AnalystConsensus`, `ConsistencyCheck`, `ConsistencyConflict` from `src/shared/types.ts` (Task 1).
- Produces: `export function reconcile(call: AnalystCall, scorecards: Scorecards | null, valuation: ValuationData | null, consensus?: AnalystConsensus): ConsistencyCheck` — consumed by Task 3 (`index.ts`).

Deterministic rules (from the spec):

| Rule | Condition | Output |
|---|---|---|
| DCF buy-vs-overvalued | `call==='buy'` & `valuation.applicable` & `verdict==='overvalued'` | **conflict** `Buy thesis vs DCF overvalued (−X% margin of safety)` |
| DCF avoid-vs-undervalued | `call==='avoid'` & `valuation.applicable` & `verdict==='undervalued'` | **conflict** `Avoid thesis vs DCF undervalued (+X% margin of safety)` |
| Value scorecard | `call==='buy'` & Value card `status==='bad'` | **conflict** `Buy thesis vs red Value scorecard` |
| Street bearish-vs-buy | `call==='buy'` & `consensus.score >= 3.5` | **divergence** `Buy thesis vs bearish street consensus (mean N.N)` |
| Street bullish-vs-avoid | `call==='avoid'` & `consensus.score <= 2` | **divergence** `Avoid thesis vs bullish street consensus (mean N.N)` |

Roll-up `verdict`: any `conflict` → `conflicted`; else any `divergence` → `mixed`; else `aligned`. The `(X% margin of safety)` parenthetical is included only when `marginOfSafety` is a number.

- [ ] **Step 1: Write the failing test**

Create `src/main/services/reconcile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reconcile } from './reconcile'
import type { Scorecards, ValuationData, AnalystConsensus, ScorecardTone } from '../../shared/types'

function scorecardsWith(valueStatus: ScorecardTone): Scorecards {
  return {
    symbol: 'TEST',
    kind: 'stock',
    cards: [
      { key: 'value', title: '💰 Value', status: valueStatus, metrics: [] },
      { key: 'growth', title: '📈 Growth', status: 'good', metrics: [] }
    ],
    asOf: '2026-06-28T00:00:00.000Z'
  }
}

function valuationWith(
  verdict: ValuationData['verdict'],
  marginOfSafety?: number,
  applicable = true
): ValuationData {
  return {
    symbol: 'TEST',
    applicable,
    verdict,
    marginOfSafety,
    note: 'test',
    asOf: '2026-06-28T00:00:00.000Z'
  }
}

describe('reconcile — DCF rules', () => {
  it('flags a conflict when a buy fights an overvalued DCF, with the margin', () => {
    const out = reconcile('buy', null, valuationWith('overvalued', -0.18))
    expect(out.verdict).toBe('conflicted')
    expect(out.conflicts).toHaveLength(1)
    expect(out.conflicts[0]).toEqual({
      kind: 'dcf',
      severity: 'conflict',
      message: 'Buy thesis vs DCF overvalued (-18% margin of safety)'
    })
  })

  it('flags a conflict when an avoid fights an undervalued DCF, with the margin', () => {
    const out = reconcile('avoid', null, valuationWith('undervalued', 0.22))
    expect(out.verdict).toBe('conflicted')
    expect(out.conflicts[0]).toEqual({
      kind: 'dcf',
      severity: 'conflict',
      message: 'Avoid thesis vs DCF undervalued (+22% margin of safety)'
    })
  })

  it('omits the margin parenthetical when marginOfSafety is absent', () => {
    const out = reconcile('buy', null, valuationWith('overvalued', undefined))
    expect(out.conflicts[0].message).toBe('Buy thesis vs DCF overvalued')
  })

  it('does not fire when the DCF verdict is fair', () => {
    expect(reconcile('buy', null, valuationWith('fair', 0.01)).verdict).toBe('aligned')
  })

  it('skips DCF rules when the valuation is not applicable (ETF)', () => {
    const out = reconcile('buy', null, valuationWith('overvalued', -0.3, false))
    expect(out.verdict).toBe('aligned')
    expect(out.conflicts).toHaveLength(0)
  })

  it('does not fire DCF rules for a hold call', () => {
    expect(reconcile('hold', null, valuationWith('overvalued', -0.18)).verdict).toBe('aligned')
  })
})

describe('reconcile — Value scorecard rule', () => {
  it('flags a conflict when a buy fights a red Value card', () => {
    const out = reconcile('buy', scorecardsWith('bad'), null)
    expect(out.verdict).toBe('conflicted')
    expect(out.conflicts[0]).toEqual({
      kind: 'value',
      severity: 'conflict',
      message: 'Buy thesis vs red Value scorecard'
    })
  })

  it('does not fire when the Value card is not red', () => {
    expect(reconcile('buy', scorecardsWith('neutral'), null).verdict).toBe('aligned')
  })

  it('skips the value rule when there is no value card', () => {
    const cards: Scorecards = {
      symbol: 'TEST',
      kind: 'etf',
      cards: [{ key: 'etf-profile', title: 'ETF', status: 'bad', metrics: [] }],
      asOf: '2026-06-28T00:00:00.000Z'
    }
    expect(reconcile('buy', cards, null).verdict).toBe('aligned')
  })
})

describe('reconcile — street rules', () => {
  it('flags a divergence (mixed) when a buy meets bearish consensus', () => {
    const consensus: AnalystConsensus = { score: 4.0 }
    const out = reconcile('buy', null, null, consensus)
    expect(out.verdict).toBe('mixed')
    expect(out.conflicts[0]).toEqual({
      kind: 'street',
      severity: 'divergence',
      message: 'Buy thesis vs bearish street consensus (mean 4.0)'
    })
  })

  it('flags a divergence when an avoid meets bullish consensus', () => {
    const out = reconcile('avoid', null, null, { score: 1.5 })
    expect(out.verdict).toBe('mixed')
    expect(out.conflicts[0].message).toBe('Avoid thesis vs bullish street consensus (mean 1.5)')
  })

  it('skips the street rule when consensus score is absent', () => {
    expect(reconcile('buy', null, null, {}).verdict).toBe('aligned')
    expect(reconcile('buy', null, null, undefined).verdict).toBe('aligned')
  })
})

describe('reconcile — roll-up + graceful skips', () => {
  it('prefers conflicted over divergence when both are present', () => {
    const out = reconcile('buy', null, valuationWith('overvalued', -0.18), { score: 4.0 })
    expect(out.verdict).toBe('conflicted')
    expect(out.conflicts).toHaveLength(2)
    expect(out.conflicts.map((c) => c.kind)).toEqual(['dcf', 'street'])
  })

  it('returns aligned with no conflicts when everything agrees', () => {
    const out = reconcile('buy', scorecardsWith('good'), valuationWith('undervalued', 0.2), {
      score: 1.8
    })
    expect(out.verdict).toBe('aligned')
    expect(out.conflicts).toHaveLength(0)
  })

  it('returns aligned when all inputs are missing', () => {
    expect(reconcile('hold', null, null)).toEqual({ verdict: 'aligned', conflicts: [] })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/services/reconcile.test.ts`
Expected: FAIL — `Failed to resolve import "./reconcile"` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/main/services/reconcile.ts`:

```ts
// Pure, deterministic reconciliation between Claude's recommendation `call` and
// the app's own hard numbers (scorecards, DCF, analyst consensus). This is the
// trust mechanism: the app — not the model that wrote the thesis — flags where
// the verdict contradicts the math. No I/O, no Electron imports — unit-testable
// in plain Node (vitest), like scoring.ts / dcf.ts / consensus.ts.

import type {
  AnalystCall,
  Scorecards,
  ValuationData,
  AnalystConsensus,
  ConsistencyCheck,
  ConsistencyConflict
} from '../../shared/types'

// Signed percent from a fraction: 0.22 → "+22%", -0.18 → "-18%", 0 → "0%".
function signedPct(fraction: number): string {
  const p = Math.round(fraction * 100)
  return `${p > 0 ? '+' : ''}${p}%`
}

export function reconcile(
  call: AnalystCall,
  scorecards: Scorecards | null,
  valuation: ValuationData | null,
  consensus?: AnalystConsensus
): ConsistencyCheck {
  const conflicts: ConsistencyConflict[] = []

  // DCF rules — only when the model produced a usable verdict (skips ETFs etc.).
  if (valuation && valuation.applicable && valuation.verdict) {
    const mos =
      typeof valuation.marginOfSafety === 'number'
        ? ` (${signedPct(valuation.marginOfSafety)} margin of safety)`
        : ''
    if (call === 'buy' && valuation.verdict === 'overvalued') {
      conflicts.push({
        kind: 'dcf',
        severity: 'conflict',
        message: `Buy thesis vs DCF overvalued${mos}`
      })
    } else if (call === 'avoid' && valuation.verdict === 'undervalued') {
      conflicts.push({
        kind: 'dcf',
        severity: 'conflict',
        message: `Avoid thesis vs DCF undervalued${mos}`
      })
    }
  }

  // Value scorecard rule — a buy into a red ('bad') Value card.
  const valueCard = scorecards?.cards.find((c) => c.key === 'value')
  if (call === 'buy' && valueCard?.status === 'bad') {
    conflicts.push({
      kind: 'value',
      severity: 'conflict',
      message: 'Buy thesis vs red Value scorecard'
    })
  }

  // Street rules — divergence (informational), not a hard conflict.
  if (typeof consensus?.score === 'number') {
    const mean = consensus.score.toFixed(1)
    if (call === 'buy' && consensus.score >= 3.5) {
      conflicts.push({
        kind: 'street',
        severity: 'divergence',
        message: `Buy thesis vs bearish street consensus (mean ${mean})`
      })
    } else if (call === 'avoid' && consensus.score <= 2) {
      conflicts.push({
        kind: 'street',
        severity: 'divergence',
        message: `Avoid thesis vs bullish street consensus (mean ${mean})`
      })
    }
  }

  const verdict: ConsistencyCheck['verdict'] = conflicts.some((c) => c.severity === 'conflict')
    ? 'conflicted'
    : conflicts.some((c) => c.severity === 'divergence')
      ? 'mixed'
      : 'aligned'

  return { verdict, conflicts }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/services/reconcile.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/reconcile.ts src/main/services/reconcile.test.ts
git commit -m "feat(reconcile): pure verdict-vs-numbers consistency engine" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire reconciliation into `onPanel` (`index.ts`)

**Files:**
- Modify: `src/main/index.ts` (imports near lines 9-15; the `recommendation` block at lines 48-54)

**Interfaces:**
- Consumes: `reconcile(...)` (Task 2); `getScorecards(symbol)` from `./services/scorecardService` (`Promise<Scorecards | null>`); `computeValuation` (already imported line 15); `getResearchData` (already imported line 13); `mergeStreet` (already imported line 10).
- Produces: a persisted `recommendation` panel whose `data.consistency` is the app-computed `ConsistencyCheck`. No new exports.

This runs **before** `savePanel(p)` and the `recordCall` block, so the persisted panel carries the consistency check (it reloads with the dossier like any other field). Same seam as the existing `street` merge.

- [ ] **Step 1: Add the `getScorecards` and `reconcile` imports**

In `src/main/index.ts`, after the existing service imports (current line 15 is `import { computeValuation } from './services/dcf'`), add:

```ts
import { getScorecards } from './services/scorecardService'
import { reconcile } from './services/reconcile'
```

- [ ] **Step 2: Replace the recommendation enrichment block**

Replace the current block (lines 48-54):

```ts
        if (p.type === 'recommendation') {
          const d = p.data as RecommendationData | undefined
          if (d) {
            const r = await getResearchData(p.ticker)
            p = { ...p, data: { ...d, street: mergeStreet(d.street, r?.analyst, r?.price) } }
          }
        }
```

with:

```ts
        if (p.type === 'recommendation') {
          const d = p.data as RecommendationData | undefined
          if (d) {
            // getResearchData + getScorecards run concurrently to avoid added
            // latency; the DCF is pure over the Yahoo bundle. The app computes
            // `consistency` (Claude never sends it) — the trust mechanism.
            const [r, scorecards] = await Promise.all([
              getResearchData(p.ticker),
              getScorecards(p.ticker)
            ])
            const valuation = computeValuation(r ?? null, p.ticker, new Date().toISOString())
            const street = mergeStreet(d.street, r?.analyst, r?.price)
            const consistency = reconcile(d.call, scorecards, valuation, r?.analyst)
            p = { ...p, data: { ...d, street, consistency } }
          }
        }
```

- [ ] **Step 3: Verify lint**

Run: `npm run lint`
Expected: PASS. (`r` is `YahooResearch | null`; `computeValuation(r ?? null, …)` matches the same call already used in `onData`.)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build completes into `out/` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): attach app-computed consistency to recommendation pushes" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Renderer — bull/bear section + consistency badge (`App.tsx`)

**Files:**
- Modify: `src/renderer/App.tsx` (type imports, lines 2-27; the `Recommendation` component, lines 272-341)

**Interfaces:**
- Consumes: `RecommendationData.bull` / `.bear` / `.consistency` and `ConsistencyCheck` from `../shared/types` (Task 1).
- Produces: rendered UI only. Adds a private `Consistency` component and a `CONSISTENCY_STYLES` map in `App.tsx`.

Bull/Bear: two columns (bull left, bear right) of bulleted points, hidden when both absent. Consistency: a badge keyed off `verdict` (`aligned`=green, `mixed`=amber, `conflicted`=red) with `conflicts[]` listed beneath (conflicts red, divergences softer amber), hidden when `consistency` is absent. Reuses `SubHead` and the existing `CALL_STYLES` badge idiom.

- [ ] **Step 1: Import `ConsistencyCheck`**

In the type-import block (`src/renderer/App.tsx`, lines 2-27), add `ConsistencyCheck` to the list — e.g. after `PeerRow` on line 26:

```ts
  PeersData,
  PeerRow,
  ConsistencyCheck
} from '../shared/types'
```

- [ ] **Step 2: Add the bull/bear section and consistency badge to `Recommendation`**

In the `Recommendation` component, the street grid `</div>` closes the `mt-4 grid` on line 336, then line 338 renders `asOf`. Insert the bull/bear section and consistency badge **between** them. Replace:

```tsx
      </div>

      {data.asOf && <div className="mt-4 text-[11px] text-zinc-600">{data.asOf}</div>}
    </div>
  )
}
```

with:

```tsx
      </div>

      {(() => {
        const hasBull = !!data.bull?.length
        const hasBear = !!data.bear?.length
        if (!hasBull && !hasBear) return null
        return (
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {hasBull && (
              <div>
                <SubHead>Bull case</SubHead>
                <ul className="space-y-1 text-[13px] text-zinc-400">
                  {data.bull!.map((p, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="shrink-0 text-emerald-400">▲</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {hasBear && (
              <div>
                <SubHead>Bear case</SubHead>
                <ul className="space-y-1 text-[13px] text-zinc-400">
                  {data.bear!.map((p, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="shrink-0 text-red-400">▼</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })()}

      {data.consistency && <Consistency check={data.consistency} />}

      {data.asOf && <div className="mt-4 text-[11px] text-zinc-600">{data.asOf}</div>}
    </div>
  )
}

const CONSISTENCY_STYLES: Record<ConsistencyCheck['verdict'], { label: string; cls: string }> = {
  aligned: { label: 'Aligned', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
  mixed: { label: 'Mixed', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  conflicted: { label: 'Conflicted', cls: 'bg-red-500/15 text-red-300 ring-red-500/30' }
}

function Consistency({ check }: { check: ConsistencyCheck }): JSX.Element {
  const style = CONSISTENCY_STYLES[check.verdict]
  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <SubHead>Consistency</SubHead>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${style.cls}`}
        >
          {style.label}
        </span>
      </div>
      {check.conflicts.length > 0 && (
        <ul className="mt-1 space-y-1 text-[12px]">
          {check.conflicts.map((c, i) => (
            <li key={i} className={c.severity === 'conflict' ? 'text-red-300' : 'text-amber-300/80'}>
              <span className="text-zinc-500">{c.severity === 'conflict' ? '✕ ' : '≈ '}</span>
              {c.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

> Note: `SubHead` already applies its own `mt-4` top margin, so the badge row aligns with the section's `mt-5` container without doubling up awkwardly. If spacing looks off during manual review, the `mt-5` on the wrapper is the knob to adjust.

- [ ] **Step 3: Verify lint**

Run: `npm run lint`
Expected: PASS. (`data.bull!`/`data.bear!` non-null assertions are guarded by the `hasBull`/`hasBear` checks.)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(renderer): bull/bear section + consistency badge on recommendation" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Skill guidance — push `bull`/`bear`, document `consistency` (`SKILL.md`)

**Files:**
- Modify: `.claude/skills/research/SKILL.md` (the Recommendation section, ~lines 128-154)

**Interfaces:**
- Consumes: nothing (documentation).
- Produces: updated guidance instructing Claude to push `bull`/`bear` short arrays and never send `consistency`.

- [ ] **Step 1: Add a bull/bear + consistency bullet to the recommendation guidance**

In `.claude/skills/research/SKILL.md`, the `## Recommendation` section's bullet list currently ends at line 134 (the `street` is app-filled bullet) before line 135's "Write the JSON…". Insert a new bullet after line 134:

```md
- **Bull vs bear:** push `bull` and `bear` as short arrays of concise, single-clause points (a few each — not paragraphs), drawn from the data you already gathered. No new tool calls. These render side by side as the explicit two-sided case; keep `buyIf` / `avoidIf` as the "what would change my mind" fields.
- **`consistency` is app-filled — never send it.** The app deterministically cross-checks your `call` against its own DCF, scorecards, and consensus and attaches a consistency badge. It is the trust mechanism; do not include a `consistency` field in your push.
```

- [ ] **Step 2: Update the `recommendation` JSON shape to show `bull`/`bear`**

Replace the JSON block (lines 142-154) so the example carries the new fields. Replace:

```json
{
  "call": "buy | hold | avoid",
  "headline": "one-line summary of the call",
  "thesis": "short paragraph — the reasoning behind your call",
  "buyIf": "what would flip you to buy (optional)",
  "avoidIf": "what would flip you to avoid (optional)",
  "street": {
    "notable": [ { "firm": "Wedbush", "target": 400, "note": "AI inflection" } ]
  },
  "asOf": "data source + date (optional)"
}
```

with:

```json
{
  "call": "buy | hold | avoid",
  "headline": "one-line summary of the call",
  "thesis": "short paragraph — the reasoning behind your call",
  "buyIf": "what would flip you to buy (optional)",
  "avoidIf": "what would flip you to avoid (optional)",
  "bull": [ "concise bull point", "another bull point" ],
  "bear": [ "concise bear point", "another bear point" ],
  "street": {
    "notable": [ { "firm": "Wedbush", "target": 400, "note": "AI inflection" } ]
  },
  "asOf": "data source + date (optional)"
}
```

Also update the line directly above the JSON block (line 141) to note the new app-filled field. Replace:

```md
**`recommendation` JSON shape** (the app fills `street.rating` / `score` / `analysts` / `targets`; only `street.notable` is yours):
```

with:

```md
**`recommendation` JSON shape** (the app fills `street.rating` / `score` / `analysts` / `targets` and `consistency`; only `street.notable` is yours):
```

- [ ] **Step 3: Verify the edits read correctly**

Run: `git diff .claude/skills/research/SKILL.md`
Expected: the two bullets added, the JSON block now includes `bull`/`bear`, and the shape caption mentions `consistency`. No other lines changed.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/research/SKILL.md
git commit -m "docs(skill): push bull/bear, document app-filled consistency" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Roadmap note + full verification (`CLAUDE.md`)

**Files:**
- Modify: `CLAUDE.md` (roadmap section)

**Interfaces:**
- Consumes: nothing.
- Produces: a checked-off roadmap line recording the conviction-layer sub-project #1.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites green, including the new `reconcile.test.ts`.

- [ ] **Step 2: Run lint and build together**

Run: `npm run lint` then `npm run build`
Expected: both PASS.

- [ ] **Step 3: Manual live check**

With the app running (`npm run dev`), run `/research <TICKER>` on a name where the call plausibly fights the math (e.g. a richly-valued name you'd expect a buy on, so the DCF-overvalued conflict can surface). Confirm in the recommendation panel:
- The **Bull case / Bear case** columns render the pushed points.
- The **Consistency** badge shows (green/amber/red) with any conflict messages listed beneath.
- Reopening the ticker from Home reloads the saved dossier **with** the consistency badge intact (it persists like any panel field).

- [ ] **Step 4: Add the roadmap note**

In `CLAUDE.md`, under the v3 / depth section of the roadmap (e.g. after the existing "Backlog — close the loop" items, or as a new "Conviction layer (depth/trust)" line per the spec's framing), add:

```md
### Conviction layer (depth/trust) — noted 2026-06-28
- [x] **#1 Conviction verdict + reconciliation** (2026-06-28) — recommendation panel gains a Claude-pushed **bull case vs bear case** plus an **app-side deterministic reconciliation** (`reconcile.ts`, vitest-tested) that flags where Claude's `call` contradicts the app's own DCF / Value scorecard / street consensus, rendered as a consistency badge (`aligned`/`mixed`/`conflicted`) + conflict list. App-owned & deterministic — the trust mechanism. Wired in `onPanel` alongside the `street` merge; persists with the dossier. See [spec](docs/superpowers/specs/2026-06-28-conviction-verdict-reconciliation-design.md). Sub-projects #2 (positioning signals) and #3 (context) deferred.
```

> Adjust the exact heading/placement to match the surrounding roadmap structure as it stands at implementation time; the content above is what to record.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(roadmap): conviction verdict + reconciliation done" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**
- Data model (`bull?`/`bear?`/`consistency?` + `ConsistencyConflict`/`ConsistencyCheck`) → Task 1. ✅
- App-side reconciliation engine (pure, exact rule table, roll-up, graceful skips) → Task 2. ✅
- Wiring in `onPanel` before `savePanel`/`recordCall`, reusing the research fetch, `Promise.all` concurrency → Task 3. ✅
- Claude-side skill guidance (push bull/bear; `consistency` app-filled) → Task 5. ✅
- Renderer (bull/bear two-column; consistency badge + conflict list; hidden when absent) → Task 4. ✅
- Testing (vitest pure suite covering each rule, buy/hold/avoid, roll-up precedence, graceful skips, aligned path; lint; build; manual) → Task 2 (unit) + Task 6 (lint/build/manual). ✅
- File-change summary (7 files: types, reconcile.ts, reconcile.test.ts, index.ts, SKILL.md, App.tsx, CLAUDE.md) → all covered across Tasks 1-6. ✅

**2. Placeholder scan** — no TBD/TODO/"add error handling"/"similar to Task N"; every code step shows the full code. ✅

**3. Type consistency** — `reconcile(call, scorecards, valuation, consensus?)` signature is identical in Task 2's interface block, implementation, test, and Task 3's call site. `ConsistencyCheck.verdict` union (`aligned`/`mixed`/`conflicted`) matches between Task 1 (type), Task 2 (roll-up), and Task 4 (`CONSISTENCY_STYLES` keys). `ConsistencyConflict.severity` (`conflict`/`divergence`) matches between engine output and renderer styling. Value rule uses `status === 'bad'` (the real `ScorecardTone`), consistent with the Global Constraints note. ✅

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-28-conviction-verdict-reconciliation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
