# News + Risks Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two Claude-pushed qualitative panels — **News & catalysts** and **Risks & red flags** — to the Assay research dossier.

**Architecture:** Both panels reuse the existing generic `/panel` → IPC → persistence pipeline (the `news` and `risks` types already exist in `PushPanelType`), so there are **no main / preload / IPC / DB changes**. Work is confined to three files: typed payload shapes in `src/shared/types.ts`, two renderer cards in `src/renderer/App.tsx` (mirroring the existing `SecSummaryCard`), and gathering/writing instructions in `.claude/skills/research/SKILL.md`. Division of labor follows the current `/research` split: the Sonnet sub-agent gathers + pushes News; the main Opus agent writes + pushes Risks.

**Tech Stack:** TypeScript, React, Tailwind, Electron. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-03-news-risks-panels-design.md`

**Testing note:** This feature has no unit-test surface (no pure engine like `scoring.ts`; these are render + prompt changes). Per-task verification is `npm run lint` (`tsc --noEmit`) staying green; final verification is a live `npm run dev` + `/research` click-through. Each renderer card is added **and wired into the grid in the same task**, so no unused-symbol lint error is introduced.

---

### Task 1: Add News + Risks payload types

**Files:**
- Modify: `src/shared/types.ts` (insert after the `SecSummaryData` interface, before `ResearchInit`)

- [ ] **Step 1: Add the type definitions**

Insert this block immediately after the `SecSummaryData` interface (currently ending around `src/shared/types.ts:146`) and before `export interface ResearchInit`:

```ts
// ── News & catalysts (Claude-pushed) ─────────────────────────────────────────

export type NewsSentiment = 'positive' | 'negative' | 'neutral'

export interface NewsItem {
  headline: string
  source: string // "Reuters", "Bloomberg", …
  date?: string // ISO date (YYYY-MM-DD); rendered relative at view time
  url?: string
  why?: string // one-line "why it matters"
  sentiment?: NewsSentiment
}

export interface Catalyst {
  label: string // "Q3 earnings", "WWDC keynote"
  when?: string // free text: "~Aug 1", "Jun 9"
  kind?: 'earnings' | 'product' | 'regulatory' | 'other'
}

export interface NewsData {
  items: NewsItem[]
  catalysts?: Catalyst[]
  note?: string
  asOf?: string
}

// ── Risks & red flags (Claude-pushed) ────────────────────────────────────────

export type RiskSeverity = 'high' | 'medium' | 'low'

export interface RiskCategory {
  category: string // "Financial", "Competitive", "Regulatory", "Macro", "Operational"
  severity: RiskSeverity
  points: string[] // bullet risks under this category
}

export interface DistressScreen {
  label: string // "FCF coverage", "Altman Z", "Accruals"
  value: string // "1.8×", "3.1", "negative"
  band?: string // "safe", "thin", "manipulation flag"
  tone?: 'good' | 'bad' | 'neutral'
}

export interface RisksData {
  categories: RiskCategory[]
  screens?: DistressScreen[] // optional structural-distress strip
  note?: string // methodology caveat — structural signal, not a forecast
  asOf?: string
}
```

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: PASS (no errors). The new types are not yet referenced; that is fine — they are exported declarations.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): NewsData + RisksData panel payloads"
```

---

### Task 2: News card renderer (and wire into grid)

**Files:**
- Modify: `src/renderer/App.tsx` (type imports, grid, new components + `fmtRelDate` helper)

- [ ] **Step 1: Extend the type import**

In the `import type { … } from '../shared/types'` block at the top of `src/renderer/App.tsx`, add these three names (alongside the existing ones such as `SecSummaryData`):

```ts
  NewsData,
  NewsItem,
  NewsSentiment,
```

- [ ] **Step 2: Mount the News card in the grid**

In the `Dashboard` component's grid, immediately after the line `<SecSummaryCard panel={panels['sec-summary']} />`, add:

```tsx
        <NewsCard panel={panels['news']} />
```

