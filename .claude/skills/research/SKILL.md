---
name: research
description: Research a US stock or ETF and stream a live research dossier into the Assay desktop app. Use when the user asks to research, analyze, or "look into" a ticker (e.g. "research AAPL", "/research MSFT", "should I buy NVDA?").
---

# /research <TICKER>

Run a full research pass on a US-listed stock or ETF and render it live in the **Assay** app. The app draws the numeric panels (price chart, key stats) itself. The qualitative layer is split: a cheap **Sonnet sub-agent** does the mechanical gathering and the **SEC-summary** panel, then hands you a slim data bundle; **you (the main agent, on Opus) write the recommendation thesis** from that bundle and push it — so the judgment call stays on the stronger model while the bulk work stays cheap.

## How to run this (orchestration — you, the main agent)

1. Coverage is **US-listed stocks & ETFs only.** NYSE/Nasdaq-listed **ADRs of foreign companies count** (they have a US ticker plus Yahoo/SEC data — e.g. ASX = ASE Technology, TSM, BABA). Out of scope and stop: tickers **not listed on a US exchange**, crypto, and forex. If unsure whether a ticker is US-listed, proceed — the data fetch will fail cleanly if it isn't.
2. Spawn **one** sub-agent via the **Agent** tool with **`subagent_type: "general-purpose"` and `model: "sonnet"`**, passing the **Sub-agent prompt** below with `<TICKER>` substituted. (Do **not** use `run_in_background` — you need its return value to write the recommendation.)
3. **Wait passively.** Do NOT run `echo`/`sleep`/poll filler — the harness re-invokes you when the sub-agent returns. (Global no-polling rule is in memory.)
4. The sub-agent returns the **slim `data` bundle** (≈600 tokens) plus confirmation it pushed the sec-summary. Using that bundle, **write and push the recommendation yourself** — see **Recommendation (you write this)** below.
5. Relay to the user: confirm both panels rendered, and surface your recommendation **call + headline**. Don't re-paste the raw bundle.

## Research discipline (applies to every panel you write)

Distilled from market-research methodology. Apply as **behind-the-scenes reasoning discipline** — there is no citation UI; do not add a `sources` field. Five standards:

1. **Source important claims.** A non-obvious market/competitive claim must be grounded in something you actually saw — the app-fetched `data` bundle, the sub-agent's news/risk inputs, or a search you ran — not asserted from memory. If you can't ground it, soften it or drop it.
2. **Flag stale data.** When consensus, price targets, or figures predate a known newer event, say so in the panel's `note` / `asOf` (e.g. a "Strong Buy" consensus that predates a CEO-departure headline).
3. **Weigh contrarian evidence.** Never write a one-sided thesis. The recommendation's `buyIf` / `avoidIf` carry the opposing case; the risks panel is the downside case. Steelman the other side.
4. **Separate fact from inference.** Distinguish reported figures from your interpretation (e.g. "ROE 141%" is a fact; "that's a buyback artifact, not organic returns" is inference — label it).
5. **Decide, don't summarize.** Every panel should make the user's decision easier, not restate data. End on a call or a clear "so what."

## Sub-agent prompt (substitute `<TICKER>`)

