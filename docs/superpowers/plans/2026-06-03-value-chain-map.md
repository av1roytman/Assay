# Value-Chain Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `/value-chain TICKER` feature — a dedicated radial-graph window showing a company's competitors/suppliers/customers, where per-seed graphs are stored and merge on shared entities into an accreting map.

**Architecture:** Claude gathers relationships (hybrid sources + confidence tags) and POSTs a structured graph to the localhost control server; the main process dedups entities, stores edges with seed provenance (new SQLite tables, migration v4), and forwards to a dedicated VC window; the renderer draws it with React Flow + d3-force. A 30-day freshness cache skips regeneration. Drill-down reveals stored neighbors; you go deeper by generating another company's chain.

**Tech Stack:** Electron + Vite + React + TypeScript + Tailwind; better-sqlite3; React Flow (`reactflow@^11`) + `d3-force`; vitest for the DB-layer tests.

**Spec:** `docs/superpowers/specs/2026-06-03-value-chain-map-design.md`

---

## File Structure

**Create:**
- `src/main/database/valueChain.ts` — pure DB layer: `upsertGraph(db, payload)`, `getGraph(db, seed)`, `normalizeName(name)`. All dedup/merge/provenance logic.
- `src/main/database/valueChain.test.ts` — vitest unit tests over an in-memory DB.
- `src/renderer/components/ValueChainView.tsx` — the VC window root (fetch + subscribe + state + React Flow + drawer + legend).
- `src/renderer/components/vcLayout.ts` — pure d3-force layout → node positions.
- `.claude/skills/value-chain/SKILL.md` — the `/value-chain` orchestration.

**Modify:**
- `src/shared/types.ts` — add `Vc*` types, `SurfaceInit`, extend `AssayApi`.
- `src/main/database/migrations.ts` — add migration v4.
- `src/main/server/controlServer.ts` — add `/value-chain-open` + `/value-chain` endpoints + callbacks.
- `src/main/windows.ts` — `openValueChainWindow`, `pushValueChain`; tag research init with `kind`.
- `src/main/index.ts` — wire the two new callbacks.
- `src/main/ipc/handlers.ts` — `valuechain:get` handler.
- `src/preload/index.ts` — `getValueChain` + `onValueChain`; `onInit` now `SurfaceInit`.
- `src/renderer/App.tsx` — branch on `init.kind` to mount `ValueChainView` vs `Dashboard`.
- `scripts/assay.mjs` — `vc <T>` and `value-chain <T> --data` commands.
- `CLAUDE.md` — check off the roadmap item; `.claude/skills/research/SKILL.md` "still coming" note.

---

## Task 1: Graph types + migration v4 + DB layer (tested)

The merge/dedup logic is the risk surface, so it's built first, in isolation, TDD. `valueChain.ts` takes a `Database` instance as a parameter (no `getDb()` import) so it's testable in plain Node without Electron.

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/database/migrations.ts`
- Create: `src/main/database/valueChain.ts`
- Test: `src/main/database/valueChain.test.ts`

- [ ] **Step 1: Add the graph types to `src/shared/types.ts`**

Append at the end of the file, *before* the `AssayApi` interface (these types don't touch `AssayApi`, so `tsc` stays green):

```ts
// ── Value-chain map (Claude-pushed graph, app-stored & rendered) ─────────────

export type VcKind = 'public' | 'private' | 'segment'
export type VcRelation = 'supplier' | 'customer' | 'competitor'
export type VcConfidence = 'high' | 'medium' | 'low'
export type VcSource = 'disclosed-10K' | 'well-known' | 'web' | 'inferred'

// What Claude pushes (no ids — the app assigns/dedups them).
export interface VcEntityIn {
  name: string
  ticker?: string // US-listed public cos; enables dedup + clickability
  kind: VcKind
  description?: string // one-line "what they do"
  aliases?: string[]
}
export interface VcEdgeIn {
  source: string // ticker if public, else name — must match an entity in the same push
  target: string
  relation: VcRelation
  confidence: VcConfidence
  source_tag: VcSource
  rationale?: string // one-line "how they're related"
}
export interface VcPushPayload {
  seed: string // ticker of the focus company
  entities: VcEntityIn[]
  edges: VcEdgeIn[]
  generatedAt: number // epoch ms
}

// What the renderer reads back (ids assigned, expandable computed).
export interface VcNode {
  id: number
  name: string
  ticker?: string
  kind: VcKind
  description?: string
  expandable: boolean // has its own stored generation
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

- [ ] **Step 2: Add migration v4 to `src/main/database/migrations.ts`**

Add this object to the end of the `migrations` array (after the `version: 3` entry — note the leading comma):

```ts
  ,{
    version: 4,
    name: 'value-chain-graph',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS vc_entities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          ticker TEXT UNIQUE,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          aliases TEXT,
          description TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS vc_entities_norm
          ON vc_entities(normalized_name) WHERE ticker IS NULL;
        CREATE TABLE IF NOT EXISTS vc_edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id INTEGER NOT NULL REFERENCES vc_entities(id),
          target_id INTEGER NOT NULL REFERENCES vc_entities(id),
          relation TEXT NOT NULL,
          confidence TEXT NOT NULL,
          source_tag TEXT NOT NULL,
          rationale TEXT,
          seed_ticker TEXT NOT NULL,
          generated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS vc_edges_seed ON vc_edges(seed_ticker);
        CREATE INDEX IF NOT EXISTS vc_edges_source ON vc_edges(source_id);
        CREATE INDEX IF NOT EXISTS vc_edges_target ON vc_edges(target_id);
        CREATE TABLE IF NOT EXISTS vc_generations (
          seed_ticker TEXT PRIMARY KEY,
          generated_at INTEGER NOT NULL,
          note TEXT
        );
      `)
    }
  }
```

- [ ] **Step 3: Write the failing tests in `src/main/database/valueChain.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrations } from './migrations'
import { upsertGraph, getGraph, normalizeName } from './valueChain'
import type { VcPushPayload } from '../../shared/types'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrations.find((m) => m.version === 4)!.up(db)
  return db
}

