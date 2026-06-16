import { describe, it, expect, beforeEach } from 'vitest'
// Node-ABI alias of better-sqlite3 (see package.json devDependencies): the main
// copy is electron-rebuilt to Electron's ABI, which vitest under system Node
// can't load. Types are shimmed in better-sqlite3-node.d.ts.
import Database from 'better-sqlite3-node'
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
