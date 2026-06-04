# Value-Chain Map — Design Spec

**Date:** 2026-06-03
**Status:** Approved (pending spec review)
**Roadmap item:** v3 — "Value-chain **node graph** (graph lib, e.g. React Flow) — Claude supplies entities/edges"

> Sub-project **F** of the six identified from the 2026-06-03 skills/MCP research
> (others: Scorecards ✅, News+Risks ✅, DCF valuation ✅, Peer comparison, FRED macro).
> Each gets its own spec → plan → build cycle. This spec covers **only** the value-chain map.

## Overview

A **standalone feature parallel to `/research`** — not a panel in the research dossier. You run
`/value-chain TICKER`; a **dedicated window** opens centered on that company, showing a **radial node
graph** of its **competitors / suppliers / customers**. Each node carries a one-line "what they do";
each edge carries "how they're related" + a **confidence tag**.

Unlike `/research` (a fresh, one-shot, per-ticker dossier), the value-chain map **accretes**. Each
seed's graph is **stored** and entities **merge on identity**, so running `/value-chain` on more
companies grows a single shared map. You "drill deeper" not via a live channel but by **generating a
neighbor's chain** — its subgraph joins the store and any window touching those nodes reflects it.

Two ideas drive the architecture, both chosen by the user during brainstorming:

1. **Claude is the brain; the app stores + renders.** Claude gathers relationships (hybrid:
   knowledge + grounded sources) and pushes a structured graph. The app never computes relationships;
   it dedups, persists, and draws. (Same division of labor as the qualitative panels.)
2. **Freshness cache.** A seed generated **<30 days** ago loads from the DB with **zero gathering
   tokens**; older/absent regenerates. Manual `regenerate` / `revise` always override.

This is the first feature with a **persistent, cross-ticker domain store** (prior panels were either
recomputed on open or a single upserted row per ticker+type). It adds a real graph schema, a new
control endpoint, a new window type, and the project's first graph-rendering dependency.

## Division of labor

| Concern | Owner |
|---|---|
| Gather competitors / suppliers / customers + descriptions + confidence | **Claude** (skill + Sonnet sub-agent) |
| Resolve tickers, assign final confidence, sanity-check | **Claude** (main Opus agent) |
| Dedup entities, store edges with provenance, freshness bookkeeping | **App** (main process) |
| Lay out & render the radial graph, node detail, expand/collapse | **App** (renderer) |

No relationship logic lives in the app; no rendering/storage logic lives in Claude.

## Architecture

```
You: "/value-chain AAPL" in Claude Code
  ├─ skill: assay.mjs vc AAPL
  │     → main opens/focuses the VC window for AAPL, returns { lastGeneratedAt, nodeCount }
  ├─ FRESH (<30d) and not forced  → app already loaded it from DB; skill stops (0 tokens)
  └─ STALE / absent / forced      → gather, then push:
        assay.mjs value-chain AAPL --data graph.json
          → POST /value-chain { seed, entities[], edges[], generatedAt }
               └─ main: upsert entities (dedup) + replace seed's edges + record generation
                    └─ webContents.send → VC window re-reads & re-renders
```

Layers (each independently testable, mirroring the scorecards/DCF separation):

- **`src/main/database/valueChain.ts`** (NEW) — pure-ish DB layer: `upsertGraph(seed, payload)`,
  `getGraph(seed)`, `getGeneration(seed)`. The dedup/merge/provenance rules live here.
- **`src/main/server/controlServer.ts`** — add `POST /value-chain` (token-auth, localhost-only, like
  existing endpoints) that calls `upsertGraph` and forwards to the target window.
- **`src/main/windows.ts`** — a **VC window kind** (distinct from research windows), keyed by seed.
- **`src/main/ipc/handlers.ts`** + **preload** — `getValueChain(seed)` IPC → `getGraph(seed)`.
- **`src/renderer/`** — a **VC entry** (its own root, selected by an init flag) rendering the graph
  with **React Flow + d3-force**.
- **`scripts/assay.mjs`** — `vc TICKER` (open/focus + freshness) and `value-chain TICKER --data`.
- **`.claude/skills/value-chain/SKILL.md`** (NEW) — the orchestration.

### Why a new window root, not the research dashboard

The research window is `Dashboard({ ticker })` — a per-ticker dossier grid. The VC map is a
**different mode** (a cross-company graph that accretes) and the user chose **new window per seed,
shared store**. `App.tsx`'s `onInit` already branches on what the window is for; we extend the init
payload to say *which* surface this window is (`research` vs `value-chain`) and mount the right root.
This keeps the graph code out of the dossier file (which is already large) — a clean boundary.

## The data model (new SQLite migration — `assay.db` v4)

Three tables. Entities are **global and deduped**; edges carry **seed provenance** so a regenerate is
a clean per-seed replace without disturbing other seeds' contributions to shared nodes.

