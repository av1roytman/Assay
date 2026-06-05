import type { VcNode, VcEdge } from '../../shared/types'

export interface Placed {
  x: number
  y: number
}

// Layout constants — React Flow coordinate units.
const COL_GAP = 300 // horizontal distance between adjacent flow columns
const ROW_GAP = 104 // vertical distance between stacked cards within a column

/**
 * Deterministic column layout for the value-chain flow.
 *
 * Supplier and customer edges are both stored `source → target` with the SOURCE
 * upstream (supplier→focus, focus→customer per the edge-direction convention),
 * so the whole non-competitor graph reads as a single left→right flow. We BFS
 * out from the seed assigning each node a signed column index: stepping
 * source→target moves one column right (+1, toward customers), target→source
 * moves one column left (−1, toward suppliers). First assignment wins, so a
 * cycle (A↔B across accreted seeds) terminates and stays stable across runs.
 *
 * Competitors are NOT laid out here — they render in a separate chip strip — so
 * the caller passes only the supplier/customer subgraph it wants on the canvas.
 */
export function computeColumnLayout(
  seedId: number,
  nodes: VcNode[],
  edges: VcEdge[]
): Map<number, Placed> {
  const ids = new Set(nodes.map((n) => n.id))

  // Signed adjacency: from `a`, reaching `b` shifts the column by `delta`.
  const adj = new Map<number, { other: number; delta: number }[]>()
  const link = (a: number, b: number, delta: number): void => {
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a)!.push({ other: b, delta })
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    link(e.source, e.target, +1) // downstream — one column right
    link(e.target, e.source, -1) // upstream — one column left
  }

  // BFS from the seed; shortest-path-first keeps columns stable.
  const col = new Map<number, number>()
  col.set(seedId, 0)
  const queue: number[] = [seedId]
  while (queue.length) {
    const cur = queue.shift()!
    const base = col.get(cur)!
    for (const { other, delta } of adj.get(cur) ?? []) {
      if (col.has(other)) continue
      col.set(other, base + delta)
      queue.push(other)
    }
  }
  // Anything the flow didn't reach (e.g. a node connected only via a dropped
  // competitor edge) parks in the seed column so it stays visible.
  for (const n of nodes) if (!col.has(n.id)) col.set(n.id, 0)

  // Group by column, then stack vertically centered on the seed's row. The seed
  // sorts to the top of its own column; everything else sorts by name so the
  // order is stable run to run.
  const byCol = new Map<number, VcNode[]>()
  for (const n of nodes) {
    const c = col.get(n.id)!
    if (!byCol.has(c)) byCol.set(c, [])
    byCol.get(c)!.push(n)
  }

  const pos = new Map<number, Placed>()
  for (const [c, group] of byCol) {
    group.sort((a, b) => {
      if (a.id === seedId) return -1
      if (b.id === seedId) return 1
      return a.name.localeCompare(b.name)
    })
    const k = group.length
    group.forEach((n, i) => {
      pos.set(n.id, { x: c * COL_GAP, y: (i - (k - 1) / 2) * ROW_GAP })
    })
  }
  return pos
}

/**
 * Count, for each supplier/customer node, how many distinct peers (the seed plus
 * its direct competitors) connect to it via a supplier/customer edge. A count ≥2
 * means the node is genuinely shared across the competitive set — the signal the
 * "N peers" badge surfaces. Competitor edges are ignored; peer nodes themselves
 * are never counted as shared targets.
 */
export function computePeerCounts(peerIds: Set<number>, edges: VcEdge[]): Map<number, number> {
  const peersByNode = new Map<number, Set<number>>()
  const add = (node: number, peer: number): void => {
    if (!peersByNode.has(node)) peersByNode.set(node, new Set())
    peersByNode.get(node)!.add(peer)
  }
  for (const e of edges) {
    if (e.relation === 'competitor') continue
    const sPeer = peerIds.has(e.source)
    const tPeer = peerIds.has(e.target)
    if (sPeer && !tPeer) add(e.target, e.source)
    else if (tPeer && !sPeer) add(e.source, e.target)
  }
  const counts = new Map<number, number>()
  for (const [node, peers] of peersByNode) counts.set(node, peers.size)
  return counts
}
