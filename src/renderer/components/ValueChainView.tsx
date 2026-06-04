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