- [ ] **Step 3: Add the News card components**

Insert this block after the `SecSummary` function (i.e. after the `// ── SEC filing summary ──` section ends, before the `// ── shared bits ──` `SubHead` section):

```tsx
// ── News & catalysts ─────────────────────────────────────────────────────────

function NewsCard({ panel }: { panel: PushPanel | undefined }): JSX.Element {
  const data = panel?.data as NewsData | undefined
  return (
    <Panel
      title={panel?.title ?? 'News & catalysts'}
      meta={panel?.savedAt ? `researched ${fmtStamp(panel.savedAt)}` : undefined}
    >
      {data ? <News data={data} /> : <Loading label="Waiting for Claude…" />}
    </Panel>
  )
}

function News({ data }: { data: NewsData }): JSX.Element {
  return (
    <div>
      {data.items.length > 0 ? (
        <ul className="space-y-3">
          {data.items.map((it, i) => (
            <NewsRow key={i} item={it} />
          ))}
        </ul>
      ) : (
        <Empty msg="No recent news" />
      )}

      {data.catalysts && data.catalysts.length > 0 && (
        <>
          <SubHead>Catalysts ahead</SubHead>
          <ul className="space-y-1 text-[13px]">
            {data.catalysts.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-zinc-600">▸</span>
                <span className="text-zinc-300">{c.label}</span>
                {c.when && <span className="text-zinc-500">· {c.when}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {data.note && (
        <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed text-amber-200/80">
          {data.note}
        </div>
      )}

      {data.asOf && <div className="mt-4 text-[11px] text-zinc-600">{data.asOf}</div>}
    </div>
  )
}

function NewsRow({ item }: { item: NewsItem }): JSX.Element {
  return (
    <li>
      <div className="flex items-start justify-between gap-2">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] font-medium text-zinc-200 hover:text-emerald-300 hover:underline"
          >
            {item.headline}
          </a>
        ) : (
          <span className="text-[13px] font-medium text-zinc-200">{item.headline}</span>
        )}
        {item.sentiment && <SentimentPill sentiment={item.sentiment} />}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">
        {item.source}
        {item.date && ` · ${fmtRelDate(item.date)}`}
      </div>
      {item.why && (
        <div className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">{item.why}</div>
      )}
    </li>
  )
}

const SENTIMENT_STYLES: Record<NewsSentiment, { label: string; cls: string }> = {
  positive: { label: 'pos', cls: 'bg-emerald-500/15 text-emerald-300' },
  negative: { label: 'neg', cls: 'bg-red-500/15 text-red-300' },
  neutral: { label: 'neu', cls: 'bg-zinc-700/50 text-zinc-400' }
}

function SentimentPill({ sentiment }: { sentiment: NewsSentiment }): JSX.Element {
  const s = SENTIMENT_STYLES[sentiment] ?? SENTIMENT_STYLES.neutral
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${s.cls}`}>
      {s.label}
    </span>
  )
}
```

- [ ] **Step 4: Add the `fmtRelDate` helper**

Insert this next to the other formatting helpers at the bottom of the file (e.g. right before `function fmtStamp`):

```tsx
// Relative age of an ISO date, computed at view time so reopened dossiers stay
// accurate. Falls back to an absolute "Mon D" for future or >30-day-old dates.
function fmtRelDate(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days < 0) return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
```

- [ ] **Step 5: Verify lint passes**

Run: `npm run lint`
Expected: PASS. All three imported names (`NewsData`, `NewsItem`, `NewsSentiment`) and the new components are now used.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(renderer): news & catalysts panel"
```

---

### Task 3: Risks card renderer (and wire into grid)

**Files:**
- Modify: `src/renderer/App.tsx` (type imports, grid, new components)

- [ ] **Step 1: Extend the type import**

In the same `import type { … } from '../shared/types'` block, add:

```ts
  RisksData,
  RiskCategory,
  RiskSeverity,
  DistressScreen,
```

- [ ] **Step 2: Mount the Risks card in the grid**

