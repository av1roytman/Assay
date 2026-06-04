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
