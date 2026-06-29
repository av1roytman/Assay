# Conviction Verdict + Reconciliation — Design

**Date:** 2026-06-28
**Status:** Approved (brainstorm), pending implementation plan
**Sub-project:** #1 of the "Conviction layer" (depth/trust) initiative

## Context

Assay is a one-shot, single-ticker research canvas. The recommendation panel today carries Claude's `call` / `headline` / `thesis` / `buyIf` / `avoidIf` plus the app-enriched analyst `street` consensus. In use, the dossier reads as a *summary* rather than a *judgment you can stress-test*. Three gaps were identified: reasoning is shallow, the panels don't cross-check each other, and some data is missing.

This sub-project addresses the first two — **deeper reasoning** and **cross-checking** — using only data the app already gathers. New data sources (insider Form 4, options/short interest, segment & macro) are deliberately deferred to sub-projects #2 and #3.

The whole initiative was decomposed into three build-order sub-projects:
1. **Conviction verdict + reconciliation** (this spec) — bull/bear structure + app-side contradiction check over existing data.
2. **Positioning signals** — insider Form 4 + options/short interest panels feeding the verdict.
3. **Context** — segment breakdown (SEC XBRL) + macro backdrop (wire up FRED).

## Goal

Turn the recommendation panel from a summary into a stress-testable judgment by:
1. Adding an explicit **bull case vs bear case** (Claude-pushed), alongside the existing `buyIf`/`avoidIf` ("what would change my mind").
2. Adding an **app-side deterministic reconciliation** that flags where Claude's verdict contradicts the app's own hard numbers (scorecards, DCF, consensus), rendered as a consistency badge + conflict list.

The reconciliation is **app-owned and deterministic** — not the same brain grading its own homework — which is the core trust mechanism.

## Non-goals