Immediately after the `<NewsCard panel={panels['news']} />` line added in Task 2, add:

```tsx
        <RisksCard panel={panels['risks']} />
```

- [ ] **Step 3: Add the Risks card components**

Insert this block after the News section added in Task 2 (before the `// ── shared bits ──` `SubHead` section):

```tsx
// ── Risks & red flags ────────────────────────────────────────────────────────

function RisksCard({ panel }: { panel: PushPanel | undefined }): JSX.Element {
  const data = panel?.data as RisksData | undefined
  return (
    <Panel
      title={panel?.title ?? 'Risks & red flags'}
      meta={panel?.savedAt ? `researched ${fmtStamp(panel.savedAt)}` : undefined}
    >
      {data ? <Risks data={data} /> : <Loading label="Waiting for Claude…" />}
    </Panel>
  )
}

const SEVERITY_META: Record<RiskSeverity, { dots: number; label: string; cls: string }> = {
  high: { dots: 3, label: 'high', cls: 'text-red-300' },
  medium: { dots: 2, label: 'med', cls: 'text-amber-300' },
  low: { dots: 1, label: 'low', cls: 'text-zinc-400' }
}

function Risks({ data }: { data: RisksData }): JSX.Element {
  return (
    <div>
      {data.categories.length > 0 ? (
        <div className="space-y-3">
          {data.categories.map((c, i) => (
            <RiskRow key={i} cat={c} />
          ))}
        </div>
      ) : (
        <Empty msg="No risks flagged" />
      )}

      {data.screens && data.screens.length > 0 && (
        <>
          <SubHead>Screens</SubHead>
          <div className="flex flex-wrap gap-2">
            {data.screens.map((s, i) => (
              <ScreenChip key={i} screen={s} />
            ))}
          </div>
        </>
      )}

      {data.note && (
        <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed text-amber-200/80">
          {data.note}
        </div>
      )}

      {data.asOf && <div className="mt-4 text-[11px] text-zinc-600">{data.asOf}</div>}
    </div>
  )
}

function RiskRow({ cat }: { cat: RiskCategory }): JSX.Element {
  const sev = SEVERITY_META[cat.severity] ?? SEVERITY_META.low
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium text-zinc-200">{cat.category}</span>
        <span className="tracking-tight text-red-300">
          {'●'.repeat(sev.dots)}
          <span className="text-zinc-700">{'○'.repeat(3 - sev.dots)}</span>
        </span>
        <span className={`text-[10px] uppercase tracking-wide ${sev.cls}`}>{sev.label}</span>
      </div>
      <ul className="mt-1 space-y-0.5 text-[13px] text-zinc-300">
        {cat.points.map((p, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-zinc-600">•</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ScreenChip({ screen }: { screen: DistressScreen }): JSX.Element {
  const tone =
    screen.tone === 'good'
      ? 'text-emerald-300'
      : screen.tone === 'bad'
        ? 'text-red-300'
        : 'text-zinc-200'
  return (
    <span className="rounded-md bg-zinc-800/60 px-2 py-1 text-[11px]">
      <span className="text-zinc-500">{screen.label} </span>
      <span className={`font-medium tabular-nums ${tone}`}>{screen.value}</span>
      {screen.band && <span className="text-zinc-500"> ({screen.band})</span>}
    </span>
  )
}
```

- [ ] **Step 4: Verify lint passes**

