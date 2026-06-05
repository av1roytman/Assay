# Value-Chain — Shared-Ecosystem View — Design Spec

**Date:** 2026-06-05
**Status:** Approved (pending spec review)
**Roadmap item:** v3 — value-chain map polish (follow-up to the shipped node graph)

> Follow-up to the shipped value-chain map ([2026-06-03-value-chain-map-design.md](2026-06-03-value-chain-map-design.md)).
> That spec described a radial d3-force layout; the shipped renderer is **columnar**
> (`vcLayout.ts` — suppliers left, seed at column 0, customers right; competitors in a
> top strip). This spec builds on the **as-shipped columnar** renderer.

## Motivation

Competitors in the same industry tend to **share suppliers and customers** — Micron, Samsung,
and SK Hynix all buy from ASML/Applied Materials and sell into the same server/handset OEMs. That
overlap is a real signal (supplier concentration, customer-bargaining-power, where moats actually
sit), and the current map hides it: direct competitors are pulled out of the canvas into a
**chip strip** and *all* competitor nodes/edges are stripped from the flow subgraph
(`ValueChainView.tsx`, `flow` memo). So a supplier shared between the seed and a competitor renders
as connected to the seed alone — the shared structure is invisible.

The user wants that shared structure **to be part of the graph**, without cluttering the everyday
seed-centric view.

## What ships

A **"Shared ecosystem"** toggle in the graph toolbar.

- **Off (default):** today's behavior, unchanged — seed-centric supplier/customer flow on the
  canvas, direct competitors in the top strip.
- **On:** the seed's direct competitors move **onto the canvas** as peer nodes alongside the seed;
  any supplier/customer shared across peers draws edges to **every** peer that uses it; shared nodes
  carry an **"N peers" badge** so the overlap is what the eye catches. The competitor strip hides
  while the toggle is on.

Peers whose own chains haven't been gathered render as lone peer nodes with an affordance to gather
them on demand (see *Data*). This is a **renderer + skill** change, plus one **additive, read-only
field** on the existing `vc` open response (the seed's direct competitors and whether each already
has a stored chain) — **no DB, migration, or gather-contract changes.**

## The key constraint (and why "on-demand" looks the way it does)

