---
name: value-chain
description: Generate and explore a company's value chain (competitors / suppliers / customers) as a live radial graph in the Assay desktop app. Use when the user asks for a value chain, supply chain, competitors map, or "who are X's suppliers/customers" (e.g. "/value-chain AAPL", "show me NVDA's value chain").
---

# /value-chain <TICKER>

Generate a **value-chain map** for a US-listed company and render it live in a dedicated **Assay**
graph window. Per-seed graphs are stored and **merge on shared entities**, so the map grows as you run
this on more companies. Relationships are **hybrid-sourced with confidence tags**; the graph is for
exploration, not a financial assertion.

## Orchestration (you, the main agent)

1. **Coverage:** US-listed stocks (incl. ADRs). The *seed* must be public (it anchors the graph), but
   neighbors may be private companies or end-market segments.
2. **Freshness gate.** Run the open command — it opens/focuses the window (painting any cached graph)
   and reports freshness:
   ```
   node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs ensure
   node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs vc <TICKER>
   ```
   Returns `{ ok, ticker, lastGeneratedAt, nodeCount }`. If `lastGeneratedAt` is **within 30 days**
   and the user did **not** ask to *regenerate*/*revise* → tell them "loaded the cached value chain
   (generated Nd ago); say *regenerate* to refresh" and **stop**. Otherwise gather.
3. **Spawn one Sonnet sub-agent** (`subagent_type: "general-purpose"`, `model: "sonnet"`) with the
   **Sub-agent prompt** below (`<TICKER>` substituted). No `run_in_background` — you need its return.
4. **Wait passively** — do not echo/sleep/poll; the harness re-invokes you when it returns.
5. The sub-agent returns **candidate entities + edges**. You (Opus) **resolve tickers** (US-listed
   public cos only — leave private/segment nodes without one), **reconcile confidence** (downgrade
   anything you can't stand behind; never tag `disclosed-10K` unless it truly was), drop junk, then
   **push**:
   ```
   node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs value-chain <TICKER> --data <temp.json>
   ```
   where `<temp.json>` is `{ "entities": [...], "edges": [...] }`. Delete the temp file after. It
   returns `{ "ok": true, "delivered": true }`.
6. **Relay:** confirm the window rendered and summarize counts (e.g. "12 nodes: 5 competitors, 4
   suppliers, 3 customers; 6 high-confidence"). Don't paste raw JSON.

## Sub-agent prompt (substitute `<TICKER>`)

> You are gathering value-chain relationships for **`<TICKER>`**. Return structured candidates to the
> caller — do NOT push anything yourself. Work efficiently: ~6–10 tool calls.
>
> **1. Cheap context first:** `node C:/Users/Avi/Desktop/Developer/Assay/scripts/assay.mjs data <TICKER>`
> gives `sector`, `industry`, `business` — use them to seed competitor candidates.
>
> **2. Gather, hybrid + confidence (cap ~8 per relation, keep the graph legible):**
> - **Competitors:** same sector/industry names + 10-K **Item 1 "Competition"** (sec-edgar
>   `get_filing_sections` / `get_filing_content`, param **`identifier`**) + your own knowledge + ≤1
>   WebSearch. Tag named-in-10K or well-known → `high`; web → `web`; industry-inferred → `inferred`.
> - **Customers:** strongest source is **10-K customer-concentration disclosures** (>10%-of-revenue
>   customers must be named) + web + knowledge. Tag disclosed → `disclosed-10K`.
> - **Suppliers:** 10-K Item 1 / risk factors (key suppliers) + web + knowledge. Well-known
>   (e.g. TSMC↔Apple) → `high`/`well-known`.
> - For thin-data names (20-F filers, small caps) lean on web + knowledge and tag honestly — never
>   fabricate `disclosed-10K`. Low confidence is fine; it renders dimmed, not hidden.
>
> **3. Return to the caller** (machine-consumed — raw structure, no prose):
> - A JSON object `{ "entities": [...], "edges": [...] }` matching these shapes:
>   - entity: `{ "name", "ticker"? (US ticker if you know it), "kind": "public"|"private"|"segment", "description"? (one line), "aliases"?: [] }`
>   - edge: `{ "source", "target" (ticker if public else exact name), "relation": "supplier"|"customer"|"competitor", "confidence": "high"|"medium"|"low", "source_tag": "disclosed-10K"|"well-known"|"web"|"inferred", "rationale"? (one line) }`
>   - Always include the seed (`<TICKER>`, kind `public`) as an entity. Edge direction: supplier→seed,
>     seed→customer, seed→competitor.
> - Note any data-quality caveats (thin coverage, no 10-K). Do NOT resolve final tickers or push.

## Notes
- The seed must be public; neighbors needn't be. Private/segment nodes can't be expanded (no ticker).
- The window stores everything; re-running another company's chain grows the same map.
- If the app fails to launch or a push fails, surface it plainly.