Run: `npm run lint`
Expected: PASS. All four new imports (`RisksData`, `RiskCategory`, `RiskSeverity`, `DistressScreen`) are now used.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(renderer): risks & red flags panel"
```

---

### Task 4: Skill — sub-agent gathers + pushes News, extends return bundle

**Files:**
- Modify: `.claude/skills/research/SKILL.md`

- [ ] **Step 1: Add a News gather + push step to the sub-agent prompt**

In the **Sub-agent prompt** section, after step **3** ("Build and push the SEC-summary panel only") and before step **4** ("Return to the caller"), insert a new step **3b**:

````markdown
> **3b. Gather and push the News & catalysts panel.**
> - Recent headlines: `mcp__yfinance__yfinance_get_ticker_news` (param: **`symbol`**) — take the most relevant 4–6.
> - Upcoming catalysts: run **one** WebSearch (e.g. `"<TICKER> earnings date 2026"`, plus any known product/regulatory events) — keep it to a short list, don't over-fetch.
> - Build the `news` JSON, write it to a temp file, push, delete the temp file:
> ```
> node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs panel <TICKER> news --title "News & catalysts" --data <temp.json>
> ```
> Do NOT send markdown for this type. Keep `why` to one tight line; set `sentiment` per item; use ISO dates (`YYYY-MM-DD`).
>
> **`news` JSON shape:**
> ```json
> {
>   "items": [
>     {
>       "headline": "Apple unveils M5 chips",
>       "source": "Reuters",
>       "date": "2026-05-30",
>       "url": "https://…",
>       "why": "Signals a faster Mac refresh cycle",
>       "sentiment": "positive"
>     }
>   ],
>   "catalysts": [
>     { "label": "Q3 earnings", "when": "~Aug 1", "kind": "earnings" },
>     { "label": "WWDC keynote", "when": "Jun 9", "kind": "product" }
>   ],
>   "note": "optional caveat",
>   "asOf": "data source + date (optional)"
> }
> ```
> `sentiment` is `"positive" | "negative" | "neutral"`; `kind` is `"earnings" | "product" | "regulatory" | "other"`. `catalysts`, `note`, `asOf` are optional.
````

- [ ] **Step 2: Extend the sub-agent's return contract for Risks**

In the same **Sub-agent prompt** section, in step **4** ("Return to the caller"), add a fourth bullet so the caller can write the Risks panel without re-fetching:

```markdown
> - **Risk inputs for the caller:** the filing's **risk-factor themes** (Item 1A topics, going-concern / liquidity flags, customer-concentration or litigation notes you saw) plus any balance-sheet figures you already have. Just list what you encountered — do NOT write the risks panel; the caller does that.
```

- [ ] **Step 3: Verify the doc reads correctly**

Run: `git diff .claude/skills/research/SKILL.md`
Expected: the new step 3b and the new return bullet appear in the Sub-agent prompt section; nothing else changed.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/research/SKILL.md
git commit -m "feat(skill): sub-agent gathers and pushes news panel"
```

---

### Task 5: Skill — main agent writes + pushes Risks

**Files:**
- Modify: `.claude/skills/research/SKILL.md`

- [ ] **Step 1: Add a "Risks" main-agent section**

After the existing **## Recommendation (you, the main agent on Opus, write & push this)** section (which ends with its `recommendation` JSON shape) and before the **## Notes** section, insert:

````markdown
## Risks (you, the main agent on Opus, write & push this)

After the sub-agent returns, write the `risks` panel **yourself** from its risk-input notes + the `data` bundle + SEC figures — the severity judgment stays on the stronger model:
- **Categories:** group risks under labels like Financial / Competitive / Regulatory / Macro / Operational. Each gets a `severity` (`high` | `medium` | `low`) and tight bullet `points`.
- **Screens (optional):** include a `screens` strip **only with what the bundle already supports** — e.g. FCF coverage (`freeCashflow` vs `totalDebt`/interest), net-debt read (`totalDebt − totalCash`), accruals sign (`operatingCashflow` vs `netIncome`), current ratio. Add a full **Altman Z only if** its inputs are present. Do **NOT** make extra MCP calls to populate named academic scores (Piotroski-F, Beneish-M); omit what you can't compute cheaply.
- **`note`:** always frame screens as **structural signals, not a return/performance forecast.**
- Write the JSON to a temp file and push (then delete the temp file):
  ```
  node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs panel <TICKER> risks --title "Risks & red flags" --data <temp.json>
  ```
  Do NOT send markdown for this type. It returns `{"ok":true,"delivered":true}`.