// AAPL seed: 1 competitor (public MSFT), 1 supplier (public TSM), 1 customer (segment).
const AAPL: VcPushPayload = {
  seed: 'AAPL',
  generatedAt: 1_000,
  entities: [
    { name: 'Apple', ticker: 'AAPL', kind: 'public', description: 'Consumer electronics' },
    { name: 'Microsoft', ticker: 'MSFT', kind: 'public', description: 'Software' },
    { name: 'Taiwan Semiconductor', ticker: 'TSM', kind: 'public', description: 'Foundry' },
    { name: 'Consumers', kind: 'segment', description: 'End buyers' }
  ],
  edges: [
    { source: 'TSM', target: 'AAPL', relation: 'supplier', confidence: 'high', source_tag: 'well-known', rationale: 'Fabs A-series chips' },
    { source: 'AAPL', target: 'Consumers', relation: 'customer', confidence: 'high', source_tag: 'well-known' },
    { source: 'AAPL', target: 'MSFT', relation: 'competitor', confidence: 'medium', source_tag: 'web' }
  ]
}

let db: Database.Database
beforeEach(() => {
  db = freshDb()
})

describe('normalizeName', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeName('  Hon   Hai  ')).toBe('hon hai')
  })
})

describe('upsertGraph + getGraph', () => {
  it('stores a seed graph and returns its reachable component', () => {
    upsertGraph(db, AAPL)
    const g = getGraph(db, 'AAPL')
    expect(g.lastGeneratedAt).toBe(1_000)
    expect(g.nodes).toHaveLength(4)
    expect(g.edges).toHaveLength(3)
    const apple = g.nodes.find((n) => n.ticker === 'AAPL')!
    expect(apple.expandable).toBe(true) // AAPL is itself a seed
    const msft = g.nodes.find((n) => n.ticker === 'MSFT')!
    expect(msft.expandable).toBe(false) // MSFT has no generation yet
  })

  it('dedups public entities by ticker across two seeds', () => {
    upsertGraph(db, AAPL)
    // MSFT seed that also cites TSM (same ticker) — must reuse, not duplicate.
    upsertGraph(db, {
      seed: 'MSFT',
      generatedAt: 2_000,
      entities: [
        { name: 'Microsoft', ticker: 'MSFT', kind: 'public', description: 'Software' },
        { name: 'Taiwan Semiconductor', ticker: 'TSM', kind: 'public' }
      ],
      edges: [
        { source: 'TSM', target: 'MSFT', relation: 'supplier', confidence: 'medium', source_tag: 'inferred' }
      ]
    })
    const tsmCount = db.prepare("SELECT COUNT(*) c FROM vc_entities WHERE ticker='TSM'").get() as { c: number }
    expect(tsmCount.c).toBe(1)
    // From MSFT's window, TSM and AAPL are both reachable (TSM bridges them).
    const g = getGraph(db, 'MSFT')
    expect(g.nodes.map((n) => n.ticker)).toContain('AAPL')
  })

  it('dedups non-public entities by normalized name', () => {
    upsertGraph(db, {
      seed: 'X', generatedAt: 1,
      entities: [{ name: 'X', ticker: 'X', kind: 'public' }, { name: 'Foxconn', kind: 'private' }],
      edges: [{ source: 'X', target: 'Foxconn', relation: 'supplier', confidence: 'low', source_tag: 'inferred' }]
    })
    upsertGraph(db, {
      seed: 'Y', generatedAt: 2,
      entities: [{ name: 'Y', ticker: 'Y', kind: 'public' }, { name: '  foxconn ', kind: 'private' }],
      edges: [{ source: 'Y', target: '  foxconn ', relation: 'supplier', confidence: 'low', source_tag: 'inferred' }]
    })
    const c = db.prepare('SELECT COUNT(*) c FROM vc_entities WHERE ticker IS NULL').get() as { c: number }
    expect(c.c).toBe(1)
  })

  it('regenerating a seed replaces only its own edges', () => {
    upsertGraph(db, AAPL)
    // Re-run AAPL with a different competitor; old AAPL→MSFT edge must be gone.
    upsertGraph(db, {
      seed: 'AAPL', generatedAt: 3_000,
      entities: [
        { name: 'Apple', ticker: 'AAPL', kind: 'public' },
        { name: 'Alphabet', ticker: 'GOOGL', kind: 'public', description: 'Search' }
      ],
      edges: [{ source: 'AAPL', target: 'GOOGL', relation: 'competitor', confidence: 'high', source_tag: 'well-known' }]
    })
    const g = getGraph(db, 'AAPL')
    expect(g.edges).toHaveLength(1)
    expect(g.nodes.some((n) => n.ticker === 'GOOGL')).toBe(true)
    expect(g.nodes.some((n) => n.ticker === 'MSFT')).toBe(false) // orphan-swept
  })

  it('keeps a node that is itself a seed even if it loses all edges', () => {
    upsertGraph(db, AAPL)
    upsertGraph(db, { seed: 'MSFT', generatedAt: 2_000, entities: [{ name: 'Microsoft', ticker: 'MSFT', kind: 'public' }], edges: [] })
    // Now regenerate AAPL with no MSFT edge.
    upsertGraph(db, { seed: 'AAPL', generatedAt: 3_000, entities: [{ name: 'Apple', ticker: 'AAPL', kind: 'public' }], edges: [] })
    const msft = db.prepare("SELECT id FROM vc_entities WHERE ticker='MSFT'").get()
    expect(msft).toBeTruthy() // survives: it has a vc_generations row
  })

  it('a blank incoming description does not clobber an existing one; public kind is not downgraded', () => {
    upsertGraph(db, AAPL)
    upsertGraph(db, {
      seed: 'MSFT', generatedAt: 2_000,
      entities: [
        { name: 'Microsoft', ticker: 'MSFT', kind: 'public' },
        { name: 'Apple', ticker: 'AAPL', kind: 'private' } // blank desc, wrong kind
      ],
      edges: [{ source: 'MSFT', target: 'AAPL', relation: 'competitor', confidence: 'high', source_tag: 'well-known' }]
    })
    const apple = db.prepare("SELECT kind, description FROM vc_entities WHERE ticker='AAPL'").get() as { kind: string; description: string }
    expect(apple.kind).toBe('public') // not downgraded
    expect(apple.description).toBe('Consumer electronics') // not clobbered
  })

  it('does not infinite-loop on a cycle and returns empty for an unknown seed', () => {
    upsertGraph(db, AAPL) // TSM→AAPL→Consumers already forms a chain
    expect(() => getGraph(db, 'AAPL')).not.toThrow()
    const none = getGraph(db, 'NOPE')
    expect(none.nodes).toHaveLength(0)
    expect(none.lastGeneratedAt).toBeNull()
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test -- valueChain`
Expected: FAIL — `Cannot find module './valueChain'` (file not created yet).

- [ ] **Step 5: Implement `src/main/database/valueChain.ts`**

```ts
import type Database from 'better-sqlite3'
import type {
  VcPushPayload,
  VcEntityIn,
  VcGraph,
  VcNode,
  VcEdge,
  VcKind,
  VcRelation,
  VcConfidence,
  VcSource
} from '../../shared/types'

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

interface EntityRow {
  id: number
  kind: string
  ticker: string | null
  name: string
  description: string | null
}

// Insert or merge one entity, returning its id. Public cos key on ticker;
// others on normalized name. Non-empty incoming fields update; blanks never
// clobber; kind 'public' is never downgraded.
function resolveEntity(db: Database.Database, e: VcEntityIn): number {
  const now = Date.now()
  const norm = normalizeName(e.name)
  const ticker = e.ticker ? e.ticker.toUpperCase() : null
  const existing = (
    ticker
      ? db.prepare('SELECT id, kind, ticker, name, description FROM vc_entities WHERE ticker = ?').get(ticker)
      : db
          .prepare('SELECT id, kind, ticker, name, description FROM vc_entities WHERE ticker IS NULL AND normalized_name = ?')
          .get(norm)
  ) as EntityRow | undefined

  if (existing) {
    const kind = existing.kind === 'public' ? 'public' : e.kind
    const name = e.name.trim() ? e.name.trim() : existing.name
    const description = e.description?.trim() ? e.description.trim() : existing.description
    const aliases = e.aliases?.length ? JSON.stringify(e.aliases) : undefined
    db.prepare(
      `UPDATE vc_entities SET kind = ?, name = ?, normalized_name = ?, description = ?,
         aliases = COALESCE(?, aliases), updated_at = ? WHERE id = ?`
    ).run(kind, name, normalizeName(name), description ?? null, aliases ?? null, now, existing.id)
    return existing.id
  }

  const info = db
    .prepare(
      `INSERT INTO vc_entities (kind, ticker, name, normalized_name, aliases, description, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      e.kind,
      ticker,
      e.name.trim(),
      norm,
      e.aliases?.length ? JSON.stringify(e.aliases) : null,
      e.description?.trim() || null,
      now
    )
  return Number(info.lastInsertRowid)
}

// Merge one seed's graph into the store: dedup entities, replace this seed's
// edges (provenance), record the generation, sweep orphans. One transaction.
export function upsertGraph(db: Database.Database, payload: VcPushPayload): void {
  const seed = payload.seed.toUpperCase()
  const tx = db.transaction(() => {
    const idByTicker = new Map<string, number>()
    const idByName = new Map<string, number>()
    for (const e of payload.entities) {
      const id = resolveEntity(db, e)
      if (e.ticker) idByTicker.set(e.ticker.toUpperCase(), id)
      idByName.set(normalizeName(e.name), id)
    }
    const resolve = (ref: string): number | undefined =>
      idByTicker.get(ref.toUpperCase()) ?? idByName.get(normalizeName(ref))

    db.prepare('DELETE FROM vc_edges WHERE seed_ticker = ?').run(seed)
    const ins = db.prepare(
      `INSERT INTO vc_edges
         (source_id, target_id, relation, confidence, source_tag, rationale, seed_ticker, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const edge of payload.edges) {
      const s = resolve(edge.source)
      const t = resolve(edge.target)
      if (s == null || t == null || s === t) continue // skip unresolved / self loops
      ins.run(s, t, edge.relation, edge.confidence, edge.source_tag, edge.rationale ?? null, seed, payload.generatedAt)
    }

    db.prepare(
      `INSERT INTO vc_generations (seed_ticker, generated_at, note) VALUES (?, ?, NULL)
       ON CONFLICT(seed_ticker) DO UPDATE SET generated_at = excluded.generated_at`
    ).run(seed, payload.generatedAt)

    // Orphan sweep: drop entities with no edges that aren't themselves a seed.
    db.prepare(
      `DELETE FROM vc_entities
       WHERE id NOT IN (SELECT source_id FROM vc_edges UNION SELECT target_id FROM vc_edges)
         AND (ticker IS NULL OR ticker NOT IN (SELECT seed_ticker FROM vc_generations))`
    ).run()
  })
  tx()
}

interface RawEdge {
  source_id: number
  target_id: number
  relation: VcRelation
  confidence: VcConfidence
  source_tag: VcSource
  rationale: string | null
}

// Return the connected component reachable from the seed (undirected BFS over
// edges), with each node flagged `expandable` if it has its own generation.
export function getGraph(db: Database.Database, seedRaw: string): VcGraph {
  const seed = seedRaw.toUpperCase()
  const gen = db.prepare('SELECT generated_at FROM vc_generations WHERE seed_ticker = ?').get(seed) as
    | { generated_at: number }
    | undefined
  const lastGeneratedAt = gen?.generated_at ?? null

  const seedRow = db.prepare('SELECT id FROM vc_entities WHERE ticker = ?').get(seed) as { id: number } | undefined
  if (!seedRow) return { seed, nodes: [], edges: [], lastGeneratedAt }

  const allEdges = db
    .prepare('SELECT source_id, target_id, relation, confidence, source_tag, rationale FROM vc_edges')
    .all() as RawEdge[]

  const adj = new Map<number, Set<number>>()
  const link = (a: number, b: number): void => {
    if (!adj.has(a)) adj.set(a, new Set())
    adj.get(a)!.add(b)
  }
  for (const e of allEdges) {
    link(e.source_id, e.target_id)
    link(e.target_id, e.source_id)
  }

  const seen = new Set<number>([seedRow.id])
  const queue = [seedRow.id]
  while (queue.length) {
    const cur = queue.shift()!
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n)
        queue.push(n)
      }
    }
  }

  const seeds = new Set(
    (db.prepare('SELECT seed_ticker FROM vc_generations').all() as { seed_ticker: string }[]).map((r) => r.seed_ticker)
  )

  const nodeStmt = db.prepare('SELECT id, kind, ticker, name, description FROM vc_entities WHERE id = ?')
  const nodes: VcNode[] = [...seen].map((id) => {
    const r = nodeStmt.get(id) as { id: number; kind: string; ticker: string | null; name: string; description: string | null }
    return {
      id: r.id,
      name: r.name,
      ticker: r.ticker ?? undefined,
      kind: r.kind as VcKind,
      description: r.description ?? undefined,
      expandable: !!r.ticker && seeds.has(r.ticker)
    }
  })

  // Edges within the component, deduped by (source,target,relation).
  const byKey = new Map<string, VcEdge>()
  for (const e of allEdges) {
    if (!seen.has(e.source_id) || !seen.has(e.target_id)) continue
    const key = `${e.source_id}-${e.target_id}-${e.relation}`
    if (!byKey.has(key)) {
      byKey.set(key, {
        source: e.source_id,
        target: e.target_id,
        relation: e.relation,
        confidence: e.confidence,
        source_tag: e.source_tag,
        rationale: e.rationale ?? undefined
      })
    }
  }

  return { seed, nodes, edges: [...byKey.values()], lastGeneratedAt }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- valueChain`
Expected: PASS — all tests in `valueChain.test.ts` green.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/main/database/migrations.ts src/main/database/valueChain.ts src/main/database/valueChain.test.ts
git commit -m "feat(value-chain): graph types, migration v4, and tested DB merge layer"
```

---

## Task 2: Wiring — control endpoints, windows, IPC, preload, CLI

End-to-end plumbing so a hand-written graph JSON pushed via `assay.mjs` lands in the DB and a window can read it back. No renderer yet. Every commit keeps `tsc` green, so the type additions to `AssayApi`/`SurfaceInit` land here alongside their implementations.

**Files:**
- Modify: `src/shared/types.ts`, `src/main/server/controlServer.ts`, `src/main/windows.ts`, `src/main/index.ts`, `src/main/ipc/handlers.ts`, `src/preload/index.ts`, `scripts/assay.mjs`

- [ ] **Step 1: Add `SurfaceInit` and extend `AssayApi` in `src/shared/types.ts`**

Replace the existing `ResearchInit` interface:

```ts
export interface ResearchInit {
  ticker: string
}
```

with:

```ts
// Tells a freshly-loaded window which surface it is and which ticker it owns.
export interface SurfaceInit {
  kind: 'research' | 'value-chain'
  ticker: string
}
```

Then in the `AssayApi` interface, change the `onInit` signature and add the two VC methods. Find:

```ts
  // Subscribe to "this window is for ticker X". Returns an unsubscribe fn.
  onInit(cb: (init: ResearchInit) => void): () => void
```

Replace with:

```ts
  // Subscribe to "this window is surface S for ticker X". Returns an unsubscribe fn.
  onInit(cb: (init: SurfaceInit) => void): () => void
  // Read the stored value-chain graph reachable from a seed ticker.
  getValueChain(seed: string): Promise<VcGraph | null>
  // Subscribe to value-chain graph pushes. Returns an unsubscribe fn.
  onValueChain(cb: (graph: VcGraph) => void): () => void
```

- [ ] **Step 2: Add the VC endpoints + callbacks to `src/main/server/controlServer.ts`**

Replace the import line `import type { PushPanel } from '../../shared/types'` with:

```ts
import type { PushPanel, VcPushPayload } from '../../shared/types'
```

Extend `ControlCallbacks`:

```ts
export interface ControlCallbacks {
  onResearch: (ticker: string) => void
  onPanel: (panel: PushPanel) => boolean
  onData: (ticker: string) => Promise<unknown>
  // Open/focus the VC window for a ticker and report its current freshness.
  onValueChainOpen: (ticker: string) => { lastGeneratedAt: number | null; nodeCount: number }
  // Merge a pushed graph into the store and forward it to the window.
  onValueChainPush: (payload: VcPushPayload) => boolean
}
```

Add these two route blocks inside `handle`, just before the final `send(res, 404, …)`:

```ts
  if (url === '/value-chain-open') {
    const ticker = String(payload.ticker ?? '').trim().toUpperCase()
    if (!ticker) {
      send(res, 400, { ok: false, error: 'ticker required' })
      return
    }
    const { lastGeneratedAt, nodeCount } = cb.onValueChainOpen(ticker)
    send(res, 200, { ok: true, ticker, lastGeneratedAt, nodeCount })
    return
  }

  if (url === '/value-chain') {
    const seed = String(payload.seed ?? '').trim().toUpperCase()
    const entities = payload.entities
    const edges = payload.edges
    if (!seed || !Array.isArray(entities) || !Array.isArray(edges)) {
      send(res, 400, { ok: false, error: 'seed, entities[], edges[] required' })
      return
    }
    const delivered = cb.onValueChainPush({
      seed,
      entities,
      edges,
      generatedAt: typeof payload.generatedAt === 'number' ? payload.generatedAt : Date.now()
    } as VcPushPayload)
    send(res, 200, { ok: true, delivered })
    return
  }
```

- [ ] **Step 3: Add VC window + push to `src/main/windows.ts`**

Replace the import line `import type { PushPanel } from '../shared/types'` with:

```ts
import type { PushPanel, VcGraph, SurfaceInit } from '../shared/types'
```

In `openResearchWindow`, tag both init sends with `kind: 'research'`. Change the existing line inside the `existing` branch:

```ts
    existing.webContents.send('research:init', { ticker: key })
```
to:
```ts
    existing.webContents.send('research:init', { kind: 'research', ticker: key } satisfies SurfaceInit)
```
and the line inside the `did-finish-load` handler:
```ts
      win.webContents.send('research:init', { ticker: key })
```
to:
```ts
      win.webContents.send('research:init', { kind: 'research', ticker: key } satisfies SurfaceInit)
```

Append these two functions at the end of the file:

```ts
// VC windows live in a separate key namespace ('VC:<TICKER>') so they don't
// collide with the research window for the same ticker.
export function openValueChainWindow(ticker: string): void {
  const key = `VC:${ticker.toUpperCase()}`
  const display = ticker.toUpperCase()
  const existing = windows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    existing.webContents.send('research:init', { kind: 'value-chain', ticker: display } satisfies SurfaceInit)
    return
  }
  const win = new BrowserWindow({ ...baseOptions(), title: `Assay — ${display} value chain` })
  windows.set(key, win)
  win.on('closed', () => windows.delete(key))
  win.on('ready-to-show', () => win.show())
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('research:init', { kind: 'value-chain', ticker: display } satisfies SurfaceInit)
  })
  loadInto(win)
}

export function pushValueChain(seed: string, graph: VcGraph): boolean {
  const win = windows.get(`VC:${seed.toUpperCase()}`)
  if (!win || win.isDestroyed()) return false
  win.webContents.send('value-chain:update', graph)
  return true
}
```

- [ ] **Step 4: Wire the callbacks in `src/main/index.ts`**

Replace the `./windows` import line with:

```ts
import { createHomeWindow, openResearchWindow, pushPanel, openValueChainWindow, pushValueChain } from './windows'
```

Fold `getDb` into the existing connection import — change `import { initDatabase, closeDatabase } from './database/connection'` to:

```ts
import { initDatabase, closeDatabase, getDb } from './database/connection'
```

And add the value-chain DB import (after the existing `./database/panels` import):

```ts
import { upsertGraph, getGraph } from './database/valueChain'
```

Add these two callbacks to the `startControlServer({ … })` object, after `onData`:

```ts
      onValueChainOpen: (ticker) => {
        openValueChainWindow(ticker)
        const g = getGraph(getDb(), ticker)
        return { lastGeneratedAt: g.lastGeneratedAt, nodeCount: g.nodes.length }
      },
      onValueChainPush: (payload) => {
        upsertGraph(getDb(), payload)
        return pushValueChain(payload.seed, getGraph(getDb(), payload.seed))
      }
```

- [ ] **Step 5: Add the IPC handler in `src/main/ipc/handlers.ts`**

Add these two imports:

```ts
import { getGraph } from '../database/valueChain'
import { getDb } from '../database/connection'
```

Add the handler inside `registerIpc` (after the `panels:get` line):

```ts
  ipcMain.handle('valuechain:get', (_e, seed: string) => getGraph(getDb(), seed))
```

- [ ] **Step 6: Update the preload bridge `src/preload/index.ts`**

Replace `ResearchInit` with `SurfaceInit` and add `VcGraph` in the type import block:

```ts
import type {
  AssayApi,
  StockQuote,
  DailyBar,
  IntradayBar,
  Fundamentals,
  Scorecards,
  ValuationData,
  HistoryEntry,
  PushPanel,
  SurfaceInit,
  VcGraph
} from '../shared/types'
```

Change `onInit` to use `SurfaceInit`:

```ts
  onInit: (cb: (init: SurfaceInit) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, init: SurfaceInit): void => cb(init)
    ipcRenderer.on('research:init', handler)
    return () => ipcRenderer.removeListener('research:init', handler)
  },
```

Add the two VC methods to the `api` object. The current `onPanel` is the last property (no trailing comma); change its closing to add the new methods:

```ts
  onPanel: (cb: (panel: PushPanel) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, panel: PushPanel): void => cb(panel)
    ipcRenderer.on('panel:update', handler)
    return () => ipcRenderer.removeListener('panel:update', handler)
  },
  getValueChain: (seed: string): Promise<VcGraph | null> =>
    ipcRenderer.invoke('valuechain:get', seed),
  onValueChain: (cb: (graph: VcGraph) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, graph: VcGraph): void => cb(graph)
    ipcRenderer.on('value-chain:update', handler)
    return () => ipcRenderer.removeListener('value-chain:update', handler)
  }
```

- [ ] **Step 7: Add the `vc` and `value-chain` commands to `scripts/assay.mjs`**

Insert these two `else if` branches before the final `else` (the usage fallback):

```js
} else if (cmd === 'vc') {
  const ticker = rest[0]
  if (!ticker) {
    console.error('usage: vc <TICKER>   (open/focus the value-chain window + report freshness)')
    process.exit(1)
  }
  console.log(await post('/value-chain-open', { ticker }))
} else if (cmd === 'value-chain') {
  const ticker = rest[0]
  const dataFile = flag('--data')
  if (!ticker || !dataFile) {
    console.error('usage: value-chain <TICKER> --data <file.json>   (file: { entities[], edges[] })')
    process.exit(1)
  }
  const { entities, edges } = JSON.parse(readFileSync(dataFile, 'utf8'))
  console.log(await post('/value-chain', { seed: ticker, entities, edges, generatedAt: Date.now() }))
```

Also update the usage string in the final `else`:

```js
  console.error('commands: health | ensure | research <T> | data <T> | panel <T> <type> | vc <T> | value-chain <T> --data f.json')
```

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 9: Manual end-to-end check (DB round-trip)**

Create a scratch file `scripts/.tmp-aapl-vc.json`:

```json
{
  "entities": [
    { "name": "Apple", "ticker": "AAPL", "kind": "public", "description": "Consumer electronics" },
    { "name": "Taiwan Semiconductor", "ticker": "TSM", "kind": "public", "description": "Chip foundry" },
    { "name": "Microsoft", "ticker": "MSFT", "kind": "public", "description": "Software & cloud" },
    { "name": "Consumers", "kind": "segment", "description": "Global end buyers" }
  ],
  "edges": [
    { "source": "TSM", "target": "AAPL", "relation": "supplier", "confidence": "high", "source_tag": "well-known", "rationale": "Fabricates Apple silicon" },
    { "source": "AAPL", "target": "Consumers", "relation": "customer", "confidence": "high", "source_tag": "well-known" },
    { "source": "AAPL", "target": "MSFT", "relation": "competitor", "confidence": "medium", "source_tag": "web" }
  ]
}
```

In one terminal run `npm run dev` (leave it running). In another:

```
node scripts/assay.mjs vc AAPL
node scripts/assay.mjs value-chain AAPL --data scripts/.tmp-aapl-vc.json
node scripts/assay.mjs vc AAPL
```

Expected: first `vc` prints `{"ok":true,"ticker":"AAPL","lastGeneratedAt":null,"nodeCount":0}` and opens a blank window. The push prints `{"ok":true,"delivered":true}`. The second `vc` prints a recent `lastGeneratedAt` and `"nodeCount":4`. Delete the scratch file afterward: `Remove-Item scripts/.tmp-aapl-vc.json`.

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/main/server/controlServer.ts src/main/windows.ts src/main/index.ts src/main/ipc/handlers.ts src/preload/index.ts scripts/assay.mjs
git commit -m "feat(value-chain): control endpoints, VC window, IPC bridge, and CLI commands"
```

---

## Task 3: Renderer — radial graph window (React Flow + d3-force)

The VC window root. Branches off `App.tsx` on `init.kind`. Pure layout in `vcLayout.ts`; rendering, drawer, legend, and expand/collapse in `ValueChainView.tsx`.

**Files:**
- Create: `src/renderer/components/vcLayout.ts`, `src/renderer/components/ValueChainView.tsx`
- Modify: `src/renderer/App.tsx`
- Add deps: `reactflow`, `d3-force`, `@types/d3-force`

- [ ] **Step 1: Install the graph deps**

⚠ **TLS gotcha (this machine — see CLAUDE.md):** installs must run with `NODE_OPTIONS=--use-system-ca` because AVG intercepts HTTPS. In PowerShell:

```powershell
$env:NODE_OPTIONS="--use-system-ca"; npm install reactflow d3-force; $env:NODE_OPTIONS=""
$env:NODE_OPTIONS="--use-system-ca"; npm install -D @types/d3-force; $env:NODE_OPTIONS=""
```

Expected: `reactflow`, `d3-force` added to `dependencies`; `@types/d3-force` to `devDependencies`. **Never** carry that env var into `npm run dev`/`build`.

- [ ] **Step 2: Implement the pure layout `src/renderer/components/vcLayout.ts`**

```ts
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum
} from 'd3-force'
import type { VcGraph } from '../../shared/types'

