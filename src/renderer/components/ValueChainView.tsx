import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type ReactFlowInstance
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { VcGraph, VcNode, VcEdge, VcRelation, VcConfidence } from '../../shared/types'
import { computeColumnLayout, computePeerCounts } from './vcLayout'

const RELATION_COLOR: Record<VcRelation, string> = {
  supplier: '#38bdf8', // sky
  customer: '#34d399', // emerald
  competitor: '#fbbf24' // amber
}
// Seed node gets a neutral near-white outline so it reads as the focus, distinct
// from the supplier/customer/competitor role colors above.
const SEED_COLOR = '#fafafa'
// Confidence drives both stroke weight and opacity so high-trust edges read as
// solid + bold and low-trust ones as faint + dashed.
const EDGE_WIDTH: Record<VcConfidence, number> = { high: 2.4, medium: 1.6, low: 1 }
const EDGE_OPACITY: Record<VcConfidence, number> = { high: 1, medium: 0.7, low: 0.45 }

// ── Custom node (Tailwind card) ──────────────────────────────────────────────

type HubState = 'none' | 'collapsed' | 'expanded'

interface NodeData {
  node: VcNode
  isSeed: boolean
  isSelected: boolean
  hub: HubState
  roleColor?: string // node outline/hue by relation to seed (seed/supplier/customer/competitor)
  peerCount?: number // # of peers (seed + competitors) sharing this supplier/customer (shared view)
  isUngatheredPeer?: boolean // a competitor peer with no stored chain yet
  onToggle: (id: number) => void
}

function VcCard({ data }: NodeProps<NodeData>): JSX.Element {
  const { node, isSelected, hub, roleColor, peerCount, isUngatheredPeer, onToggle } = data
  const border = node.kind === 'segment' ? 'border-dashed' : 'border-solid'
  const shared = peerCount != null && peerCount >= 2
  return (
    <div
      className={`w-44 rounded-lg border-2 ${border} bg-zinc-900/95 px-3 py-2 ${isSelected ? 'ring-2 ring-zinc-100' : ''}`}
      style={{
        borderColor: roleColor ?? '#3f3f46',
        boxShadow: roleColor ? `inset 0 0 16px -8px ${roleColor}` : undefined
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-zinc-600" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-600" />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-semibold text-zinc-100">{node.name}</span>
        <div className="flex shrink-0 items-center gap-1">
          {shared && (
            <span
              className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
              title={`Shared by ${peerCount} peers`}
            >
              {peerCount} peers
            </span>
          )}
          {node.ticker && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
              {node.ticker}
            </span>
          )}
        </div>
      </div>
      {node.description && (
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-500">{node.description}</div>
      )}
      {isUngatheredPeer && (
        <div
          className="mt-1 text-[10px] font-medium text-zinc-500"
          title={`Run /value-chain ${node.ticker} to map this peer's chain`}
        >
          no chain yet · /value-chain {node.ticker}
        </div>
      )}
      {hub !== 'none' && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggle(node.id)
          }}
          className="mt-1 text-[10px] font-medium text-emerald-400 hover:underline"
        >
          {hub === 'collapsed' ? '＋ expand' : '－ collapse'}
        </button>
      )}
    </div>
  )
}

// ── Custom edge (confidence styling + hover/pinned rationale) ─────────────────

interface EdgeData {
  relation: VcRelation
  confidence: VcConfidence
  rationale?: string
  pinned: boolean
  onTogglePin: (id: string) => void
}

function VcRelEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data
}: EdgeProps<EdgeData>): JSX.Element | null {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  })
  const [hovered, setHovered] = useState(false)
  if (!data) return null
  const color = RELATION_COLOR[data.relation]
  const showLabel = Boolean(data.rationale) && (hovered || data.pinned)
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: EDGE_WIDTH[data.confidence],
          opacity: EDGE_OPACITY[data.confidence],
          strokeDasharray: data.confidence === 'low' ? '5 4' : undefined
        }}
      />
      {/* Wide transparent hit path — a 1–2px line is nearly unclickable. Hover
          previews the rationale; click pins it so it stays while you read. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: data.rationale ? 'pointer' : 'default' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => data.rationale && data.onTogglePin(id)}
      />
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan max-w-[200px] rounded-md border bg-zinc-900/95 px-2 py-1 text-[10px] leading-snug text-zinc-200 shadow-lg"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderColor: color,
              pointerEvents: 'all'
            }}
          >
            {data.rationale}
            {data.pinned && (
              <button
                onClick={() => data.onTogglePin(id)}
                className="ml-1.5 text-zinc-500 hover:text-zinc-200"
                title="Unpin"
              >
                ✕
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const nodeTypes = { vc: VcCard }
const edgeTypes = { vc: VcRelEdge }

// ── View ─────────────────────────────────────────────────────────────────────

type RelationFilter = Record<VcRelation, boolean>

export function ValueChainView({ seed }: { seed: string }): JSX.Element {
  const [graph, setGraph] = useState<VcGraph | null | undefined>(undefined)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<number | null>(null)
  const [relFilter, setRelFilter] = useState<RelationFilter>({
    supplier: true,
    customer: true,
    competitor: true
  })
  // Shared-ecosystem view: pull the seed's direct competitors onto the canvas as
  // peers so any supplier/customer they share with the seed renders as one
  // fan-out node (with an "N peers" badge). Off by default — keeps the everyday
  // seed-centric view uncluttered.
  const [showShared, setShowShared] = useState(false)
  // User drag positions, layered on top of the auto column layout. Survives
  // collapse/expand and filter changes; "Reset layout" clears it.
  const [userPos, setUserPos] = useState<Map<number, { x: number; y: number }>>(new Map())
  const [pinnedEdges, setPinnedEdges] = useState<Set<string>>(new Set())

  useEffect(() => {
    setGraph(undefined)
    setExpanded(new Set())
    setSelected(null)
    setUserPos(new Map())
    setPinnedEdges(new Set())
    setShowShared(false)
    void window.api
      .getValueChain(seed)
      .then(setGraph)
      .catch(() => setGraph(null))
  }, [seed])

  useEffect(
    () => window.api.onValueChain((g) => g.seed.toUpperCase() === seed.toUpperCase() && setGraph(g)),
    [seed]
  )

  const seedId = useMemo(
    () =>
      graph?.nodes.find(
        (n) => n.ticker === seed.toUpperCase() || n.name.toUpperCase() === seed.toUpperCase()
      )?.id ?? null,
    [graph, seed]
  )

  // Direct competitors of the seed are pulled out of the canvas into the strip.
  // Competitor takes precedence: such a node never also appears as a column tile.
  const competitorIds = useMemo(() => {
    const s = new Set<number>()
    if (!graph || seedId == null) return s
    for (const e of graph.edges) {
      if (e.relation !== 'competitor') continue
      if (e.source === seedId) s.add(e.target)
      else if (e.target === seedId) s.add(e.source)
    }
    return s
  }, [graph, seedId])

  // The supplier/customer subgraph that the column layout draws (competitors removed).
  const flow = useMemo(() => {
    if (!graph) return { nodes: [] as VcNode[], edges: [] as VcEdge[] }
    // Shared view keeps competitors on the canvas; the default view strips them
    // (they live in the top strip). Either way the column flow carries only
    // supplier/customer edges — competitor edges never belong on the
    // supplier→customer axis (they'd skew the column BFS).
    const nodes = showShared ? graph.nodes : graph.nodes.filter((n) => !competitorIds.has(n.id))
    const keep = new Set(nodes.map((n) => n.id))
    const edges = graph.edges.filter(
      (e) => e.relation !== 'competitor' && keep.has(e.source) && keep.has(e.target)
    )
    return { nodes, edges }
  }, [graph, competitorIds, showShared])

  // Visible set: seed + its 1-hop neighbors (subject to relation filters); any
  // expanded hub that is itself visible reveals its own neighbors too.
  const { visNodeList, visEdgeList } = useMemo(() => {
    if (seedId == null) return { visNodeList: [] as VcNode[], visEdgeList: [] as VcEdge[] }
    const edgesByNode = new Map<number, VcEdge[]>()
    for (const e of flow.edges) {
      if (!edgesByNode.has(e.source)) edgesByNode.set(e.source, [])
      if (!edgesByNode.has(e.target)) edgesByNode.set(e.target, [])
      edgesByNode.get(e.source)!.push(e)
      edgesByNode.get(e.target)!.push(e)
    }
    // In the shared view the seed's competitors are visible peers AND act as
    // hubs, so their own 1-hop suppliers/customers reveal — that's what exposes a
    // supplier/customer shared between the seed and a peer.
    const visible = new Set<number>([seedId])
    if (showShared) for (const id of competitorIds) visible.add(id)
    const isHub = (id: number): boolean =>
      id === seedId || expanded.has(id) || (showShared && competitorIds.has(id))
    let changed = true
    while (changed) {
      changed = false
      for (const id of [...visible]) {
        if (!isHub(id)) continue
        for (const e of edgesByNode.get(id) ?? []) {
          if (!relFilter[e.relation]) continue
          if (!visible.has(e.source)) {
            visible.add(e.source)
            changed = true
          }
          if (!visible.has(e.target)) {
            visible.add(e.target)
            changed = true
          }
        }
      }
    }
    const visNodeList = flow.nodes.filter((n) => visible.has(n.id))
    const visEdgeList = flow.edges.filter(
      (e) => visible.has(e.source) && visible.has(e.target) && relFilter[e.relation]
    )
    return { visNodeList, visEdgeList }
  }, [flow, seedId, expanded, relFilter, showShared, competitorIds])

  const basePos = useMemo(
    () => computeColumnLayout(seedId ?? 0, visNodeList, visEdgeList),
    [seedId, visNodeList, visEdgeList]
  )

  // Outline/hue color per node by its role relative to the seed: the seed itself
  // (near-white), its direct competitors (amber), and supplier/customer nodes
  // (sky/emerald, matching the edge palette). Drives the card border + inner hue.
  const nodeRoleColor = useMemo(() => {
    const m = new Map<number, string>()
    if (!graph || seedId == null) return m
    m.set(seedId, SEED_COLOR)
    for (const id of competitorIds) if (!m.has(id)) m.set(id, RELATION_COLOR.competitor)
    for (const e of graph.edges) {
      if (e.relation === 'supplier' && !m.has(e.source)) m.set(e.source, RELATION_COLOR.supplier)
      else if (e.relation === 'customer' && !m.has(e.target)) m.set(e.target, RELATION_COLOR.customer)
    }
    return m
  }, [graph, seedId, competitorIds])

  // How many peers (seed + its competitors) share each supplier/customer node —
  // drives the "N peers" badge. ≥2 means the node is genuinely shared.
  const peerCounts = useMemo(() => {
    if (!showShared || seedId == null) return new Map<number, number>()
    return computePeerCounts(new Set<number>([seedId, ...competitorIds]), visEdgeList)
  }, [showShared, seedId, competitorIds, visEdgeList])

  const toggleExpand = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const togglePin = useCallback((id: string) => {
    setPinnedEdges((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Re-pull the stored graph for this seed (e.g. after another seed's gather
  // merged new shared nodes into the store). Preserves view state — expand,
  // drag, filters, the shared toggle — it only swaps in fresher data.
  const refresh = useCallback(() => {
    void window.api
      .getValueChain(seed)
      .then((g) => g && setGraph(g))
      .catch(() => {})
  }, [seed])

  const desiredNodes = useMemo<Node<NodeData>[]>(() => {
    if (seedId == null) return []
    return visNodeList.map((n) => ({
      id: String(n.id),
      type: 'vc',
      position: userPos.get(n.id) ?? basePos.get(n.id) ?? { x: 0, y: 0 },
      data: {
        node: n,
        isSeed: n.id === seedId,
        isSelected: n.id === selected,
        hub: (n.expandable && n.id !== seedId
          ? expanded.has(n.id)
            ? 'expanded'
            : 'collapsed'
          : 'none') as HubState,
        roleColor: nodeRoleColor.get(n.id),
        peerCount: peerCounts.get(n.id),
        isUngatheredPeer: showShared && competitorIds.has(n.id) && !n.expandable && !!n.ticker,
        onToggle: toggleExpand
      }
    }))
  }, [visNodeList, basePos, userPos, seedId, selected, expanded, toggleExpand, peerCounts, nodeRoleColor, showShared, competitorIds])

  const desiredEdges = useMemo<Edge<EdgeData>[]>(
    () =>
      visEdgeList.map((e) => {
        const id = `${e.source}-${e.target}-${e.relation}`
        return {
          id,
          source: String(e.source),
          target: String(e.target),
          type: 'vc',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: RELATION_COLOR[e.relation],
            width: 16,
            height: 16
          },
          data: {
            relation: e.relation,
            confidence: e.confidence,
            rationale: e.rationale,
            pinned: pinnedEdges.has(id),
            onTogglePin: togglePin
          }
        }
      }),
    [visEdgeList, pinnedEdges, togglePin]
  )

  // React Flow owns live drag state; we mirror our computed graph into it and
  // capture drag results back into userPos so they persist across re-layouts.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<NodeData>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<EdgeData>([])
  useEffect(() => setRfNodes(desiredNodes), [desiredNodes, setRfNodes])
  useEffect(() => setRfEdges(desiredEdges), [desiredEdges, setRfEdges])

  const onNodeDragStop = useCallback((_: unknown, n: Node) => {
    setUserPos((prev) => {
      const next = new Map(prev)
      next.set(Number(n.id), n.position)
      return next
    })
  }, [])
  const onNodeClick = useCallback((_: unknown, n: Node) => setSelected(Number(n.id)), [])

  // Fit once per seed after its nodes first land (the `fitView` prop only fires
  // on the initial empty render, before the async fetch resolves).
  const rfRef = useRef<ReactFlowInstance | null>(null)
  const fittedRef = useRef<string | null>(null)
  useEffect(() => {
    if (visNodeList.length === 0 || fittedRef.current === seed) return
    fittedRef.current = seed
    requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.2, duration: 200 }))
  }, [seed, visNodeList.length])

  const competitors = useMemo(
    () => (graph ? graph.nodes.filter((n) => competitorIds.has(n.id)) : []),
    [graph, competitorIds]
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
    <div className="flex h-full w-full flex-col bg-zinc-950">
      {!showShared && relFilter.competitor && competitors.length > 0 && (
        <CompetitorStrip competitors={competitors} selected={selected} onPick={(id) => setSelected(id)} />
      )}
      <div className="relative flex-1">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
          onPaneClick={() => setSelected(null)}
          onInit={(inst) => {
            rfRef.current = inst
          }}
          fitView
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background color="#27272a" gap={24} />
          <Controls className="!bg-zinc-800 !text-zinc-200" />
        </ReactFlow>

        <Toolbar
          relFilter={relFilter}
          onToggleRelation={(r) => setRelFilter((p) => ({ ...p, [r]: !p[r] }))}
          showShared={showShared}
          onToggleShared={() => setShowShared((s) => !s)}
          hasDragged={userPos.size > 0}
          onResetLayout={() => setUserPos(new Map())}
          pinnedCount={pinnedEdges.size}
          onClearPins={() => setPinnedEdges(new Set())}
          onFit={() => rfRef.current?.fitView({ padding: 0.2, duration: 200 })}
          onRefresh={refresh}
        />
        <Legend />
        {selectedNode && <Detail node={selectedNode} graph={graph} onClose={() => setSelected(null)} />}
      </div>
    </div>
  )
}

// ── Toolbar (relation filters + view actions) ────────────────────────────────

function Toolbar({
  relFilter,
  onToggleRelation,
  showShared,
  onToggleShared,
  hasDragged,
  onResetLayout,
  pinnedCount,
  onClearPins,
  onFit,
  onRefresh
}: {
  relFilter: RelationFilter
  onToggleRelation: (r: VcRelation) => void
  showShared: boolean
  onToggleShared: () => void
  hasDragged: boolean
  onResetLayout: () => void
  pinnedCount: number
  onClearPins: () => void
  onFit: () => void
  onRefresh: () => void
}): JSX.Element {
  const relations: VcRelation[] = ['supplier', 'customer', 'competitor']
  const labelOf: Record<VcRelation, string> = {
    supplier: 'Suppliers',
    customer: 'Customers',
    competitor: 'Competitors'
  }
  return (
    <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
      {relations.map((r) => {
        const on = relFilter[r]
        return (
          <button
            key={r}
            onClick={() => onToggleRelation(r)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
              on
                ? 'border-zinc-700 bg-zinc-900/90 text-zinc-200'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-600'
            }`}
            title={on ? `Hide ${labelOf[r].toLowerCase()}` : `Show ${labelOf[r].toLowerCase()}`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: on ? RELATION_COLOR[r] : '#3f3f46' }}
            />
            {labelOf[r]}
          </button>
        )
      })}
      <button
        onClick={onToggleShared}
        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
          showShared
            ? 'border-amber-400/60 bg-amber-400/10 text-amber-200'
            : 'border-zinc-800 bg-zinc-900/50 text-zinc-500'
        }`}
        title={
          showShared
            ? 'Hide shared ecosystem'
            : 'Show shared ecosystem — competitors on canvas + suppliers/customers they share'
        }
      >
        Shared ecosystem
      </button>
      <span className="mx-0.5 h-4 w-px bg-zinc-800" />
      <button
        onClick={onFit}
        className="rounded-full border border-zinc-700 bg-zinc-900/90 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:text-zinc-100"
        title="Fit graph to view"
      >
        Fit view
      </button>
      <button
        onClick={onRefresh}
        className="rounded-full border border-zinc-700 bg-zinc-900/90 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:text-zinc-100"
        title="Re-pull the latest stored graph (after new data was gathered elsewhere)"
      >
        Refresh
      </button>
      {hasDragged && (
        <button
          onClick={onResetLayout}
          className="rounded-full border border-zinc-700 bg-zinc-900/90 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:text-zinc-100"
          title="Snap dragged nodes back to the computed layout"
        >
          Reset layout
        </button>
      )}
      {pinnedCount > 0 && (
        <button
          onClick={onClearPins}
          className="rounded-full border border-zinc-700 bg-zinc-900/90 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:text-zinc-100"
          title="Dismiss all pinned edge notes"
        >
          Clear notes
        </button>
      )}
    </div>
  )
}

// ── Competitor strip (out of the canvas, like Pulse) ─────────────────────────

function CompetitorStrip({
  competitors,
  selected,
  onPick
}: {
  competitors: VcNode[]
  selected: number | null
  onPick: (id: number) => void
}): JSX.Element {
  return (
    <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/90">
          Competitors
        </span>
        <div className="flex flex-wrap gap-1.5">
          {competitors.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c.id)}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition ${
                c.id === selected
                  ? 'border-amber-400 bg-amber-400/10 text-amber-100'
                  : 'border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:border-amber-400/60'
              }`}
              title={c.description ?? c.name}
            >
              <span className="max-w-[160px] truncate">{c.name}</span>
              {c.ticker && <span className="text-[10px] text-zinc-500">{c.ticker}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Legend(): JSX.Element {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-zinc-800 bg-zinc-900/90 p-2 text-[10px] text-zinc-400">
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: RELATION_COLOR.supplier }} /> supplier
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: RELATION_COLOR.customer }} /> customer
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: RELATION_COLOR.competitor }} /> competitor
      </div>
      <div className="mt-1 border-t border-zinc-800 pt-1">node outline = role · edge = confidence</div>
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