```sql
-- Global, deduped entities. Public companies key on ticker; everything else on normalized_name.
CREATE TABLE vc_entities (
  id              INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL,              -- 'public' | 'private' | 'segment'
  ticker          TEXT UNIQUE,               -- NULL for private/segment
  name            TEXT NOT NULL,             -- display name
  normalized_name TEXT NOT NULL,             -- lowercased/trimmed key for non-public dedup
  aliases         TEXT,                      -- JSON string[] (e.g. ["Hon Hai"]) to soften name-dup
  description     TEXT,                      -- one-line "what they do"
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX vc_entities_norm ON vc_entities(normalized_name) WHERE ticker IS NULL;

-- Directed/typed edges, tagged with the seed that produced them (provenance).
CREATE TABLE vc_edges (
  id          INTEGER PRIMARY KEY,
  source_id   INTEGER NOT NULL REFERENCES vc_entities(id),
  target_id   INTEGER NOT NULL REFERENCES vc_entities(id),
  relation    TEXT NOT NULL,                 -- 'supplier' | 'customer' | 'competitor'
  confidence  TEXT NOT NULL,                 -- 'high' | 'medium' | 'low'
  source_tag  TEXT NOT NULL,                 -- 'disclosed-10K' | 'well-known' | 'web' | 'inferred'
  rationale   TEXT,                          -- one-line "how they're related"
  seed_ticker TEXT NOT NULL,                 -- provenance: which generation produced this edge
  generated_at INTEGER NOT NULL
);
CREATE INDEX vc_edges_seed   ON vc_edges(seed_ticker);
CREATE INDEX vc_edges_source ON vc_edges(source_id);
CREATE INDEX vc_edges_target ON vc_edges(target_id);

-- One row per seed; backs the 30-day freshness gate.
CREATE TABLE vc_generations (
  seed_ticker  TEXT PRIMARY KEY,
  generated_at INTEGER NOT NULL,
  note         TEXT
);
```

### Edge-direction convention

Relations are stored from the **focus company's perspective** at generation time, normalized so the
renderer can draw arrows consistently:

- `supplier`: edge **supplier → focus** (goods/services flow into focus).
- `customer`: edge **focus → customer**.
- `competitor`: stored `focus → competitor`; rendered **undirected** (no arrowhead).