interface SimNode extends SimulationNodeDatum {
  id: number
  fx?: number
  fy?: number
}

// Deterministic force layout: the seed is pinned at the origin, neighbors settle
// around it. d3-force uses a fixed phyllotaxis seed (no RNG), so a fixed tick
// count gives stable positions across runs.
export function computeLayout(graph: VcGraph, seedId: number): Map<number, { x: number; y: number }> {
  const nodes: SimNode[] = graph.nodes.map((n) => ({
    id: n.id,
    ...(n.id === seedId ? { fx: 0, fy: 0 } : {})
  }))
  const links = graph.edges.map((e) => ({ source: e.source, target: e.target }))

  const sim = forceSimulation(nodes)
    .force('charge', forceManyBody().strength(-800))
    .force(
      'link',
      forceLink(links)
        .id((d) => (d as SimNode).id)
        .distance(180)
    )
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide(100))
    .stop()

  for (let i = 0; i < 300; i++) sim.tick()

  const pos = new Map<number, { x: number; y: number }>()
  for (const n of nodes) pos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 })
  return pos
}
```

- [ ] **Step 3: Implement `src/renderer/components/ValueChainView.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  MarkerType
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { VcGraph, VcNode, VcEdge, VcRelation, VcConfidence } from '../../shared/types'
import { computeLayout } from './vcLayout'

