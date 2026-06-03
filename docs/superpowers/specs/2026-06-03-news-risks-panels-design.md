# News + Risks panels — design spec

**Date:** 2026-06-03
**Status:** Approved, ready for planning
**Sub-project:** C (News + Risks) of the panel decomposition — see `CLAUDE.md` roadmap v2.

## Goal

Add two qualitative panels to the Assay research dossier:

- **News & catalysts** — recent headlines plus a short forward-looking list of upcoming events.
- **Risks & red flags** — categorized, severity-tagged risks, with an optional strip of structural distress screens.

Both are Claude-pushed panels (like `sec-summary` and `recommendation`). The control server `/panel` endpoint and SQLite persistence are already **generic** — `news` and `risks` are already members of `PushPanelType` and flow + persist with **zero changes to main / preload / IPC / DB**. The work is confined to three files: shared types, the renderer, and the `/research` skill.

## Non-goals

- No new main-process services, IPC channels, or DB migrations.
- No app-side numeric computation — these panels are Claude's judgment layer.
- No two-year XBRL pulls or extra MCP calls solely to populate distress scores (see Risks §, "Distress screens").
- No markdown transport — both panels ship typed `data` payloads, consistent with the structured-panel convention.

## Division of labor

Mirrors the existing `/research` split (Sonnet gathers + does mechanical panels; Opus makes the judgment calls):

| Panel | Owner | Source |
|---|---|---|
| `news` | **Sonnet sub-agent** (push) | `yfinance_get_ticker_news` + WebSearch for catalysts |
| `risks` | **Main Opus agent** (write + push) | reasoning over the returned data bundle + SEC figures |

The sub-agent gathers and pushes News as part of its existing run, then extends its return bundle so Opus has the filing risk-factor material it already saw. Opus writes Risks alongside the recommendation it already writes today.

## Data shapes (`src/shared/types.ts`)

### News

```ts
export type NewsSentiment = 'positive' | 'negative' | 'neutral'

export interface NewsItem {
  headline: string
  source: string          // "Reuters", "Bloomberg", …
  date?: string           // ISO date (YYYY-MM-DD) — rendered relative at view time
  url?: string
  why?: string            // one-line "why it matters"
  sentiment?: NewsSentiment
}

export interface Catalyst {
  label: string           // "Q3 earnings", "WWDC keynote"
  when?: string           // free text: "~Aug 1", "Jun 9"
  kind?: 'earnings' | 'product' | 'regulatory' | 'other'
}

export interface NewsData {
  items: NewsItem[]
  catalysts?: Catalyst[]
  note?: string
  asOf?: string
}
```

**Why `date` is ISO, not a display string:** a "2d ago" baked in at push time goes stale once a persisted dossier reloads. Storing the ISO date and computing the relative age at render time keeps it accurate whenever the window is reopened.

### Risks

```ts
export type RiskSeverity = 'high' | 'medium' | 'low'

export interface RiskCategory {
  category: string        // "Financial", "Competitive", "Regulatory", "Macro", "Operational"
  severity: RiskSeverity
  points: string[]        // bullet risks under this category
}

export interface DistressScreen {
  label: string           // "FCF coverage", "Altman Z", "Accruals"
  value: string           // "1.8×", "3.1", "negative"
  band?: string           // "safe", "thin", "manipulation flag"
  tone?: 'good' | 'bad' | 'neutral'
}

export interface RisksData {
  categories: RiskCategory[]
  screens?: DistressScreen[]   // optional structural-distress strip
  note?: string                // methodology caveat — see below
  asOf?: string
}
```

**Distress screens — the lean decision (approved):** the `screens` strip is **optional**, and Opus computes **only what the data bundle already supports** — e.g. FCF coverage, a net-debt read, accruals sign (CFO vs net income), current-ratio level. A full Altman‑Z is included **only if** its inputs happen to be present; named academic scores (Piotroski‑F, Beneish‑M) that require balance-sheet line items or two-year deltas are **not** fetched specially. This keeps the panel lean (no extra MCP calls, no added Opus context cost). The `note` must always frame screens as **structural signals, not a return/performance forecast** — honoring the F-score caveat in project memory (a "scorecards beat the market" claim was research-refuted).

## Renderer (`src/renderer/App.tsx`)

Two new card components, each mirroring `SecSummaryCard` exactly:

- Same `Panel` wrapper, `panel?.title` fallback, and `savedAt` → "researched …" meta line.
- Same empty state: `<Loading label="Waiting for Claude…" />` until `panel.data` arrives.
- Mounted in the existing 2-column grid immediately after `SecSummaryCard`, giving the order: Price · Key stats · Scorecards · Recommendation · SEC summary · **News · Risks**.

**News card:**
- "Recent" section: list of `NewsItem`s — headline (linked to `url` if present), a `source · <relative date>` line, optional `why` line, and a sentiment pill (positive = emerald, negative = red, neutral = zinc).
- "Catalysts ahead" section (rendered only when `catalysts` is non-empty): a compact list of `label` + `when`, optionally icon-tinted by `kind`.

**Risks card:**
- One row per `RiskCategory`: category label, a severity indicator (filled dots ●●○ — high = 3, medium = 2, low = 1 — plus a small color-coded label), and the bullet `points` beneath.
- "Screens" strip (rendered only when `screens` is non-empty): inline `label value (band)` chips, tone-colored.
- `note` rendered in the same amber caveat box `SecSummary` uses.

**New helpers (local to `App.tsx`):**
- `fmtRelDate(iso: string): string` — "2d ago" / "3w ago" / falls back to the formatted date for older items.
- A sentiment pill and a severity-dots renderer (small inline components).
- Reuses existing `SubHead`, `Panel`, `Loading` as-is.

## Skill (`.claude/skills/research/SKILL.md`)

### Sub-agent prompt
- Add a gather step: pull recent headlines via `mcp__yfinance__yfinance_get_ticker_news` (param: `symbol`) and run one WebSearch for upcoming catalysts (earnings date, product/regulatory events).
- Add a push step: build and push the `news` panel with the `NewsData` shape (real headlines, ISO dates, tight `why` lines, sentiment).
- Extend the return contract: include the filing **risk-factor material** it already encountered (Item 1A themes, going-concern / liquidity flags) plus the figures Opus needs for screens, so Opus writes Risks without re-fetching.
- Keep it lean: news gathering is ~1–2 extra tool calls; do not chase a comprehensive feed.

### Main-agent section
- Add a "**Risks (you write this)**" section parallel to the existing "Recommendation (you write this)": Opus writes `RisksData` from the returned bundle + SEC figures and pushes the `risks` panel, applying the optional-screens rule and the structural-signal `note`.

### Notes
- Update the closing "more panels coming" line to reflect that `news` and `risks` now exist.
- Document both JSON shapes inline (the skill is the contract the pusher follows), matching how `sec-summary` and `recommendation` are documented.

## Testing / verification

- `npm run lint` (tsc `--noEmit`) green after the type + renderer changes.
- `npm run dev` + `/research <TICKER>` (e.g. AAPL): confirm the News card streams in from the sub-agent and the Risks card from Opus, both render their sections, and a window reopen reloads both from persistence with the relative dates still sensible.
- No unit-test surface here (no pure engine like `scoring.ts`) — these are render + prompt changes verified by the live click-through.

## Out of scope / deferred

- App-computed academic distress scores (would need a balance-sheet XBRL service) — revisit only if the optional-screens approach proves too thin.
- News sentiment as anything richer than a 3-way tag.
- Clustering/dedup of headlines across sources.