**The app cannot invoke Claude.** That is a locked architecture decision (`CLAUDE.md`: "No AI in the
app — Claude is the external brain; the app renders"). A peer's supplier/customer data can only be
produced by a gather pass triggered *through Claude*, never by an in-app button that secretly runs an
agent. So "expand a peer" resolves to:

- A peer that **already has a gathered chain** (its own `vc_generations` row → `expandable: true`)
  shows its shared links immediately — no new work.
- A peer with **no chain yet** renders as a lone node with a clear affordance:
  *"No chain yet → `/value-chain <TICKER>`."* Running that one line merges via the existing
  per-seed accretion (`upsertGraph`), and the shared links light up.
- To keep that from feeling like busywork, the **skill** gains an offer: after rendering the seed,
  the main agent notes which direct competitors lack a chain and offers *"3 competitors have no chain
  yet — want me to gather Samsung, SK Hynix, WDC so the shared-ecosystem view fills in?"* On *yes* it
  runs those passes. The human-in-Claude loop the architecture requires stays intact; the user gets
  the peer web from one confirmation.

## Division of labor

| Concern | Owner |
|---|---|
| Toggle state, peer-on-canvas rendering, shared-node detection + badge, visibility rules | **App** (renderer) |
| Gathering a peer's supplier/customer chain (only when asked) | **Claude** (existing `/value-chain` skill, run on the peer) |
| Offering to gather un-gathered direct competitors | **Claude** (skill orchestration step) |
| Entity dedup / edge provenance / freshness | **App** (unchanged — existing `valueChain.ts`) |

No new relationship logic in the app; no new storage logic in Claude. The shared-edge *data* already
exists in the store whenever ≥2 peers have been gathered — dedup collapses a shared supplier to one
entity today. This work only changes **what the renderer draws** and adds a **skill convenience**.

## Renderer design (`src/renderer/components/ValueChainView.tsx`)

### New state

- `showShared: boolean` — toolbar toggle, default `false`. Lives alongside `relFilter`. Not
  persisted (session-local, like `relFilter`/`expanded`).

### Conditional `flow` subgraph

Today `flow` always removes competitor nodes and every competitor edge. Make it toggle-aware:

- **`showShared === false`** → unchanged (competitors stripped; seed-centric flow).
- **`showShared === true`** →
  - **nodes:** include the seed's direct competitors (the current `competitorIds` set) in the flow
    node set instead of excluding them.
  - **supplier/customer edges:** keep **all** of them among included nodes (today they survive only
    if both endpoints are non-competitor; now competitor endpoints are allowed) — this is what makes
    a peer's gathered supplier/customer edges renderable.
  - **competitor edges:** still excluded from the **column flow** (they don't belong on the
    supplier→customer axis), but retained separately to draw **faint seed↔peer connectors** so
    peerness is legible (subject to the existing `competitor` relation filter).

### Layout — reuse the columnar engine as-is

`computeColumnLayout` already (a) lays suppliers at negative columns / customers at positive via
signed BFS, and (b) parks any node *not reached by supplier/customer edges* in the seed's column 0
(`vcLayout.ts:58-60`). Direct competitors are exactly such nodes (they reach the seed only via
competitor edges, which the layout ignores), so they **naturally stack in column 0 next to the
seed** with no layout-engine change. A shared supplier dedups to one entity at column −1 with edges
fanning to multiple column-0 peers — the desired web falls out of the existing model.

*If* competitor stacking in column 0 proves visually cramped during the UI step, the only tweak is a
small vertical-offset for competitor-kind nodes within column 0; no algorithmic change. Treat that
as an implementation-time visual nicety, not a design requirement.

### Visibility rules (`visNodeList` / `visEdgeList`)

When `showShared` is on, seed the visible set with the seed **and its direct competitors**, then run
the existing hub-expansion BFS over supplier/customer edges. Net effect:

- Seed's suppliers/customers show (today).
- Direct competitors show (new).
- Each competitor's suppliers/customers show when that competitor's chain exists **and** the shared
  nodes connect back — shared nodes appear because they're 1-hop from the seed *or* a visible peer.
- Deeper drill-down stays gated behind the existing per-node **expand** hub affordance, so the
  default peer web is "seed + peers + their immediate suppliers/customers," not the whole component.

### Shared-node detection + badge

A pure helper over the visible graph:

```
peerCount(node) = | { p ∈ {seed} ∪ directCompetitors : p has a supplier/customer edge to node } |
```

- A supplier/customer node with `peerCount(node) ≥ 2` is **shared**; render a small **"N peers"**
  badge on its card (N = `peerCount`).
- Only meaningful while `showShared` is on (off-mode has no peers on canvas). Compute in a `useMemo`
  keyed on the visible graph; no storage, no new types.

### Strip + toolbar

- The **`CompetitorStrip`** renders only when `showShared` is **off** (competitors are on-canvas when
  on — avoids showing them in both places).
- The **toolbar** gains a "Shared ecosystem" toggle button styled like the existing relation-filter
  pills. The existing `competitor` relation filter continues to govern the faint seed↔peer
  connectors when the toggle is on.

### "No chain yet" affordance

For an on-canvas peer with `expandable === false` (no `vc_generations` row), surface the gather
command. Reuse the existing pattern: the node **Detail** drawer already prints
*"Run `/value-chain TICKER` to expand"* for non-expandable public nodes — extend that hint to read as
the gather affordance, and add a subtle inline marker on the peer card (e.g. a muted "no chain"
tag) so the user can tell at a glance which peers are gathered vs not without opening the drawer.

## Skill design (`.claude/skills/value-chain/SKILL.md`)

Add one orchestration step after the existing push/relay (step 6):

7. **Offer to gather un-gathered peers.** After the push, re-read status with
   `assay.mjs vc <TICKER>`, whose response is **extended** (additively) to include the seed's direct
   competitors with an `expandable` flag — `true` = that competitor already has its own stored chain.
   The handler already computes `getGraph(seed)` to return `nodeCount`, so the competitor sublist is
   derived from data it already has (direct competitors of the seed, each node's `expandable`). Offer
   to gather the ones with `expandable === false`: *"N competitors have no value chain yet — want me
   to gather <names> so the Shared-ecosystem view fills in?"* On confirmation, run a normal
   gather+push pass for each (same sub-agent recipe, one per peer); each merges via accretion and the
   open VC window re-renders. **Do not** auto-gather — it's opt-in (cost + the user steers which
   peers matter).

The only plumbing change is the additive `competitors` array on the `vc` command's JSON response
(and the matching field on the underlying IPC/handler). No change to the per-seed gather sub-agent
prompt, the `POST /value-chain` push contract, or the DB.

## Testing

- **Renderer** is exercised by a live `npm run dev` click-through (consistent with how the rest of
  the VC UI is verified — no renderer unit tests exist today):
  - Toggle off → identical to current (competitors in strip, seed flow on canvas).
  - Toggle on → seed's competitors appear on canvas in column 0; strip hides.
  - With ≥2 peers gathered (seed it by running `/value-chain` on a competitor first), a shared
    supplier renders as **one** node with edges to multiple peers and an **"N peers"** badge.
  - An un-gathered peer shows the "no chain → `/value-chain TICKER`" affordance.
  - Relation filters and per-node expand still behave.
- **`peerCount` helper** is pure and the natural unit-test target if any test is added — but given no
  renderer test harness exists, the live click-through is the gate. (Flag in the plan whether to
  stand up a minimal vitest for the helper; not required by this spec.)
- No `valueChain.test.ts` changes — the DB layer is untouched.

## Build order

1. **Toggle + conditional `flow` + strip gating** — competitors appear on canvas when on, strip
   hides; verify with an already-multi-seeded DB (`npm run dev`).
2. **`peerCount` helper + "N peers" badge** — shared nodes visibly flagged.
3. **"No chain yet" peer affordance** (card marker + drawer hint).
4. **Additive `competitors` field on `vc` response** (handler/IPC/`assay.mjs`) + **skill step 7** —
   offer to gather un-gathered competitors; live click-through end-to-end.

Each step is independently verifiable (`npm run lint`; `npm run dev` for the UI steps).

## Out of scope (intentional)

- **In-app gather button that auto-invokes Claude** — architecturally disallowed (no AI in the app);
  "expand a peer" is a Claude-run `/value-chain <peer>` (with the skill offering to do it).
- **Auto-gathering all competitors on a seed run** — considered and rejected during brainstorming in
  favor of on-demand (cost + user steering). The seed gather pass is unchanged.
- **Indirect/transitive peers** (competitors-of-competitors) on the canvas — only the seed's direct
  competitors become peers; deeper structure stays behind manual expand.
- **Persisting the toggle / a "shared by N" filter control** — session-local toggle only in v1.
- **Emphasis beyond the badge** (heatmap of shared-ness, weighting edges by overlap) — later polish.
