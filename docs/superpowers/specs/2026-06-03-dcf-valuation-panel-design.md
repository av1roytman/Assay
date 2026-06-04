# DCF Valuation Panel — Design Spec

**Date:** 2026-06-03
**Status:** Approved (pending spec review)
**Roadmap item:** v2 — "DCF recommendation (deepen the recommendation panel w/ intrinsic-value math)"

> Sub-project **B** of the six identified from the 2026-06-03 skills/MCP research
> (others: Scorecards ✅, News+Risks ✅, Peer comparison, FRED macro, Value-chain graph).
> Each gets its own spec → plan → build cycle. This spec covers **only** the DCF valuation panel.

## Overview

An **app-owned, app-computed** dashboard panel that estimates a stock's **intrinsic value per share**
via a 2-stage discounted-cash-flow model, plus a **reverse-DCF** sanity check (the FCF growth the
current price implies). It surfaces a fair-value **range**, a **margin-of-safety** verdict, the
**reverse-DCF implied growth**, and the **assumptions used** — nothing hidden.

This is a numeric panel like Scorecards / Key Stats: the app fetches and computes it; the **DCF
arithmetic never runs in Claude**. Two consumers share one pure engine:

1. The **Valuation panel** (renderer, via IPC) — like `ScorecardGrid`.
2. The **`/research` `data` bundle** — the computed fair value is added to `ResearchData` so Opus's
   recommendation thesis literally references the DCF, making this a true "DCF recommendation."

Framed throughout like the Risks panel: **a transparent model, not a forecast — garbage in, garbage
out.** No control-server push, no new `PushPanelType`, no Claude push for this panel.

## Architecture

Mirrors the Scorecards pattern (*thin I/O service over a pure compute module*):

```
Renderer: ValuationPanel.tsx (fetches on init)
   └─ window.api.getValuation(symbol)             ← new IPC method on AssayApi
        └─ src/main/ipc/handlers.ts               ← new handler 'stocks:valuation'
             └─ src/main/services/valuationService.ts   (NEW — orchestration / I/O)
                  ├─ yahooService.getResearchData(symbol)   ← already fetches FCF, β, mktcap, growth, cash/debt
                  └─ src/main/services/dcf.ts                (NEW — pure, no I/O)
                       → ValuationData | null

Second consumer (feeds the recommendation):
   src/main/index.ts  /research "data" handler
        const valuation = computeValuation(yahoo)   ← same dcf.ts engine
        return { symbol, ...yahoo, sec, valuation } ← ResearchData gains `valuation`
```

**Separation of concerns:**
- `dcf.ts` — **pure, side-effect-free.** Takes an already-fetched `YahooResearch` and returns a
  `ValuationData | null`. No network, no Electron imports → unit-testable in plain Node (vitest),
  exactly like `scoring.ts`.
- `valuationService.ts` — thin orchestration: fetch `YahooResearch`, call `computeValuation`, return.
- The `data`-bundle path in `index.ts` calls the **same** `computeValuation` so the renderer and the
  skill never diverge.

## The methodology — 2-stage equity DCF + reverse check

All inputs derive from data `yahooService` already fetches. Every input is displayed in the panel.

| Input | Default / source |
|---|---|
| **Cash-flow base** | TTM `freeCashflow` (Yahoo) |
| **Shares** | `marketCap ÷ price` |
| **Stage 1 (yrs 1–5)** | growth `g1` = blend of `earningsGrowth` & `revenueGrowth`, **clamped to [0.04, 0.20]**; fallback **0.08** when both absent |
| **Stage 2 (terminal)** | Gordon perpetuity at **`g_term` = 0.025** |
| **Discount rate `r`** | CAPM cost of equity = `rf + β·ERP`, with **rf = 0.043**, **ERP = 0.05**, `β` from Yahoo (**default 1.1**); result **clamped to [0.07, 0.14]** |
| **Fair value / share** | `[ Σ_{t=1..5} FCF_t/(1+r)^t + PV(terminal) ] ÷ shares` |

Where `FCF_t = FCF_0 · (1+g1)^t` (g1 held flat across the 5 explicit years), and
`terminal = FCF_5 · (1+g_term) / (r − g_term)`, discounted back 5 years: `PV(terminal) = terminal/(1+r)^5`.

**g1 blend rule:** prefer a 50/50 average of `earningsGrowth` and `revenueGrowth` when both present;
use whichever is present if only one; fall back to 0.08. Then clamp to [0.04, 0.20]. (The clamp is
what prevents a 60%-growth input from producing an absurd valuation.)

### Sensitivity range (not a single false-precise number)

Recompute fair value across a small grid — `r ∈ {r−0.01, r, r+0.01}` × `g1 ∈ {g1−0.03, g1, g1+0.03}`
— and report the **min and max** as the fair-value band. The center case is the headline number.

### Reverse DCF

Binary-search the `g1` (same 5-yr structure, same `r` and `g_term`) for which fair value equals
**today's price**. Report *"price implies ~X%/yr FCF growth for 5 yr"* and a one-word plausibility
read vs the default g1 (e.g. implied ≫ default → "demanding"; implied ≤ default → "undemanding").

### Verdict (margin of safety)

`mos = (fairValue − price) / price`, using the **center** fair value:

| Margin of safety | Verdict | Tone |
|---|---|---|
| `≥ +0.20` | Undervalued | good |
| `−0.15 … +0.20` | Roughly fair | neutral |
| `< −0.15` | Overvalued | bad |

### Deliberate simplifications (stated as caveats in the panel `note`)

- **FCFE approximation:** treats Yahoo `freeCashflow` as cash flow to equity, discounted at cost of
  equity — no WACC / enterprise→equity bridge (full WACC was ruled out). Net cash is *not* added
  separately (it accrues through the flows).
- **Single TTM FCF base**, not normalized — a one-off heavy-capex year distorts the base.
- **`rf` / `ERP` are hardcoded constants** (a live FRED treasury feed is sub-project E, later).
- **Fixed defaults, read-only** for v1 — assumptions are *displayed* but not user-editable; adjustable
  sliders are deferred to v3 polish.

## Applicability / graceful degradation

The engine gates hard rather than emit a garbage number. `computeValuation` returns either a
`ValuationData` with `applicable: true`, or one with `applicable: false` + a `reason` (panel shows the
reason, not a number):

- **ETFs** (`quoteType === 'ETF'`) → `applicable: false`, reason "Not applicable to funds."
- **Negative or missing FCF** → `applicable: false`, reason "DCF not applicable — negative/insufficient
  free cash flow," surfacing the actual FCF figure.
- **Missing price or marketCap** (can't derive shares) → `applicable: false`, reason "Insufficient data."
- **Financials** (`sector` contains "Financial") → still computes, but adds a soft caveat to `note`
  that FCF-based DCF is unreliable for banks/insurers.

The renderer treats `null` (service failure) and `applicable: false` distinctly: `null` → standard
Empty state; `applicable: false` → the reason string.

## Output shape (`src/shared/types.ts`)

```ts
export interface DcfAssumption {
  label: string   // "Stage-1 growth", "Discount rate (CAPM)", "Terminal growth", "FCF base (TTM)"
  value: string   // formatted: "12.0%", "9.8%", "2.5%", "$98.5B"
}

export interface ValuationData {
  symbol: string
  applicable: boolean
  reason?: string            // set when applicable === false
  // present only when applicable === true:
  fairValue?: number         // center case, per share
  fairValueLow?: number      // sensitivity band min
  fairValueHigh?: number     // sensitivity band max
  price?: number             // current, for comparison
  marginOfSafety?: number    // fraction; (fairValue − price)/price
  verdict?: 'undervalued' | 'fair' | 'overvalued'
  impliedGrowth?: number     // reverse-DCF g1, fraction
  impliedGrowthRead?: string // "demanding" | "undemanding" | …
  assumptions?: DcfAssumption[]
  note: string               // methodology caveat — always present
  asOf: string               // ISO timestamp
}
```

`AssayApi` gains `getValuation(symbol: string): Promise<ValuationData | null>`.
`ResearchData` gains an optional `valuation?: ValuationData | null` field (the same object, so the
skill/Opus sees the identical numbers the panel shows).

## Renderer (`src/renderer/App.tsx`)

A `ValuationPanel` mounted in the dashboard grid beside Scorecards, fetched on init via
`window.api.getValuation` (same `useEffect` shape the scorecards use):

- **Headline:** the fair-value **range** with the current price marked, and a **margin-of-safety badge**
  colored by verdict (emerald / amber / red — reuse the `CALL_STYLES` tone palette).
- **Reverse-DCF line:** *"To justify today's price, FCF must grow ~14%/yr for 5 yr — demanding."*
- **Assumptions table:** the `DcfAssumption[]` rows, so nothing is hidden.
- **Methodology note** in the muted caveat style.
- **`applicable: false`** → render `reason` centered in the muted Empty style; no number, no badge.

Tailwind only; reuse `Metric`/`SubHead`/tone patterns already in `App.tsx`.

## Skill touch (`/research` — `.claude/skills/research/SKILL.md`)

One small addition to the "Recommendation (you write this)" section: the `data` bundle now carries
`valuation`. Instruct Opus to **reference the DCF fair value & margin of safety** in the thesis when
`valuation.applicable` is true (e.g. "trades ~20% below a ~$X DCF fair value"), and to treat it as one
input among many — **not** a mechanical buy/sell trigger. No new push; no JSON shape changes for Claude.

## Testing (`src/main/services/dcf.test.ts`, vitest)

Like `scoring.test.ts`:
- **Known-input → known-output:** a hand-computed fair value for a fixed `YahooResearch` (assert within
  a cent / small epsilon).
- **Reverse-DCF round-trip:** feed the engine's own center fair value back as the price → implied growth
  recovers `g1` (within tolerance).
- **Clamps fire:** a 60% growth input clamps to 20%; a 0.2 β floors `r` at 0.07; a sky-high β caps at 0.14.
- **Sensitivity band:** `fairValueLow < fairValue < fairValueHigh`.
- **N/A paths:** ETF, negative FCF, and missing price each return `applicable: false` with the right reason.

## Out of scope (intentional)

- WACC / enterprise-value bridge, FCF normalization, live risk-free rate (FRED) — later or never.
- User-adjustable assumption sliders — v3 polish.
- DCF for ETFs / pre-profit companies — gated out by design.
- Persisting the valuation to `assay.db` — it's recomputed on open (cheap, deterministic), like scorecards.
