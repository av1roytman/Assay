import { describe, it, expect } from 'vitest'
import { computeColumnLayout } from './vcLayout'
import type { VcNode, VcEdge } from '../../shared/types'

// Minimal node/edge factories — the layout only reads id, name (for sort) and
// the edge endpoints; relation/confidence aren't used (direction comes from
// source→target order).
const node = (id: number, name = `n${id}`): VcNode => ({
  id,
  name,
  kind: 'public',
  expandable: false
})
const edge = (source: number, target: number): VcEdge => ({
  source,
  target,
  relation: 'supplier',
  confidence: 'high',
  source_tag: 'web'
})

describe('computeColumnLayout', () => {
  it('places suppliers left, customers right, seed centered at origin', () => {
    // supplier A → seed S → customer B
    const nodes = [node(1, 'Seed'), node(2, 'Supplier'), node(3, 'Customer')]
    const edges = [edge(2, 1) /* A→S supplier */, edge(1, 3) /* S→B customer */]
    const pos = computeColumnLayout(1, nodes, edges)

    expect(pos.get(1)).toEqual({ x: 0, y: 0 })
    expect(pos.get(2)!.x).toBeLessThan(0) // supplier left
    expect(pos.get(3)!.x).toBeGreaterThan(0) // customer right
  })

  it('lays multi-hop suppliers further left by one column each', () => {
    // C → B → S : C supplies B supplies seed
    const nodes = [node(1, 'Seed'), node(2, 'B'), node(3, 'C')]
    const edges = [edge(2, 1), edge(3, 2)]
    const pos = computeColumnLayout(1, nodes, edges)

    expect(pos.get(1)!.x).toBe(0)
    expect(pos.get(2)!.x).toBeLessThan(0)
    expect(pos.get(3)!.x).toBeLessThan(pos.get(2)!.x) // one column further left
  })

  it('stacks same-column nodes vertically without overlap, centered', () => {
    // two suppliers of the seed share a column
    const nodes = [node(1, 'Seed'), node(2, 'Aaa'), node(3, 'Bbb')]
    const edges = [edge(2, 1), edge(3, 1)]
    const pos = computeColumnLayout(1, nodes, edges)

    expect(pos.get(2)!.x).toBe(pos.get(3)!.x) // same column
    expect(pos.get(2)!.y).not.toBe(pos.get(3)!.y) // different rows
    // symmetric around the column's vertical center
    expect(pos.get(2)!.y).toBe(-pos.get(3)!.y)
  })

  it('terminates on a cycle (A supplies B and B supplies A)', () => {
    const nodes = [node(1, 'Seed'), node(2, 'A'), node(3, 'B')]
    const edges = [edge(2, 1) /* A→S */, edge(1, 3) /* S→B */, edge(3, 2) /* B→A back-edge */]
    const pos = computeColumnLayout(1, nodes, edges)

    // Every node gets a stable position; no infinite loop.
    expect(pos.size).toBe(3)
    for (const n of nodes) expect(pos.has(n.id)).toBe(true)
  })

  it('parks flow-disconnected nodes in the seed column', () => {
    const nodes = [node(1, 'Seed'), node(2, 'Orphan')]
    const pos = computeColumnLayout(1, nodes, []) // no edges
    expect(pos.get(2)!.x).toBe(0)
  })
})