- No new data sources (deferred to #2/#3).
- No new panel — this enhances the existing recommendation panel.
- No change to how the recommendation is *triggered* or streamed.
- Bull/bear are flat string arrays, not nested objects (YAGNI).

## Design

### 1. Data model (`src/shared/types.ts`)

`RecommendationData` gains three optional fields:

```ts
export interface RecommendationData {
  call: AnalystCall            // 'buy' | 'hold' | 'avoid' (unchanged)
  headline: string
  thesis: string
  buyIf?: string               // unchanged — "what would change my mind"
  avoidIf?: string             // unchanged
  bull?: string[]              // NEW — concise bull-case points (Claude-pushed)
  bear?: string[]              // NEW — concise bear-case points (Claude-pushed)
  consistency?: ConsistencyCheck  // NEW — app-filled ONLY; Claude never sends it
  street: { /* unchanged */ }
}
```

New types:

```ts
export interface ConsistencyConflict {
  kind: 'dcf' | 'value' | 'street'
  severity: 'conflict' | 'divergence'
  message: string   // plain string, no markdown — e.g. "Buy thesis vs DCF overvalued (−18% margin of safety)"
}

export interface ConsistencyCheck {
  verdict: 'aligned' | 'mixed' | 'conflicted'
  conflicts: ConsistencyConflict[]   // empty when aligned
}
```

`bull` / `bear` are plain strings (no markdown), consistent with the repo convention that qualitative panels ship structured data.

### 2. App-side reconciliation engine (`src/main/services/reconcile.ts`)

A pure module with no I/O or Electron imports — unit-testable in plain Node via vitest, mirroring `scoring.ts` / `dcf.ts` / `consensus.ts`. The `better-sqlite3-node` test-alias concern does not apply (touches no DB).

Signature:

```ts
export function reconcile(
  call: AnalystCall,
  scorecards: Scorecards | null,
  valuation: ValuationData | null,
  consensus?: AnalystConsensus
): ConsistencyCheck
```

Deterministic rules:

| Rule | Condition | Output |
|---|---|---|
| DCF (buy vs overvalued) | `call === 'buy'` and `valuation.verdict === 'overvalued'` | **conflict** — "Buy thesis vs DCF overvalued (−X% margin of safety)" (X from `marginOfSafety`, when present) |
| DCF (avoid vs undervalued) | `call === 'avoid'` and `valuation.verdict === 'undervalued'` | **conflict** — "Avoid thesis vs DCF undervalued (+X% margin of safety)" |
| Value scorecard | `call === 'buy'` and the Value card `status === 'red'` | **conflict** — "Buy thesis vs red Value scorecard" |
| Street (bearish vs buy) | `call === 'buy'` and consensus `score >= 3.5` | **divergence** — "Buy thesis vs bearish street consensus (mean N.N)" |
| Street (bullish vs avoid) | `call === 'avoid'` and consensus `score <= 2` | **divergence** — "Avoid thesis vs bullish street consensus (mean N.N)" |

Notes:
- `divergence` is informational (street disagreement may be the user's contrarian edge); `conflict` is a genuine internal inconsistency with the app's own math.
- Roll-up `verdict`: any `conflict` → `conflicted`; else any `divergence` → `mixed`; else `aligned`.
- Missing inputs degrade gracefully: a `null` scorecards/valuation or absent consensus simply skips that rule (no crash, no false conflict). `valuation.applicable === false` (e.g. ETFs) skips DCF rules.
- The Value card is found by `key === 'value'` within `scorecards.cards`; if absent, the value rule is skipped.
- `score` thresholds use the 1 (strong buy) … 5 (sell) scale shared by `street.score` and `AnalystConsensus.score`.

### 3. Wiring (`src/main/index.ts` — `onPanel`)

In the existing `if (p.type === 'recommendation')` block, immediately after the `mergeStreet` consensus enrichment (line ~52), compute and attach `consistency`:

- `getResearchData(p.ticker)` is already called for the consensus merge — reuse its result for `r?.analyst` (consensus) and as the input the scorecard/valuation computations need.
- `getScorecards(p.ticker)` — existing async service (`src/main/services/scorecardService.ts`), returns `Scorecards | null`.
- `computeValuation(yahoo ?? null, p.ticker, new Date().toISOString())` — already imported in `index.ts` (`./services/dcf`), returns `ValuationData`.
- Call `reconcile(d.call, scorecards, valuation, r?.analyst)` and merge `consistency` into the recommendation `data` alongside the merged `street`.

This runs **before** `savePanel(p)` and the `recordCall` block, so the persisted panel carries the consistency check (it reloads with the dossier like any other field). Same enrichment seam as peers/consensus — no new IPC, no new endpoint.

Ordering note: `getResearchData` is currently awaited once for the consensus merge; the scorecard + valuation computations can run concurrently with it via `Promise.all` to avoid adding latency, but correctness does not depend on it.

### 4. Claude-side (`.claude/skills/research/SKILL.md`)

Update the recommendation guidance:
- Instruct Claude to push `bull` and `bear` as short arrays of concise, single-clause points (a few each), drawn from the data it already gathered — no new tool calls.
- Document that `consistency` is **app-filled** and must never be sent by Claude.
- Keep `buyIf` / `avoidIf` as the "what would change my mind" fields.

### 5. Renderer (`RecommendationCard` in `src/renderer/App.tsx`)

Two additions to the existing card:
- **Bull / Bear** — a two-column section (bull left, bear right) rendering the `bull` / `bear` arrays as bulleted points. Hidden when both are absent (older saved dossiers).
- **Consistency** — a small badge keyed off `consistency.verdict` (`aligned` = green, `mixed` = yellow, `conflicted` = red) with the `conflicts[]` listed beneath (message text; divergences visually softer than conflicts). Hidden when `consistency` is absent.

Tailwind only; reuse existing tone/badge styling from the scorecards/valuation panels where practical.

## Testing

- `src/main/services/reconcile.test.ts` (vitest, pure) covering: each rule firing; buy/hold/avoid; the roll-up precedence (conflict > divergence > aligned); graceful skips on `null` scorecards / `null` or non-applicable valuation / absent consensus; and the no-conflict `aligned` path. Mirrors the structure of `consensus.test.ts` / `dcf.test.ts`.
- Lint (`tsc --noEmit`) and build (`electron-vite build`) green.
- Manual: a live `/research` run on a ticker where the call plausibly fights the math (e.g. a richly-valued name rated buy) to eyeball the badge + bull/bear rendering.

## File-change summary

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `bull?`, `bear?`, `consistency?` to `RecommendationData`; add `ConsistencyConflict` / `ConsistencyCheck` |
| `src/main/services/reconcile.ts` | New pure reconciliation engine |
| `src/main/services/reconcile.test.ts` | New vitest suite |
| `src/main/index.ts` | Attach `consistency` in the `onPanel` recommendation block |
| `.claude/skills/research/SKILL.md` | Push `bull`/`bear`; document `consistency` as app-filled |
| `src/renderer/App.tsx` | Bull/Bear section + Consistency badge in `RecommendationCard` |
| `CLAUDE.md` | Roadmap note under a new "depth/trust" line when done |

## Open questions

None blocking. Threshold values (street `>= 3.5` / `<= 2`) are initial picks and tunable during implementation.