const RELATION_COLOR: Record<VcRelation, string> = {
  supplier: '#38bdf8', // sky
  customer: '#34d399', // emerald
  competitor: '#fbbf24' // amber
}
const CONFIDENCE_OPACITY: Record<VcConfidence, number> = { high: 1, medium: 0.65, low: 0.35 }

// ── Custom node (Tailwind card) ──────────────────────────────────────────────

interface NodeData {
  node: VcNode
  isSeed: boolean
  collapsed: boolean
  onToggle: (id: number) => void
  onSelect: (id: number) => void
}

function VcCard({ data }: NodeProps<NodeData>): JSX.Element {
  const { node, isSeed, collapsed, onToggle, onSelect } = data
  const ring = isSeed ? 'ring-2 ring-emerald-400' : 'ring-1 ring-zinc-700'
  const border = node.kind === 'segment' ? 'border-dashed' : 'border-solid'
  return (
    <div
      onClick={() => onSelect(node.id)}
      className={`w-44 cursor-pointer rounded-lg border ${border} border-zinc-700 bg-zinc-900/90 px-3 py-2 ${ring}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-zinc-600" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-600" />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-semibold text-zinc-100">{node.name}</span>
        {node.ticker && (
          <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
            {node.ticker}
          </span>
        )}
      </div>
      {node.description && (
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-500">{node.description}</div>
      )}
      {node.expandable && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggle(node.id)
          }}
          className="mt-1 text-[10px] font-medium text-emerald-400 hover:underline"
        >
          {collapsed ? '＋ expand' : '－ collapse'}
        </button>
      )}
    </div>
  )
}

const nodeTypes = { vc: VcCard }

// ── View ─────────────────────────────────────────────────────────────────────

export function ValueChainView({ seed }: { seed: string }): JSX.Element {
  const [graph, setGraph] = useState<VcGraph | null | undefined>(undefined)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    setGraph(undefined)
    void window.api.getValueChain(seed).then(setGraph)
  }, [seed])

  useEffect(
    () => window.api.onValueChain((g) => g.seed.toUpperCase() === seed.toUpperCase() && setGraph(g)),
    [seed]
  )

  const seedId = useMemo(
    () => graph?.nodes.find((n) => n.ticker === seed.toUpperCase())?.id ?? null,
    [graph, seed]
  )

  const toggle = useCallback((id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Visible set: the seed's neighbors are always shown; any expandable hub that
  // is itself visible and not collapsed reveals its neighbors too.
  const { visNodes, visEdges } = useMemo(() => {
    if (!graph || seedId == null) return { visNodes: [] as VcNode[], visEdges: [] as VcEdge[] }
    const adj = new Map<number, VcEdge[]>()
    for (const e of graph.edges) {
      if (!adj.has(e.source)) adj.set(e.source, [])
      if (!adj.has(e.target)) adj.set(e.target, [])
      adj.get(e.source)!.push(e)
      adj.get(e.target)!.push(e)
    }
    const visible = new Set<number>([seedId])
    // Expand the seed first, then any expanded hub that became visible (one pass
    // is enough for the shallow maps we render; re-runs as `collapsed` changes).
    const expandFrom = (id: number): void => {
      for (const e of adj.get(id) ?? []) {
        visible.add(e.source)
        visible.add(e.target)
      }
    }
    expandFrom(seedId)
    for (const n of graph.nodes) {
      if (n.expandable && !collapsed.has(n.id) && visible.has(n.id)) expandFrom(n.id)
    }
    const visNodes = graph.nodes.filter((n) => visible.has(n.id))
    const visEdges = graph.edges.filter((e) => visible.has(e.source) && visible.has(e.target))
    return { visNodes, visEdges }
  }, [graph, seedId, collapsed])

  const flowNodes: Node<NodeData>[] = useMemo(() => {
    if (seedId == null) return []
    const sub: VcGraph = { seed, nodes: visNodes, edges: visEdges, lastGeneratedAt: graph?.lastGeneratedAt ?? null }
    const pos = computeLayout(sub, seedId)
    return visNodes.map((n) => ({
      id: String(n.id),
      type: 'vc',
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data: { node: n, isSeed: n.id === seedId, collapsed: collapsed.has(n.id), onToggle: toggle, onSelect: setSelected }
    }))
  }, [visNodes, visEdges, seedId, seed, graph, collapsed, toggle])

  const flowEdges: Edge[] = useMemo(
    () =>
      visEdges.map((e, i) => ({
        id: `e${i}`,
        source: String(e.source),
        target: String(e.target),
        style: {
          stroke: RELATION_COLOR[e.relation],
          strokeWidth: 1.5,
          opacity: CONFIDENCE_OPACITY[e.confidence],
          strokeDasharray: e.confidence === 'low' ? '4 4' : undefined
        },
        markerEnd:
          e.relation === 'competitor'
            ? undefined
            : { type: MarkerType.ArrowClosed, color: RELATION_COLOR[e.relation] }
      })),
    [visEdges]
  )

  if (graph === undefined) return <Centered>Loading…</Centered>
  if (graph === null || graph.nodes.length === 0)
    return (
      <Centered>
        No value chain yet. Run{' '}
        <code className="mx-1 rounded bg-zinc-800 px-1.5 py-0.5">/value-chain {seed}</code> to generate one.
      </Centered>
    )

  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null

  return (
    <div className="relative h-full w-full bg-zinc-950">
      <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} fitView minZoom={0.2} maxZoom={1.5}>
        <Background color="#27272a" gap={24} />
        <Controls className="!bg-zinc-800 !text-zinc-200" />
      </ReactFlow>
      <Legend />
      {selectedNode && <Detail node={selectedNode} graph={graph} onClose={() => setSelected(null)} />}
    </div>
  )
}

function Legend(): JSX.Element {
  return (
    <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-zinc-800 bg-zinc-900/90 p-2 text-[10px] text-zinc-400">
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4" style={{ background: RELATION_COLOR.supplier }} /> supplier →
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4" style={{ background: RELATION_COLOR.customer }} /> → customer
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4" style={{ background: RELATION_COLOR.competitor }} /> competitor
      </div>
      <div className="mt-1 border-t border-zinc-800 pt-1">solid = high · dim = medium · dashed = low</div>
    </div>
  )
}

function Detail({
  node,
  graph,
  onClose
}: {
  node: VcNode
  graph: VcGraph
  onClose: () => void
}): JSX.Element {
  const incident = graph.edges.filter((e) => e.source === node.id || e.target === node.id)
  const nameOf = (id: number): string => graph.nodes.find((n) => n.id === id)?.name ?? '?'
  return (
    <div className="absolute right-3 top-3 w-72 rounded-lg border border-zinc-800 bg-zinc-900/95 p-4 text-zinc-200 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{node.name}</div>
          {node.ticker && <div className="text-[11px] text-zinc-500">{node.ticker}</div>}
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
          ✕
        </button>
      </div>
      {node.description && <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">{node.description}</p>}
      <div className="mt-3 space-y-2">
        {incident.map((e, i) => (
          <div key={i} className="text-[12px]">
            <span style={{ color: RELATION_COLOR[e.relation] }} className="font-medium">
              {e.relation}
            </span>{' '}
            <span className="text-zinc-400">
              {e.source === node.id ? `→ ${nameOf(e.target)}` : `← ${nameOf(e.source)}`}
            </span>
            <span className="ml-1 text-[10px] text-zinc-600">
              ({e.confidence} · {e.source_tag})
            </span>
            {e.rationale && <div className="text-[11px] text-zinc-500">{e.rationale}</div>}
          </div>
        ))}
      </div>
      {node.ticker && (
        <div className="mt-3 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          Run <code className="rounded bg-zinc-800 px-1 py-0.5">/research {node.ticker}</code> for full financials
          {!node.expandable && (
            <>
              , or <code className="rounded bg-zinc-800 px-1 py-0.5">/value-chain {node.ticker}</code> to expand
            </>
          )}
          .
        </div>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center text-sm text-zinc-500">{children}</div>
  )
}
```

- [ ] **Step 4: Branch on surface kind in `src/renderer/App.tsx`**

Add the imports near the top (with the other component/type imports):

```tsx
import { ValueChainView } from './components/ValueChainView'
import type { SurfaceInit } from '../shared/types'
```

Replace the top-level `App` component body:

```tsx
export default function App(): JSX.Element {
  const [ticker, setTicker] = useState<string | null>(null)

  useEffect(() => window.api.onInit((init) => setTicker(init.ticker)), [])

  return ticker ? <Dashboard ticker={ticker} /> : <Home />
}
```

with:

```tsx
export default function App(): JSX.Element {
  const [init, setInit] = useState<SurfaceInit | null>(null)

  useEffect(() => window.api.onInit(setInit), [])

  if (!init) return <Home />
  return init.kind === 'value-chain' ? (
    <ValueChainView seed={init.ticker} />
  ) : (
    <Dashboard ticker={init.ticker} />
  )
}
```

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors. (If `tsc` complains that `SurfaceInit` is imported but only used as a type, it's fine — it is used as the `useState` generic.)

- [ ] **Step 6: Manual visual check**

With `npm run dev` running and the Task 2 scratch push already in the DB (re-push if needed), run `node scripts/assay.mjs vc AAPL`. Expected: a window opens showing AAPL at center, TSM (sky arrow into AAPL), Consumers (emerald arrow out of AAPL), MSFT (amber, no arrowhead, dimmed for medium confidence). Clicking a node opens the detail drawer (right); the legend shows top-left. Pan/zoom/drag works.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/renderer/components/vcLayout.ts src/renderer/components/ValueChainView.tsx src/renderer/App.tsx
git commit -m "feat(value-chain): radial graph window (React Flow + d3-force) with detail drawer"
```

---

## Task 4: The `/value-chain` skill + docs

The orchestration that ties it together: freshness gate → Sonnet sub-agent gathers → main Opus agent resolves & pushes.

**Files:**
- Create: `.claude/skills/value-chain/SKILL.md`
- Modify: `CLAUDE.md`, `.claude/skills/research/SKILL.md`

- [ ] **Step 1: Write `.claude/skills/value-chain/SKILL.md`**

````markdown
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
   node scripts/assay.mjs ensure
   node scripts/assay.mjs vc <TICKER>
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
   node scripts/assay.mjs value-chain <TICKER> --data <temp.json>
   ```
   where `<temp.json>` is `{ "entities": [...], "edges": [...] }`. Delete the temp file after. It
   returns `{ "ok": true, "delivered": true }`.
6. **Relay:** confirm the window rendered and summarize counts (e.g. "12 nodes: 5 competitors, 4
   suppliers, 3 customers; 6 high-confidence"). Don't paste raw JSON.

## Sub-agent prompt (substitute `<TICKER>`)

> You are gathering value-chain relationships for **`<TICKER>`**. Return structured candidates to the
> caller — do NOT push anything yourself. Work efficiently: ~6–10 tool calls.
>
> **1. Cheap context first:** `node scripts/assay.mjs data <TICKER>`
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
````

- [ ] **Step 2: Update the roadmap in `CLAUDE.md`**

In the **v3** section, change:

```
- [ ] Value-chain **node graph** (graph lib, e.g. React Flow) — Claude supplies entities/edges
```

to:

```
- [x] Value-chain **node graph** — standalone `/value-chain` skill + dedicated radial-graph window (React Flow + d3-force); Claude pushes entities/edges (hybrid sources + confidence), app dedups/persists (migration v4: `vc_entities`/`vc_edges`/`vc_generations`) & renders an accreting cross-company map; 30-day freshness cache. See [spec](docs/superpowers/specs/2026-06-03-value-chain-map-design.md)
```

- [ ] **Step 3: Update the "still coming" note in `.claude/skills/research/SKILL.md`**

Change the Notes line:

```
- Panels live now: `sec-summary`, `recommendation`, `news`, `risks` (plus the app-owned chart, key stats, and scorecards). Still coming: value chain and peers.
```

to:

```
- Panels live now: `sec-summary`, `recommendation`, `news`, `risks` (plus the app-owned chart, key stats, and scorecards). The value chain is its own `/value-chain` skill + window. Still coming: peers.
```

- [ ] **Step 4: Lint (sanity — docs/skills don't compile, but confirm nothing else regressed)**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/value-chain/SKILL.md CLAUDE.md .claude/skills/research/SKILL.md
git commit -m "feat(value-chain): /value-chain skill + roadmap/docs updates"
```

- [ ] **Step 6: Live click-through (whole feature)**

With `npm run dev` running, in Claude Code run `/value-chain AAPL`. Expected: window opens, sub-agent gathers, you push, the radial graph paints with confidence-styled edges and clickable nodes. Re-run `/value-chain AAPL` immediately → it should report the cached graph (<30 days) and skip regeneration. Run `/value-chain MSFT` → its graph merges (shared nodes like TSM dedup; MSFT's window shows AAPL reachable if they share an entity).

---

## Self-Review notes (already reconciled)

- **Spec coverage:** migration v4 + three tables (Task 1); dedup/provenance/orphan-sweep + `getGraph` component/expandable (Task 1, tested); `/value-chain-open` + `/value-chain` endpoints, VC window namespace, IPC, CLI (Task 2); React Flow + d3-force radial render, edge visual language, detail drawer, expand/collapse, `/research`-hint (Task 3); skill with freshness gate + hybrid gathering recipe + sub-agent pattern (Task 4). Out-of-scope items (live expansion channel, auto-pivot, price overlays, ETF chains, editing) are not implemented, as intended.
- **Type consistency:** `VcPushPayload`/`VcEntityIn`/`VcEdgeIn` (Claude→app) vs `VcGraph`/`VcNode`/`VcEdge` (app→renderer) used consistently across DB layer, server, preload, and renderer. `SurfaceInit { kind, ticker }` replaces `ResearchInit` in types + preload + App. Channels: `research:init` (now carries `kind`), `value-chain:update`, IPC `valuechain:get`.
- **Known simplification:** `getGraph` returns the full reachable component; 1-hop default visibility + expand/collapse is pure renderer state (`collapsed` set), matching the spec's "renderer decides what's visible."
- **`ResearchInit` removal:** the type is deleted in Task 2 Step 1; the only references were `src/preload/index.ts` and `src/renderer/App.tsx`, both updated in this plan (Task 2 Step 6, Task 3 Step 4). No other file imports it.
```