> You are gathering data for **`<TICKER>`** and rendering the **SEC-summary** panel in the running Assay desktop app. You do **not** write the recommendation — the calling agent does that from the bundle you return.
>
> Work efficiently — a clean run is **~5–6 tool calls**. Do NOT create probe/scratch files, do NOT re-run a call that already returned, and do NOT run `echo`/`sleep`/poll filler to "wait" — results arrive on their own.
>
> Helper CLI: `node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs <cmd>`
>
> **1. Ensure the app and open the window:**
> ```
> node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs ensure
> node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs research <TICKER>
> ```
> The app self-renders the price chart and key stats — do NOT duplicate that.
>
> **2. Fetch the data bundle — app-side first, MCP only to fill gaps.**
> Run `node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs data <TICKER>` → `{ "ok": true, "ticker", "data": {…} }`. `data` carries:
> - **Valuation/price:** `price`, `marketCap`, `trailingPE`, `forwardPE`, `pegRatio`, `priceToSales`, `priceToBook`, `beta`, `fiftyTwoWeekLow/High`, `fiftyDayAverage`, `twoHundredDayAverage`, `trailingEps`, `forwardEps`.
> - **Trajectory:** `totalRevenue` (TTM), `revenueGrowth`, `earningsGrowth`, `grossMargins`, `operatingMargins`, `profitMargins`, `returnOnEquity`, `freeCashflow`, `operatingCashflow`, `totalCash`, `totalDebt` — growth/margins are **fractions** (0.166 = +16.6%), TTM/MRQ.
> - **`analyst`:** `rating`, `score` (1 = strong buy … 5 = sell), `count`, `targetLow/Mean/Median/High`. May be thin: `rating` can be `"none"` and `score` absent for lightly-covered names.
> - **`sec`:** latest `filing` (`form`/`period`/`filed`/`accession`) + `revenue`, `netIncome`, `operatingIncome`, `grossProfit`, `epsDiluted` — each picked from that filing's own accession (context-clean, **native XBRL signs** — a loss stays negative) — plus `business`/`sector`/`industry`.
> - **`valuation`:** app-computed 2-stage DCF — `applicable`, and when true `fairValue`, `fairValueLow/High`, `marginOfSafety`, `verdict`, `impliedGrowth`. Pass it through verbatim; the caller uses it for the recommendation.
>
> Call MCP **only** to fill a genuine gap:
> - `data.sec` is `null` or missing figures you need → `mcp__sec-edgar__get_financials` / `mcp__sec-edgar__get_recent_filings` with **`identifier`**.
> - `data` is empty / the call failed → `mcp__yfinance__yfinance_get_ticker_info` with **`symbol`**.
> - Param reminder: yfinance uses **`symbol`**; sec-edgar uses **`identifier`** — wrong names silently return generic/empty data. The app's `sec` figures are accession-scoped; if you fall back to MCP `get_financials`, beware its raw XBRL can mix `context_ref`s and once reported COIN's loss with the wrong (positive) sign — trust `data.sec`. Flag any caveat in the panel `note`.
>
> **Foreign private issuers / ADRs (e.g. ASX, TSM, BABA).** These file **20-F (annual) / 6-K (interim)**, not 10-K/10-Q, and the app's `data.sec` typically returns **only a CIK with no XBRL figures** — don't burn MCP calls chasing them; source the financials from the Yahoo bundle instead. Critically, **reporting currency may not be USD**: operating figures (revenue, cash flow, debt) can be in the home currency (TWD, CNY, etc.) while `price`/`marketCap`/`analyst.target*` are USD (the ADR). When that's the case:
> - **State the currency** on the affected metrics and in the panel `note`.
> - **Distrust cross-currency ratios** — `priceToSales` is meaningless when revenue is in TWD and market cap in USD; do not present it as-is. `trailingPE`/`forwardPE` (both USD, from EPS) and margins/growth (unitless fractions) remain valid.
>
> **3. Build and push the SEC-summary panel only.** Write the JSON to a temp file, send with `--data`, delete the temp file:
> ```
> node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs panel <TICKER> sec-summary --title "SEC Filing Summary" --data <temp.json>
> ```
> Do NOT send markdown for this type. Keep it tight: real numbers, short strings. Use `tone: "good" | "bad" | "neutral"` on metrics (a loss → `bad`). It returns `{"ok":true,"delivered":true}`.
>
> **`sec-summary` JSON shape:**
> ```json
> {
>   "business": "what the company does — 1–2 sentences",
>   "filing": { "form": "10-Q", "period": "Q1 2026 (ended 2026-03-31)", "filed": "2026-05-07" },
>   "metrics": [
>     { "label": "Revenue", "value": "$1.41B", "sub": "-31% YoY", "tone": "bad" },
>     { "label": "Op income", "value": "-$21M", "tone": "bad" },
>     { "label": "Net income", "value": "-$394M", "tone": "bad" },
>     { "label": "Diluted EPS", "value": "-$1.49", "tone": "bad" }
>   ],
>   "highlights": [ "tight bullet", "another notable item" ],
>   "trajectory": "short read on where the financials are heading (optional)",
>   "note": "any caveat or data-quality flag (optional — e.g. reporting currency, 20-F filer)"
> }
> ```
> For a non-USD filer, label values (e.g. `"NT$670.9B"`) and add the currency to `note`.
>
> **3b. Gather and push the News & catalysts panel.**
> - Recent headlines: `mcp__yfinance__yfinance_get_ticker_news` (param: **`symbol`**) — take the most relevant 4–6.
> - Upcoming catalysts: run **one** WebSearch (e.g. `"<TICKER> earnings date 2026"`, plus any known product/regulatory events) — keep it to a short list, don't over-fetch.
> - Build the `news` JSON, write it to a temp file, push, delete the temp file:
> ```
> node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs panel <TICKER> news --title "News & catalysts" --data <temp.json>
> ```
> Do NOT send markdown for this type. Keep `why` to one tight line; set `sentiment` per item; use ISO dates (`YYYY-MM-DD`).
> **Discipline:** include a headline only if it's material; set `sentiment` honestly (not optimistically); ground each `why` in the item itself; flag any stale or unconfirmed item in `note` rather than presenting it as settled.
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
>
> **4. Return to the caller** (this is the only output that matters — it's machine-consumed, not shown to a human):
> - The **entire `data` bundle JSON verbatim** (the caller needs it to write the recommendation).
> - One line confirming the sec-summary push returned `delivered:true` (or what failed).
> - Any data-quality caveat you hit (reporting currency, thin analyst coverage, sparse SEC data). Do NOT write a recommendation — that's the caller's job.
> - **Risk inputs for the caller:** the filing's **risk-factor themes** (Item 1A topics, going-concern / liquidity flags, customer-concentration or litigation notes you saw) plus any balance-sheet figures you already have. Just list what you encountered — do NOT write the risks panel; the caller does that.

## Recommendation (you, the main agent on Opus, write & push this)

After the sub-agent returns, write the recommendation **yourself** from its `data` bundle — this is the judgment call, kept on the stronger model:
- **Apply the Research discipline** (above): weigh contrarian evidence (the thesis must acknowledge the opposing case, with `buyIf` / `avoidIf` as the vehicle), separate fact from inference, and flag stale consensus/targets in `asOf` when a newer event is known.
- **Call + thesis:** your own buy/hold/avoid with reasoning, `buyIf`, `avoidIf`. Apply a **consistent valuation discipline across tickers** (e.g. forward P/E vs growth — the cross-ticker consistency is the main reason this lives on Opus, not the sub-agent). For non-USD filers, lean on currency-clean signals (forward P/E, margins, growth, price-vs-MA) and **ignore cross-currency ratios** like P/S.
- **Reference the DCF when present:** the `data` bundle now carries `valuation` (an app-computed 2-stage DCF). When `valuation.applicable` is true, weave its read into your thesis — e.g. "trades ~20% below a ~$X DCF fair value (margin of safety +20%)" or "priced for demanding ~18%/yr FCF growth (reverse DCF)". Treat it as **one input among many, not a mechanical buy/sell trigger**, and respect its caveats (FCFE approximation, single TTM FCF base; unreliable for financials). When `valuation.applicable` is false, ignore it. The Valuation panel renders itself — you do **not** push it.
- **`street`** maps from `data.analyst`: `rating`, `score`, `analysts: count`, `targets: { current: data.price, low: targetLow, mean: targetMean, median: targetMedian, high: targetHigh }`.
  - **Thin / absent coverage:** if `rating` is `"none"` or `score` is missing, **omit `score`** and set `rating` to a plain-language label like `"Thin coverage (3 analysts, no consensus rating)"`. Note when the price already sits above the mean target.
- Write the JSON to a temp file and push (then delete the temp file):
  ```
  node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs panel <TICKER> recommendation --title "Recommendation" --data <temp.json>
  ```
  Do NOT send markdown for this type. It returns `{"ok":true,"delivered":true}`.

**`recommendation` JSON shape:**
```json
{
  "call": "buy | hold | avoid",
  "headline": "one-line summary of the call",
  "thesis": "short paragraph — the reasoning behind your call",
  "buyIf": "what would flip you to buy (optional)",
  "avoidIf": "what would flip you to avoid (optional)",
  "street": {
    "rating": "Buy",
    "score": 1.98,
    "analysts": 43,
    "targets": { "current": 312, "low": 215, "mean": 310.5, "median": 310, "high": 400 },
    "notable": [ { "firm": "Wedbush", "target": 400, "note": "AI inflection" } ]
  },
  "asOf": "data source + date (optional)"
}
```

## Risks (you, the main agent on Opus, write & push this)

After the sub-agent returns, write the `risks` panel **yourself** from its risk-input notes + the `data` bundle + SEC figures — the severity judgment stays on the stronger model:
- **Apply the Research discipline** (above): every risk point should be grounded in the bundle/filing/news inputs (not asserted), and you should separate reported facts from your inference when stating a point. Note unconfirmed or stale items rather than presenting them as settled.
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

## Notes
- Panels live now: `sec-summary`, `recommendation`, `news`, `risks` (plus the app-owned chart, key stats, and scorecards). Still coming: value chain and peers.
- If the app fails to launch or a push fails, surface it plainly to the user.
