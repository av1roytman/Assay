// Types shared between main, preload, and renderer.

export interface StockQuote {
  symbol: string
  price: number | null
  open: number | null
  high: number | null
  low: number | null
  change: number | null
  changePct: number | null
  volume: number | null
  time: string | null
}

// One daily OHLCV bar. `time` is an ISO date string (YYYY-MM-DD) — the format
// lightweight-charts accepts directly.
export interface DailyBar {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// Qualitative panels Claude pushes into a research window. Slice 1 ships
// sec-summary + recommendation; the rest are wired as the build progresses.
export type PushPanelType =
  | 'sec-summary'
  | 'recommendation'
  | 'value-chain'
  | 'news'
  | 'risks'
  | 'peers'

// A panel pushed from Claude via the control server. Structured panels carry a
// typed `data` payload (rendered by a dedicated component); `markdown` remains as
// a generic fallback transport for panel types that don't have a layout yet.
export interface PushPanel {
  type: PushPanelType
  ticker: string
  title?: string
  markdown?: string
  data?: unknown
}

// ── Structured panel payloads ───────────────────────────────────────────────
// Claude POSTs these as `data`; each has a purpose-built renderer. Free-text
// fields are plain strings (no markdown).

export type AnalystCall = 'buy' | 'hold' | 'avoid'

export interface PriceTargets {
  current?: number
  low?: number
  mean?: number
  median?: number
  high?: number
}

export interface AnalystNote {
  firm: string
  target?: number
  note?: string
}

export interface RecommendationData {
  call: AnalystCall
  headline: string // one-line summary of the call
  thesis: string // short paragraph: the reasoning behind your call
  buyIf?: string // what would flip you to buy
  avoidIf?: string // what would flip you to avoid
  street: {
    rating?: string // "Buy", "Moderate Buy", …
    score?: number // 1 (strong buy) … 5 (sell)
    analysts?: number
    targets?: PriceTargets
    notable?: AnalystNote[] // recent / notable individual calls
  }
  asOf?: string
}

export interface Metric {
  label: string
  value: string
  sub?: string // small secondary line, e.g. "+17% YoY"
  tone?: 'good' | 'bad' | 'neutral'
}

export interface SecSummaryData {
  business: string // what the company does
  filing?: { form: string; period?: string; filed?: string }
  metrics: Metric[]
  highlights: string[]
  trajectory?: string
  note?: string // caveat / data-quality note
}

export interface ResearchInit {
  ticker: string
}

export interface HistoryEntry {
  symbol: string
  lastResearchedAt: number
  count: number
}

// Valuation fundamentals the app fetches from Yahoo (fields Stooq doesn't carry).
// All optional — the Key Stats panel degrades gracefully if Yahoo is unavailable.
export interface Fundamentals {
  marketCap?: number
  trailingPE?: number
  forwardPE?: number
  eps?: number // trailing twelve months
  dividendYield?: number // percent, e.g. 0.35 = 0.35%
  beta?: number
}

// The typed surface exposed on `window.api` via the preload bridge.
export interface AssayApi {
  getQuote(symbol: string): Promise<StockQuote | null>
  getDailyHistory(symbol: string): Promise<DailyBar[]>
  getFundamentals(symbol: string): Promise<Fundamentals | null>
  getHistory(): Promise<HistoryEntry[]>
  // Subscribe to "this window is for ticker X". Returns an unsubscribe fn.
  onInit(cb: (init: ResearchInit) => void): () => void
  // Subscribe to panels pushed by Claude. Returns an unsubscribe fn.
  onPanel(cb: (panel: PushPanel) => void): () => void
}