**`risks` JSON shape:**
```json
{
  "categories": [
    {
      "category": "Financial",
      "severity": "high",
      "points": ["Net debt rising while FCF stays thin", "Interest coverage compressing"]
    },
    {
      "category": "Regulatory",
      "severity": "medium",
      "points": ["DOJ antitrust case unresolved"]
    }
  ],
  "screens": [
    { "label": "FCF coverage", "value": "1.8×", "band": "adequate", "tone": "neutral" },
    { "label": "Accruals", "value": "negative", "band": "earnings > cash", "tone": "bad" }
  ],
  "note": "Screens are structural signals from filing data, not a forecast of returns.",
  "asOf": "data source + date (optional)"
}
```
`severity` is `"high" | "medium" | "low"`; screen `tone` is `"good" | "bad" | "neutral"`. `screens`, `note`, `asOf` are optional.
````

- [ ] **Step 2: Update the closing Notes line**

In the **## Notes** section, replace the line:

```markdown
- More panels (value chain, news, risks, peers, scorecards) are coming — only `sec-summary` and `recommendation` exist for now.
```

with:

```markdown
- Panels live now: `sec-summary`, `recommendation`, `news`, `risks` (plus the app-owned chart, key stats, and scorecards). Still coming: value chain and peers.
```

- [ ] **Step 3: Verify the doc reads correctly**

Run: `git diff .claude/skills/research/SKILL.md`
Expected: the new `## Risks` section and the updated Notes line appear; nothing else changed.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/research/SKILL.md
git commit -m "feat(skill): main agent writes risks panel"
```

---

### Task 6: Final verification + docs

**Files:**
- Modify: `CLAUDE.md` (roadmap v2 check-offs + status)

- [ ] **Step 1: Lint the whole project**

Run: `npm run lint`
Expected: PASS, no errors.

- [ ] **Step 2: Live click-through**

Run `npm run dev` (⚠ never with `NODE_OPTIONS=--use-system-ca` — Electron refuses to launch), then in Claude Code run `/research AAPL`. Confirm:
- The **News & catalysts** card streams in (headlines with sources/dates/sentiment pills, a catalysts-ahead list).
- The **Risks & red flags** card streams in (severity dots per category, optional screens strip, the structural-signal note).
- Close and reopen the AAPL window: both cards reload from persistence and the relative dates still read sensibly.

If a push fails, check that `scripts/assay.mjs` forwards the `news` / `risks` type through to `POST /panel/:type` (the endpoint is generic, so it should — surface any error plainly).

- [ ] **Step 3: Check off the roadmap**

In `CLAUDE.md`, under **### v2 — fill out the panels**, replace:

```markdown
- [ ] News & catalysts panel
- [ ] Risks / red flags panel
```

with:

```markdown
- [x] News & catalysts panel — Claude-pushed (`NewsData`); Sonnet sub-agent gathers (yfinance news + WebSearch) & pushes. See [spec](docs/superpowers/specs/2026-06-03-news-risks-panels-design.md)
- [x] Risks / red flags panel — Claude-pushed (`RisksData`); main Opus agent writes (categorized + optional structural screens). Same spec
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: check off news + risks panels in roadmap"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** Task 1 = data shapes; Tasks 2–3 = renderer cards (News/Risks, helpers, grid wiring); Task 4 = sub-agent News gather/push + return contract; Task 5 = main-agent Risks section + Notes update; Task 6 = lint, live test, roadmap. Every spec section maps to a task.
- **Type consistency:** the property names used in the renderer (`items`, `catalysts`, `headline`, `source`, `date`, `url`, `why`, `sentiment`, `categories`, `severity`, `points`, `screens`, `label`, `value`, `band`, `tone`) exactly match the Task 1 interfaces and the skill JSON shapes in Tasks 4–5.
- **No main/preload/IPC/DB changes** are required — confirmed against the spec; the `/panel` pipeline and persistence are generic over `PushPanelType`.
