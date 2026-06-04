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

// One intraday OHLCV bar. `time` is a UNIX timestamp in seconds (UTC) — what
// lightweight-charts wants for sub-daily data (multiple bars per calendar day).
export interface IntradayBar {
  time: number
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
  savedAt?: number // epoch ms this panel version was created/persisted
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

// ── Scorecards (app-owned, computed in main from Yahoo) ──────────────────────

export type ScorecardTone = 'good' | 'bad' | 'neutral'

export type ScorecardKey =
  | 'value'
  | 'growth'
  | 'dividend'
  | 'technical'
  | 'etf-profile'
  | 'etf-technical'

export interface Scorecard {
  key: ScorecardKey
  title: string // e.g. "💰 Value"
  status: ScorecardTone // rolled-up card color
  metrics: Metric[] // reuses the Metric type above
  note?: string // e.g. "No dividend" or a data caveat
}

export interface Scorecards {
  symbol: string
  kind: 'stock' | 'etf'
  cards: Scorecard[]
  asOf: string // ISO timestamp
}

// ETF-specific data from Yahoo's topHoldings / fundProfile modules. All weights
// and ratios are stored as fractions (0.0009 = 0.09%), formatted at render time.
export interface EtfData {
  expenseRatio?: number // fraction, e.g. 0.0009
  distributionYield?: number // fraction, e.g. 0.013
  totalAssets?: number // AUM in USD
  topHoldings?: { symbol?: string; name?: string; weight?: number }[] // weight as fraction
  sectorWeights?: { sector: string; weight: number }[] // weight as fraction
}

// ── DCF valuation (app-owned, computed in main from Yahoo) ───────────────────

export interface DcfAssumption {
  label: string // "Stage-1 growth (5yr)", "Discount rate (CAPM)", …
  value: string // pre-formatted: "12.0%", "9.8%", "$98.5B"
}

export type ValuationVerdict = 'undervalued' | 'fair' | 'overvalued'

export interface ValuationData {
  symbol: string
  applicable: boolean
  reason?: string // set when applicable === false (e.g. "Not applicable to funds.")
  // Present only when applicable === true:
  fairValue?: number // center case, per share
  fairValueLow?: number // sensitivity band min
  fairValueHigh?: number // sensitivity band max
  price?: number // current, for comparison
  marginOfSafety?: number // fraction; (fairValue − price) / price
  verdict?: ValuationVerdict
  impliedGrowth?: number // reverse-DCF g1, fraction
  impliedGrowthRead?: string // "demanding" | "undemanding" | "in line"
  assumptions?: DcfAssumption[]
  note: string // methodology caveat — always present
  asOf: string // ISO timestamp
}

export interface SecSummaryData {
  business: string // what the company does
  filing?: { form: string; period?: string; filed?: string }
  metrics: Metric[]
  highlights: string[]
  trajectory?: string
  note?: string // caveat / data-quality note
}

// ── News & catalysts (Claude-pushed) ─────────────────────────────────────────

export type NewsSentiment = 'positive' | 'negative' | 'neutral'

export interface NewsItem {
  headline: string
  source: string // "Reuters", "Bloomberg", …
  date?: string // ISO date (YYYY-MM-DD); rendered relative at view time
  url?: string
  why?: string // one-line "why it matters"
  sentiment?: NewsSentiment
}

export interface Catalyst {
  label: string // "Q3 earnings", "WWDC keynote"
  when?: string // free text: "~Aug 1", "Jun 9"
  kind?: 'earnings' | 'product' | 'regulatory' | 'other'
}

export interface NewsData {
  items: NewsItem[]
  catalysts?: Catalyst[]
  note?: string
  asOf?: string
}

// ── Risks & red flags (Claude-pushed) ────────────────────────────────────────

export type RiskSeverity = 'high' | 'medium' | 'low'

export interface RiskCategory {
  category: string // "Financial", "Competitive", "Regulatory", "Macro", "Operational"
  severity: RiskSeverity
  points: string[] // bullet risks under this category
}

export interface DistressScreen {
  label: string // "FCF coverage", "Altman Z", "Accruals"
  value: string // "1.8×", "3.1", "negative"
  band?: string // "safe", "thin", "manipulation flag"
  tone?: 'good' | 'bad' | 'neutral'
}

export interface RisksData {
  categories: RiskCategory[]
  screens?: DistressScreen[] // optional structural-distress strip
  note?: string // methodology caveat — structural signal, not a forecast
  asOf?: string
}

export interface ResearchInit {
  ticker: string
}

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

// ── Slim research bundle (app-fetched for the /research skill) ───────────────
// The app fetches this server-side so Claude's qualitative panels get a compact,
// context-clean figure set instead of the verbose yfinance/SEC MCP blobs. Every
// field is optional; the skill falls back to MCP for anything missing.

export interface AnalystConsensus {
  rating?: string // Yahoo recommendationKey, e.g. "strong_buy"
  score?: number // recommendationMean, 1 (strong buy) … 5 (sell)
  count?: number // numberOfAnalystOpinions
  targetLow?: number
  targetMean?: number
  targetMedian?: number
  targetHigh?: number
}

// Valuation + trajectory + analyst fields pulled from Yahoo quoteSummary.
export interface YahooResearch {
  business?: string
  sector?: string
  industry?: string
  price?: number
  marketCap?: number
  trailingPE?: number
  forwardPE?: number
  pegRatio?: number
  priceToSales?: number
  priceToBook?: number
  beta?: number
  fiftyTwoWeekLow?: number
  fiftyTwoWeekHigh?: number
  fiftyDayAverage?: number
  twoHundredDayAverage?: number
  trailingEps?: number
  forwardEps?: number
  totalRevenue?: number // TTM
  revenueGrowth?: number // fraction, e.g. 0.166 = +16.6% (MRQ YoY)
  earningsGrowth?: number
  grossMargins?: number
  operatingMargins?: number
  profitMargins?: number
  returnOnEquity?: number
  freeCashflow?: number
  operatingCashflow?: number
  totalCash?: number
  totalDebt?: number
  dividendYield?: number // percent, e.g. 0.35
  enterpriseToEbitda?: number
  currentRatio?: number
  debtToEquity?: number
  payoutRatio?: number // fraction, e.g. 0.25 = 25%
  returnOnAssets?: number
  quoteType?: string // Yahoo price.quoteType: "EQUITY" | "ETF" | …
  etf?: EtfData // present only for ETFs
  analyst?: AnalystConsensus
}

// Latest-filing figures from data.sec.gov XBRL, each picked from the filing's
// own accession to avoid cross-context mixing.
export interface SecData {
  cik: string
  filing?: { form: string; period?: string; filed?: string; accession?: string }
  revenue?: number
  netIncome?: number
  operatingIncome?: number
  grossProfit?: number
  epsDiluted?: number
}

export interface ResearchData extends YahooResearch {
  symbol: string
  sec?: SecData | null
  valuation?: ValuationData | null
}

// The typed surface exposed on `window.api` via the preload bridge.
export interface AssayApi {
  getQuote(symbol: string): Promise<StockQuote | null>
  getDailyHistory(symbol: string): Promise<DailyBar[]>
  // Intraday candles (5m/15m/1h …) for the short-range chart views.
  getIntradayHistory(symbol: string, interval: string, range: string): Promise<IntradayBar[]>
  getFundamentals(symbol: string): Promise<Fundamentals | null>
  getScorecards(symbol: string): Promise<Scorecards | null>
  getValuation(symbol: string): Promise<ValuationData | null>
  getHistory(): Promise<HistoryEntry[]>
  // Persisted panels (the last dossier) for a ticker — newest content per type.
  getPanels(symbol: string): Promise<PushPanel[]>
  // Subscribe to "this window is for ticker X". Returns an unsubscribe fn.
  onInit(cb: (init: ResearchInit) => void): () => void
  // Subscribe to panels pushed by Claude. Returns an unsubscribe fn.
  onPanel(cb: (panel: PushPanel) => void): () => void
}
