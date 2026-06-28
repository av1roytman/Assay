# Analyst Consensus Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the recommendation panel's "street" half genuinely app-owned by enriching the recommendation push with the app's real Yahoo `AnalystConsensus`, keeping Claude's per-firm `notable` calls.

**Architecture:** A pure `mergeStreet` helper overlays the app's cached Yahoo consensus over whatever Claude pushed; the `onPanel` handler in the main process calls it before persist/forward, exactly like the existing `peers` enrichment seam. No new IPC, no type changes, no renderer changes.

**Tech Stack:** TypeScript (strict), Electron main process, vitest.

## Global Constraints

- Pure logic lives in a file with **no Electron/Yahoo/network imports** so vitest runs it in plain Node (pattern: `scoring.ts`, `dcf.ts`). The DB-ABI / `better-sqlite3-node` alias concern does **not** apply — this test touches no DB.
- `street` shape (`RecommendationData['street']`) is unchanged: `{ rating?, score?, analysts?, targets?, notable? }`; `targets` is `PriceTargets { current?, low?, mean?, median?, high? }`.
- `AnalystConsensus` (already in `src/shared/types.ts`): `{ rating?, score?, count?, targetLow?, targetMean?, targetMedian?, targetHigh? }`. `rating` is Yahoo's `recommendationKey` (e.g. `"strong_buy"`, sometimes `"none"`).
- App numbers win when present; Claude's value is the fallback; `notable` is always Claude's. If `analyst` is absent, return the pushed `street` unchanged.
- `npm run lint` = `tsc --noEmit`; tests run via `npm test` (vitest). Never set `NODE_OPTIONS=--use-system-ca` for lint/build/test.

---

### Task 1: Pure consensus merge module

**Files:**
- Create: `src/main/services/consensus.ts`
- Test: `src/main/services/consensus.test.ts`

**Interfaces:**
- Consumes: `RecommendationData`, `AnalystConsensus` from `../../shared/types`.
- Produces:
  - `mapRecommendationKey(key?: string): string | undefined`
  - `mergeStreet(claudeStreet: RecommendationData['street'], analyst?: AnalystConsensus, currentPrice?: number): RecommendationData['street']`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/services/consensus.test.ts
import { describe, it, expect } from 'vitest'
import { mapRecommendationKey, mergeStreet } from './consensus'
import type { AnalystConsensus, RecommendationData } from '../../shared/types'

type Street = RecommendationData['street']

const analyst: AnalystConsensus = {
  rating: 'strong_buy',
  score: 1.7,
  count: 42,
  targetLow: 180,
  targetMean: 240,
  targetMedian: 235,
  targetHigh: 300
}

const claude: Street = {
  rating: 'Buy (Claude)',
  score: 2.5,
  analysts: 3,
  targets: { current: 199, low: 150, mean: 210, median: 205, high: 250 },
  notable: [{ firm: 'Morgan Stanley', target: 260, note: 'reiterated' }]
}

describe('mapRecommendationKey', () => {
  it('maps each Yahoo key to its display label', () => {
    expect(mapRecommendationKey('strong_buy')).toBe('Strong Buy')
    expect(mapRecommendationKey('buy')).toBe('Buy')
    expect(mapRecommendationKey('hold')).toBe('Hold')
    expect(mapRecommendationKey('underperform')).toBe('Underperform')
    expect(mapRecommendationKey('sell')).toBe('Sell')
  })

  it('returns undefined for unknown or missing keys', () => {
    expect(mapRecommendationKey('none')).toBeUndefined()
    expect(mapRecommendationKey(undefined)).toBeUndefined()
    expect(mapRecommendationKey('')).toBeUndefined()
  })
})

