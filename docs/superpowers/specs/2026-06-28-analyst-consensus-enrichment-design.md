# Analyst Consensus Enrichment — Design Spec

**Date:** 2026-06-28
**Status:** Approved (pending spec review)
**Roadmap item:** v2 — "Analyst-consensus data (Yahoo) shown beside Claude's thesis"

> Makes the **analyst-consensus half of the recommendation panel genuinely app-owned**, per the
> locked planning decision ("Analyst consensus (½ of recommendation) | App | Yahoo estimates").
> Small, surgical: no new panel, no new IPC, no type changes, no renderer changes.

## Overview

The recommendation panel already renders two halves — **"My call"** (Claude's `thesis` / `buyIf` /
`avoidIf`) and **"The street"** (`street.rating` / `score` / `analysts` / `targets` / `notable`).
Today *both* halves are filled by whatever Claude POSTs in `RecommendationData`, so the "street"
numbers depend on Claude sourcing them — they can be approximate, stale, or hallucinated.

Meanwhile the **real Yahoo consensus already exists in the app**: `yahooService` fetches the
`financialData` module into a typed `AnalystConsensus` (`rating` = `recommendationKey`,
`score` = `recommendationMean`, `count`, `targetLow/Mean/Median/High`), caches it, and even ships it
to Claude in the `/research-data` bundle — but the app never renders it.

This feature closes that gap by **enriching the recommendation push app-side**: when Claude pushes a
`recommendation`, the main process overwrites the *quantitative* `street` fields with the app's real
Yahoo numbers, **keeping** Claude's qualitative `notable` per-firm calls, before persisting and
forwarding. It mirrors the existing **peers** pattern exactly (Claude picks → app fills).

**Bonus fix:** the track-record feature records price-at-call from `street.targets.current`. Because
enrichment sets `targets.current` from the app's real current price *before* `recordCall` runs, the
"audit the analyst" history stops depending on Claude's pushed price.

## Architecture

Mirrors the peers enrichment seam already in `onPanel` (`src/main/index.ts:32`):

```
Claude → POST /panel/recommendation  (RecommendationData: call, headline, thesis, buyIf, avoidIf,
                                       street.notable [+ street numbers it no longer needs to source])
   └─ controlServer onPanel(panel)            src/main/index.ts
        ├─ if type === 'recommendation':
        │     const r = await getResearchData(ticker)        ← cached Yahoo bundle (already imported)
        │     p.data.street = mergeStreet(d.street, r?.analyst, r?.price)   ← NEW pure fn
        ├─ savePanel(p)                         persists the ENRICHED panel (reopen shows real numbers)
        ├─ if type === 'recommendation':
        │     recordCall(ticker, d.call, d.headline, d.street?.targets?.current)  ← now app's real price
        └─ pushPanel({ ...p, savedAt })         renderer renders existing street fields, now real
```

**Separation of concerns** (same split as `scoring.ts`/`dcf.ts`):

- `src/main/services/consensus.ts` — **pure, side-effect-free.** No network, no Electron/Yahoo
  imports (so vitest runs it in plain Node). Exports:
  - `mapRecommendationKey(key?): string | undefined` — Yahoo key → display label.
  - `mergeStreet(claudeStreet, analyst?, currentPrice?): RecommendationData['street']`.
- The impure call (`getResearchData` → `mergeStreet`) is **~6 lines inline in `index.ts` `onPanel`**,
  beside the existing peers branch. No new service file, no orchestration layer — the call is trivial.

**Ordering / immutability:** enrichment reassigns `p` immutably (`p = { ...p, data: { ...d, street } }`),
exactly like the peers branch — it does **not** mutate Claude's `d`. It must run **before** `savePanel`
*and* before the existing `recordCall` block. That `recordCall` block already re-reads `const d =
p.data`, so once `p` is reassigned it automatically sees the enriched `targets.current` — no change
needed to the track-record call itself.

## The merge logic — `mergeStreet`

App numbers win when present; Claude's value is the fallback; `notable` is always Claude's.

| `street` field | Source | Fallback |
|---|---|---|
| `rating` | `mapRecommendationKey(analyst.rating)` | `claudeStreet.rating` |
| `score` | `analyst.score` (recommendationMean, 1–5) | `claudeStreet.score` |
| `analysts` | `analyst.count` | `claudeStreet.analysts` |
| `targets.current` | `currentPrice` (app quote) | `claudeStreet.targets?.current` |
| `targets.low/mean/median/high` | `analyst.targetLow/Mean/Median/High` | matching `claudeStreet.targets?.*` |
| `notable` | **`claudeStreet.notable`** (preserved) | — |

`mapRecommendationKey`: `strong_buy → "Strong Buy"`, `buy → "Buy"`, `hold → "Hold"`,
`underperform → "Underperform"`, `sell → "Sell"`; anything else → `undefined` (falls back to Claude's).

**Graceful degradation:** if `analyst` is absent entirely (ETFs, or a Yahoo fetch miss), `mergeStreet`
returns `claudeStreet` unchanged — never blanks out a half the user can see.

## Skill doc update

`.claude/skills/research/SKILL.md` — the recommendation payload spec: Claude sends
`call` / `headline` / `thesis` / `buyIf` / `avoidIf` and (optionally) `street.notable`. Document that
**the app fills the consensus numbers** (`rating`, `score`, `analysts`, `targets`), so Claude should
not spend effort sourcing them. Stops number hallucination and saves a gathering step.

## Testing

`src/main/services/consensus.test.ts` (vitest, pure — no DB/Electron, so no ABI concerns):

1. `mapRecommendationKey` maps each Yahoo key to its label; unknown → `undefined`.
2. `analyst` numbers override Claude's `street` numbers when both present.
3. Claude's `notable` is preserved verbatim.
4. `targets.current` is taken from the passed `currentPrice`, not Claude's.
5. `analyst` undefined → returns Claude's `street` unchanged (ETF / fetch-miss fallback).
6. Partial `analyst` (some target fields undefined) → mixes app + Claude field-by-field correctly.

## Roadmap

Check off v2 — "Analyst-consensus data (Yahoo) shown beside Claude's thesis."

## Out of scope (YAGNI)

- No new `PushPanelType`, IPC method, preload bridge, or renderer component — the UI already renders
  every `street` field.
- No standalone consensus fetch independent of the recommendation push.
- No Yahoo `upgradeDowngradeHistory` module for app-sourced per-firm notes — Claude's `notable`
  covers that; revisit only if we later drop Claude from this panel.
- No recommendation-panel visual redesign.
