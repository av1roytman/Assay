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