Because the map accretes, a node can be a customer in one seed's generation and a supplier in
another's — that's why the **edge** (not the node) carries the relation, and why the layout is radial,
not columnar (a columnar supplier→customer layout can't represent the resulting cycles).

### Dedup / merge rules (`upsertGraph`)

On `POST /value-chain { seed, entities[], edges[], generatedAt }`, inside one transaction:

1. **Resolve/insert each entity.** Public (`ticker` present) → match on `ticker`; else match on
   `normalized_name`. On match, **update** `description`/`name`/`aliases` only if the incoming row is
   non-empty (don't clobber a good description with a blank); never downgrade `kind: public`→other.
   On miss, insert. Return a name/ticker → `id` map for edge wiring.
2. **Replace this seed's edges.** `DELETE FROM vc_edges WHERE seed_ticker = :seed`, then insert the
   incoming edges (mapped to entity ids). Edges from *other* seeds are untouched — so a shared node
   keeps the edges other generations gave it.
3. **Record the generation.** Upsert `vc_generations(seed, generatedAt)`.
4. **Orphan sweep (lightweight):** delete entities with no remaining edges *and* no `vc_generations`
   row (so a seed company you've explored stays even if momentarily edgeless). Keep it simple — a
   single `DELETE … WHERE id NOT IN (SELECT … )`.

### What a window shows (`getGraph(seed)`)

Return the **connected component reachable from the seed** over `vc_edges`, but **cap the default
depth to keep the first paint legible**:

- Always include the seed + its **1-hop** neighbors.
- Mark any node that has its **own `vc_generations` row** as `expandable: true`. The renderer reveals
  *its* stored neighbors on click (data already in the component payload; expansion is pure UI state).
- Nodes with no generation are **leaves** with a "run `/value-chain TICKER` to expand" hint (public
  nodes only — private/segment nodes can't be seeded).

`getGraph` returns the full reachable component's nodes+edges in one payload (it's small — tens of
nodes), and the renderer decides what's visible. No pagination in v1.

## Control server + client

**Endpoint** (`controlServer.ts`) — same auth/localhost guards as `/research` and `/panel/:type`:

```
POST /value-chain
  body: { seed: string, entities: VcEntityIn[], edges: VcEdgeIn[], generatedAt: number }
  → upsertGraph(seed, body); forward refreshed getGraph(seed) to the VC window; { ok, delivered }
```

**`assay.mjs`** gains two commands (thin wrappers over the existing token+fetch helper):

- `node scripts/assay.mjs vc <TICKER>` → `POST /research`-style open: ensures the VC window exists &
  focused, returns `{ ok, lastGeneratedAt, nodeCount }` (from `vc_generations` + `getGraph`). **The
  skill's freshness gate reads this.**
- `node scripts/assay.mjs value-chain <TICKER> --data <file.json>` → `POST /value-chain`. Returns
  `{ ok, delivered }`.

(Window-open and freshness are folded into one `vc` call so the app can paint the cached graph
immediately while Claude decides whether to regenerate.)

## Output shape (`src/shared/types.ts`)

```ts
export type VcKind = 'public' | 'private' | 'segment'
export type VcRelation = 'supplier' | 'customer' | 'competitor'
export type VcConfidence = 'high' | 'medium' | 'low'
export type VcSource = 'disclosed-10K' | 'well-known' | 'web' | 'inferred'

// What Claude pushes (no ids — the app assigns/dedups them).
export interface VcEntityIn {
  name: string
  ticker?: string          // set for US-listed public cos; enables dedup + clickability
  kind: VcKind
  description?: string      // one-line "what they do"
  aliases?: string[]
}
export interface VcEdgeIn {
  source: string           // ticker if public, else name — must match an entity in the same push
  target: string
  relation: VcRelation
  confidence: VcConfidence
  source_tag: VcSource
  rationale?: string        // one-line "how they're related"
}
export interface VcPushPayload {
  seed: string             // ticker of the focus company
  entities: VcEntityIn[]
  edges: VcEdgeIn[]
  generatedAt: number
}

// What the renderer reads back (ids assigned, expandable computed).
export interface VcNode {
  id: number
  name: string
  ticker?: string
  kind: VcKind
  description?: string
  expandable: boolean       // has its own stored generation
}
export interface VcEdge {
  source: number
  target: number
  relation: VcRelation
  confidence: VcConfidence
  source_tag: VcSource
  rationale?: string
}
export interface VcGraph {
  seed: string
  nodes: VcNode[]
  edges: VcEdge[]
  lastGeneratedAt: number | null
}
```

`AssayApi` gains `getValueChain(seed: string): Promise<VcGraph | null>` and the existing `onInit`
payload gains a discriminant so a window knows it's a VC surface:

```ts
export interface SurfaceInit {
  kind: 'research' | 'value-chain'
  ticker: string
}
```

(`ResearchInit` is folded into `SurfaceInit` — `onInit` already exists; this just adds `kind`.)

## Skill & orchestration (`.claude/skills/value-chain/SKILL.md`, NEW)

Mirrors `/research`'s proven shape (skill delegates heavy gathering to a **Sonnet sub-agent**; the
**main Opus agent** makes the judgment calls — here, ticker resolution + final confidence):

1. **Freshness gate.** `assay.mjs vc <TICKER>` → opens/focuses the window (app paints any cached
   graph) and returns `{ lastGeneratedAt, nodeCount }`. If `lastGeneratedAt` is **<30 days** and the
   user didn't say *regenerate*/*revise* → report "loaded cached value chain (generated Nd ago); say
   *regenerate* to refresh" and **stop**. Otherwise gather.
2. **Spawn one Sonnet sub-agent** (`subagent_type: general-purpose`, `model: sonnet`) with the
   gathering prompt. No `run_in_background` (the main agent needs the return value).
3. **Wait passively** (no echo/sleep/poll filler — harness re-invokes on return; per memory rule).
4. Sub-agent returns **structured candidate entities + edges with raw source tags**. The **main Opus
   agent** resolves tickers (US-listed only get one), reconciles confidence, drops anything it can't
   stand behind, then pushes via `assay.mjs value-chain <TICKER> --data <file>`.
5. Relay: confirm the window rendered, summarize counts ("12 nodes: 5 competitors, 4 suppliers, 3
   customers; 3 high-confidence, …"). Don't paste raw JSON.

### Gathering recipe — the "what resources are required" answer (hybrid + confidence)

| Edge type | Grounded sources | Confidence mapping |
|---|---|---|
| **Competitors** | yfinance `info` sector/industry (peer candidates) · sec-edgar 10-K **Item 1 "Competition"** · 1 WebSearch · Claude knowledge | 10-K-named or well-known → high; web → medium; inferred-from-industry → low |
| **Customers** | sec-edgar **customer-concentration disclosures** (>10%-of-revenue customers must be named in 10-K) · web · knowledge | disclosed-10K → high; web/known → medium; inferred → low |
| **Suppliers** | sec-edgar 10-K **Item 1 / risk factors** (key suppliers) · web · knowledge | disclosed-10K → high; well-known (e.g. TSMC↔Apple) → high; web → medium; inferred → low |

`source_tag` records the provenance verbatim; `confidence` is the rolled-up trust level the renderer
styles on. Keep the sub-agent lean (target ~6–10 tool calls): the bundle from `assay.mjs data` (the
`/research` slim bundle, which already carries `sector`/`industry`/`business`) covers the cheap inputs;
MCP/web fill the relationship gaps. Cap breadth sensibly (e.g. ≤8 per relation) so the graph stays
legible.

**Foreign/ADR & thin-data names:** if 10-K data is absent (20-F filers, small caps), lean on web +
knowledge and tag accordingly — never fabricate a `disclosed-10K`. Low-confidence is fine and
expected; the renderer dims it rather than hiding it.

## Renderer (`src/renderer/`, React Flow + d3-force)

A new VC root (mounted when `SurfaceInit.kind === 'value-chain'`), fetching `getValueChain(seed)` on
init and subscribing to pushes (same `onPanel`-style subscription, new `onValueChain` event).

- **Layout:** **d3-force** computes positions (seed pinned at center, radial distribution); **React
  Flow** renders HTML/Tailwind node cards with built-in pan / zoom / drag / click. (React Flow is a
  focused graph lib, not a kitchen-sink component library — consistent with the "Tailwind only, no
  component libraries" rule, and CLAUDE.md already anticipated it.)
- **Node card:** name + ticker badge (public) + one-line description. `kind` styles the card
  (public = solid, segment = pill/dashed outline). Seed node visually emphasized.
- **Edge visual language:**
  - **Color = relation** — supplier (e.g. sky), customer (emerald), competitor (amber).
  - **Arrowhead = direction** — supplier→focus, focus→customer; competitor undirected.
  - **Line style = confidence** — high = solid/full opacity, medium = solid/dimmed, low = dashed/most
    dimmed. A small legend explains it.
- **Interaction:**
  - Click a node → **detail drawer**: full description, every incident edge's `relation` +
    `rationale` + `confidence`/`source_tag`. Public nodes show their ticker and a hint: *"Run
    `/research TICKER` for full financials."* (App can't invoke Claude; it surfaces the command.)
  - `expandable` node → **expand affordance** reveals its stored neighbors (pure client state over the
    already-fetched component). Non-expandable public node → *"Run `/value-chain TICKER` to expand."*
- **Empty / loading:** no generation yet → centered hint to run the skill; while a push is in flight,
  the existing cached graph stays on screen (no blank flash).

Tailwind only; reuse `SubHead`/tone/`Metric` patterns where they fit the drawer.

## Testing

- **`src/main/database/valueChain.test.ts`** (vitest, in-memory better-sqlite3) — the merge logic is
  the risk surface:
  - **Dedup:** pushing two seeds that both cite `TSMC` (ticker) yields **one** entity; a private node
    `"Foxconn"` then `"Foxconn"` (same normalized name) dedups; differing case/whitespace dedups.
  - **Provenance replace:** regenerating seed A deletes only A's edges; a node shared with seed B keeps
    B's edges. A node solely from A's old generation is orphan-swept; a node that is itself a seed
    (`vc_generations` row) survives.
  - **Description merge:** a non-empty incoming description updates a blank one; a blank incoming push
    does **not** clobber an existing description; `kind: public` is never downgraded.
  - **`getGraph` shape:** 1-hop visibility + `expandable` flag set exactly for nodes with a generation;
    reachable component returned; cycle (A↔B as customer/supplier) doesn't infinite-loop.
- **Skill** is exercised by a live `/value-chain AAPL` click-through (like `/research`), not unit tests.

## Build order (one spec, sequenced)

1. **Migration v4 + `valueChain.ts` + tests** (no UI needed; prove the merge in isolation).
2. **Types + IPC + control endpoint + `assay.mjs` commands** (push a hand-written `graph.json`, verify
   it lands in the DB and `getValueChain` returns it).
3. **VC window kind + renderer** (React Flow + d3-force) against the seeded DB.
4. **`/value-chain` skill** (freshness gate → sub-agent gather → push), then live click-through.

Each step is independently verifiable (`npm run lint`; `npm run dev` for the UI step).

## Out of scope (intentional — deferred or never)

- **Live app→Claude expansion channel** (clicking expands by *generating* a neighbor live). Drill-down
  is reveal-from-store + manual re-run of the skill. The biggest deferred complexity.
- **Auto-pivot to `/research`** on node click — user explicitly prefers to fire it manually.
- **Live price/stats overlays** on public nodes — Claude supplies all graph data; no app-side fetch in
  v1.
- **ETF-specific value chains** (holdings/issuers as a different graph) — later.
- **User-editable graphs** (drag-to-add, manual edges), graph search/filter UI, multi-seed "merge two
  maps" affordances — v-next polish.
- **Confidence-threshold filtering control** — v1 dims low confidence but shows everything.