describe('mergeStreet', () => {
  it('overrides Claude street numbers with the app analyst numbers', () => {
    const out = mergeStreet(claude, analyst, 222)
    expect(out.rating).toBe('Strong Buy')
    expect(out.score).toBe(1.7)
    expect(out.analysts).toBe(42)
    expect(out.targets?.low).toBe(180)
    expect(out.targets?.mean).toBe(240)
    expect(out.targets?.median).toBe(235)
    expect(out.targets?.high).toBe(300)
  })

  it('sets targets.current from the passed currentPrice, not Claude', () => {
    expect(mergeStreet(claude, analyst, 222).targets?.current).toBe(222)
  })

  it("preserves Claude's notable calls verbatim", () => {
    expect(mergeStreet(claude, analyst, 222).notable).toEqual(claude.notable)
  })

  it('returns the pushed street unchanged when analyst is absent', () => {
    expect(mergeStreet(claude, undefined, 222)).toEqual(claude)
  })

  it('falls back field-by-field when analyst is partial', () => {
    const partial: AnalystConsensus = { rating: 'buy', targetMean: 240 }
    const out = mergeStreet(claude, partial, undefined)
    expect(out.rating).toBe('Buy') // mapped from analyst
    expect(out.score).toBe(2.5) // fallback to Claude
    expect(out.analysts).toBe(3) // fallback to Claude
    expect(out.targets?.mean).toBe(240) // from analyst
    expect(out.targets?.high).toBe(250) // fallback to Claude
    expect(out.targets?.current).toBe(199) // fallback to Claude (no currentPrice)
  })

  it('keeps an unknown analyst rating as the Claude rating', () => {
    expect(mergeStreet(claude, { ...analyst, rating: 'none' }, 222).rating).toBe('Buy (Claude)')
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- consensus`
Expected: FAIL — cannot find module `./consensus` / `mapRecommendationKey is not a function`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/main/services/consensus.ts
// Pure helpers that make the recommendation panel's "street" half app-owned.
// The app holds the real Yahoo AnalystConsensus; these overlay it over whatever
// Claude pushed, keeping Claude's per-firm `notable` calls. No I/O, no Electron
// imports — unit-testable in plain Node (vitest), like scoring.ts / dcf.ts.

import type { RecommendationData, AnalystConsensus } from '../../shared/types'

type Street = RecommendationData['street']

const RATING_LABELS: Record<string, string> = {
  strong_buy: 'Strong Buy',
  buy: 'Buy',
  hold: 'Hold',
  underperform: 'Underperform',
  sell: 'Sell'
}

// Yahoo recommendationKey ("strong_buy") → display label ("Strong Buy").
// Unknown / missing keys return undefined so the caller can fall back.
export function mapRecommendationKey(key?: string): string | undefined {
  if (!key) return undefined
  return RATING_LABELS[key.toLowerCase()]
}

// Overlay the app's real Yahoo consensus over Claude's pushed `street`.
// App numbers win when present; Claude's value is the fallback; `notable` is
// always Claude's (Yahoo's bundle has no per-firm calls). When `analyst` is
// absent (ETFs, fetch miss) the pushed street is returned unchanged.
export function mergeStreet(
  claudeStreet: Street,
  analyst?: AnalystConsensus,
  currentPrice?: number
): Street {
  const base: Street = claudeStreet ?? {}
  if (!analyst) return base
  const t = base.targets ?? {}
  return {
    ...base,
    rating: mapRecommendationKey(analyst.rating) ?? base.rating,
    score: analyst.score ?? base.score,
    analysts: analyst.count ?? base.analysts,
    targets: {
      current: currentPrice ?? t.current,
      low: analyst.targetLow ?? t.low,
      mean: analyst.targetMean ?? t.mean,
      median: analyst.targetMedian ?? t.median,
      high: analyst.targetHigh ?? t.high
    },
    notable: base.notable
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- consensus`
Expected: PASS — all cases in both describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/consensus.ts src/main/services/consensus.test.ts
git commit -m "feat(consensus): pure mergeStreet to app-own analyst consensus"
```

---

### Task 2: Wire enrichment into onPanel + update docs

**Files:**
- Modify: `src/main/index.ts` (`onPanel`, ~lines 32–50)
- Modify: `.claude/skills/research/SKILL.md` (recommendation section, ~lines 128–141)
- Modify: `CLAUDE.md` (v2 roadmap line)

**Interfaces:**
- Consumes: `mergeStreet` from `./services/consensus`; `getResearchData` (already imported in `index.ts:12`, returns `Promise<YahooResearch | null>` with `.analyst` and `.price`).

- [ ] **Step 1: Add the import to `src/main/index.ts`**

Add beside the other service imports (after line 9, `import { buildPeersData } from './services/peers'`):

```ts
import { mergeStreet } from './services/consensus'
```

- [ ] **Step 2: Enrich the recommendation push in `onPanel`**

In `onPanel`, insert this block **after** the `if (p.type === 'peers') { … }` block and **before** `const savedAt = savePanel(p)`:

```ts
        // Recommendation pushes: fill the street consensus with the app's real
        // Yahoo numbers (Claude keeps `notable`), mirroring the peers enrichment.
        // Runs before savePanel AND before the recordCall block below, so the
        // persisted panel and the track-record price-at-call both use real data.
        if (p.type === 'recommendation') {
          const d = p.data as RecommendationData | undefined
          if (d) {
            const r = await getResearchData(p.ticker)
            p = { ...p, data: { ...d, street: mergeStreet(d.street, r?.analyst, r?.price) } }
          }
        }
```

The existing `recordCall` block (which re-reads `const d = p.data`) is left as-is — it now reads the enriched `street.targets.current` automatically.

- [ ] **Step 3: Verify lint + build**

Run: `npm run lint`
Expected: exit 0, no type errors.

Run: `npm run build`
Expected: exit 0, main/preload/renderer bundles built.

- [ ] **Step 4: Update the skill doc (`.claude/skills/research/SKILL.md`)**

In the **Recommendation** section (~line 128) add a note that the app now fills the consensus numbers, and soften the now-redundant manual-consensus instruction at ~line 135:

- Add, near the top of the recommendation guidance: *"The app fills `street.rating` / `score` / `analysts` / `targets` from Yahoo after you push (mirrors peers), so you only need to send `call` / `headline` / `thesis` / `buyIf` / `avoidIf` and optionally `street.notable` (per-firm color). Don't spend tool calls sourcing consensus numbers."*
- At the thin-coverage bullet (~line 135), replace the instruction to hand-set `rating`/`score` with: *"Consensus numbers are app-filled; just supply `street.notable` if you have notable per-firm calls. Still flag stale consensus in `asOf` when a newer event is known."*

Keep the `recommendation` JSON shape block, but mark `street`'s numeric fields as app-filled/optional in its inline comments.

- [ ] **Step 5: Check off the roadmap item in `CLAUDE.md`**

Change the v2 line:

```
- [ ] Analyst-consensus data (Yahoo) shown beside Claude's thesis
```

to:

```
- [x] Analyst-consensus data (Yahoo) shown beside Claude's thesis — app enriches the recommendation push's `street` with the real Yahoo `AnalystConsensus` (keeps Claude's `notable`); pure `consensus.ts` `mergeStreet` (vitest-tested) wired into `onPanel`, mirroring peers. Also makes track-record price-at-call app-sourced. See [spec](docs/superpowers/specs/2026-06-28-analyst-consensus-enrichment-design.md)
```

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts .claude/skills/research/SKILL.md CLAUDE.md
git commit -m "feat(recommendation): app-enrich street consensus in onPanel"
```

---

## Self-Review

- **Spec coverage:** pure module + tests (Task 1) ✓; `onPanel` wiring with ordering-before-recordCall (Task 2 Steps 1–3) ✓; skill-doc update (Task 2 Step 4) ✓; roadmap check-off (Task 2 Step 5) ✓; graceful `analyst`-absent fallback (Task 1 test + impl) ✓; track-record bonus (Task 2 Step 2 comment + ordering) ✓.
- **Placeholder scan:** none — all code and edits are concrete.
- **Type consistency:** `mergeStreet`/`mapRecommendationKey` signatures identical across spec, Task 1, and Task 2; `r?.analyst` / `r?.price` match `YahooResearch`; `street` matches `RecommendationData['street']`.
