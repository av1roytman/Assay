// Pure scoring engine for the Scorecards panel. NO I/O — callers pass already-
// fetched Yahoo research + daily bars; this returns scored cards. Kept free of
// Electron/network imports so it is unit-testable in plain Node (vitest).
//
// THRESHOLDS ARE FLAT / SECTOR-AGNOSTIC by design (v1). Sector-aware thresholds
// are deferred — see docs/superpowers/specs/2026-06-03-scorecards-panel-design.md
// ("Future work — sector-aware thresholds"). Do not add per-sector logic here
// without revisiting that spec.

import type {
  YahooResearch,
  DailyBar,
  Metric,
  Scorecard,
  ScorecardKey,
  ScorecardTone
} from '../../shared/types'

// Roll a list of metric tones into one card status. Margin rule: a card is good
// (bad) only when good (bad) metrics outnumber the other by >= 2; otherwise
// neutral. Pure neutrals don't count toward the margin. Fewer than 2 scored
// metrics → neutral (not enough signal).
export function rollup(tones: ScorecardTone[]): ScorecardTone {
  const good = tones.filter((t) => t === 'good').length
  const bad = tones.filter((t) => t === 'bad').length
  if (good + bad < 2) return 'neutral'
  if (good - bad >= 1) return 'good'
  if (bad - good >= 1) return 'bad'
  return 'neutral'
}

// 'high' = bigger is better (margins, ROE); 'low' = smaller is better (P/E, D/E).
type Dir = 'high' | 'low'

// Score a value: for 'high', >= goodAt → good, <= badAt → bad. For 'low', the
// comparison flips (goodAt <= badAt, e.g. P/E good <=15, bad >=30).
function score(value: number | undefined, dir: Dir, goodAt: number, badAt: number): ScorecardTone {
  if (value == null || !Number.isFinite(value)) return 'neutral'
  if (dir === 'high') {
    if (value >= goodAt) return 'good'
    if (value <= badAt) return 'bad'
    return 'neutral'
  }
  if (value <= goodAt) return 'good'
  if (value >= badAt) return 'bad'
  return 'neutral'
}

// Build a toned Metric, or undefined when the source value is missing (so the
// card omits it). Mirrors how the Key Stats panel degrades to "—".
function metric(
  label: string,
  value: number | undefined,
  fmt: (n: number) => string,
  tone: ScorecardTone,
  sub?: string
): Metric | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  return { label, value: fmt(value), tone, sub }
}

const x = (n: number): string => `${n.toFixed(1)}×`
const pct = (n: number): string => `${(n * 100).toFixed(1)}%` // input is a fraction
const pctRaw = (n: number): string => `${n.toFixed(1)}%` // input is already a percent
const ratio = (n: number): string => n.toFixed(2)

function compact(...m: (Metric | undefined)[]): Metric[] {
  return m.filter((v): v is Metric => v != null)
}

function card(key: ScorecardKey, title: string, metrics: Metric[], note?: string): Scorecard {
  return { key, title, status: rollup(metrics.map((m) => m.tone ?? 'neutral')), metrics, note }
}

function fmtBigUsd(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  return '$' + n.toFixed(0)
}

// ── Stock cards ──────────────────────────────────────────────────────────────

function valueCard(r: YahooResearch): Scorecard {
  const fcfYield = r.freeCashflow != null && r.marketCap ? r.freeCashflow / r.marketCap : undefined
  const metrics = compact(
    metric('P/E (ttm)', r.trailingPE, x, score(r.trailingPE, 'low', 15, 30)),
    metric('Fwd P/E', r.forwardPE, x, score(r.forwardPE, 'low', 15, 30)),
    metric('P/B', r.priceToBook, x, score(r.priceToBook, 'low', 1.5, 5)),
    metric('P/S', r.priceToSales, x, score(r.priceToSales, 'low', 2, 8)),
    metric('EV/EBITDA', r.enterpriseToEbitda, x, score(r.enterpriseToEbitda, 'low', 10, 20)),
    metric('FCF yield', fcfYield, pct, score(fcfYield, 'high', 0.05, 0.01)),
    metric('ROE', r.returnOnEquity, pct, score(r.returnOnEquity, 'high', 0.15, 0.05)),
    metric('ROA', r.returnOnAssets, pct, score(r.returnOnAssets, 'high', 0.08, 0.02)),
    metric('Debt/Equity', r.debtToEquity, ratio, score(r.debtToEquity, 'low', 50, 150)),
    metric('Current ratio', r.currentRatio, ratio, score(r.currentRatio, 'high', 1.5, 1))
  )
  return card('value', '💰 Value', metrics)
}

function growthCard(r: YahooResearch): Scorecard {
  const metrics = compact(
    metric('Revenue growth', r.revenueGrowth, pct, score(r.revenueGrowth, 'high', 0.1, 0)),
    metric('Earnings growth', r.earningsGrowth, pct, score(r.earningsGrowth, 'high', 0.1, 0)),
    metric('Gross margin', r.grossMargins, pct, score(r.grossMargins, 'high', 0.4, 0.2)),
    metric('Operating margin', r.operatingMargins, pct, score(r.operatingMargins, 'high', 0.15, 0.05)),
    metric('Profit margin', r.profitMargins, pct, score(r.profitMargins, 'high', 0.1, 0.02)),
    metric('PEG', r.pegRatio, ratio, score(r.pegRatio, 'low', 1, 2))
  )
  return card('growth', '📈 Growth', metrics)
}

function dividendCard(r: YahooResearch): Scorecard {
  if (r.dividendYield == null || r.dividendYield === 0) {
    return { key: 'dividend', title: '💵 Dividend', status: 'neutral', metrics: [], note: 'No dividend' }
  }
  const metrics = compact(
    // dividendYield is stored as a percent (yahooService multiplies by 100).
    metric('Yield', r.dividendYield, pctRaw, score(r.dividendYield, 'high', 2, 0.5)),
    // payoutRatio is a fraction; <0.6 healthy, >0.9 stretched.
    metric('Payout ratio', r.payoutRatio, pct, score(r.payoutRatio, 'low', 0.6, 0.9))
  )
  return card('dividend', '💵 Dividend', metrics)
}

// ── Technical (computed from daily bars) ─────────────────────────────────────

export function sma(closes: number[], period: number): number | undefined {
  if (closes.length < period) return undefined
  let sum = 0
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i]
  return sum / period
}

// Simple (non-Wilder) RSI over `period` (default 14). Needs > period bars.
export function rsi(closes: number[], period = 14): number | undefined {
  if (closes.length <= period) return undefined
  let gain = 0
  let loss = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gain += diff
    else loss -= diff
  }
  const avgGain = gain / period
  const avgLoss = loss / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

// Percent return over the trailing `days` (calendar) using the bar nearest the cutoff.
function momentum(bars: DailyBar[], days: number): number | undefined {
  if (bars.length === 0) return undefined
  const last = bars[bars.length - 1]
  const cutoff = Date.parse(last.time) - days * 86_400_000
  if (Date.parse(bars[0].time) > cutoff) return undefined
  const base = bars.find((b) => Date.parse(b.time) >= cutoff)
  return base && base.close ? ((last.close - base.close) / base.close) * 100 : undefined
}

function technicalCard(bars: DailyBar[], key: ScorecardKey): Scorecard {
  const closes = bars.map((b) => b.close)
  const price = closes.length ? closes[closes.length - 1] : undefined
  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  const vs50 = ma50 != null && price != null ? ((price - ma50) / ma50) * 100 : undefined
  const vs200 = ma200 != null && price != null ? ((price - ma200) / ma200) * 100 : undefined
  const window52 = bars.slice(-252)
  const hi52 = window52.length ? Math.max(...window52.map((b) => b.high)) : undefined
  const lo52 = window52.length ? Math.min(...window52.map((b) => b.low)) : undefined
  const fromHigh = hi52 && price != null ? ((price - hi52) / hi52) * 100 : undefined
  const fromLow = lo52 && price != null ? ((price - lo52) / lo52) * 100 : undefined
  const r = rsi(closes, 14)
  const mom3 = momentum(bars, 90)
  const mom6 = momentum(bars, 180)

  // RSI is a band, not monotonic: overbought (>70) and oversold (<30) are both
  // cautionary; a healthy trend sits ~45–65.
  const rsiTone: ScorecardTone =
    r == null ? 'neutral' : r > 70 || r < 30 ? 'bad' : r >= 45 && r <= 65 ? 'good' : 'neutral'

  const metrics = compact(
    metric('vs 50-day MA', vs50, pctRaw, score(vs50, 'high', 2, -2)),
    metric('vs 200-day MA', vs200, pctRaw, score(vs200, 'high', 2, -2)),
    metric('From 52wk high', fromHigh, pctRaw, score(fromHigh, 'high', -10, -25)),
    metric('From 52wk low', fromLow, pctRaw, score(fromLow, 'high', 20, 5)),
    metric('3-mo momentum', mom3, pctRaw, score(mom3, 'high', 5, -5)),
    metric('6-mo momentum', mom6, pctRaw, score(mom6, 'high', 10, -10)),
    metric('RSI (14)', r, (n) => n.toFixed(0), rsiTone)
  )
  return card(key, '📉 Technical', metrics)
}

// ── ETF profile ──────────────────────────────────────────────────────────────

function etfProfileCard(r: YahooResearch): Scorecard {
  const e = r.etf ?? {}
  const top = (e.topHoldings ?? [])
    .slice(0, 5)
    .map((h) =>
      `${h.symbol ?? h.name ?? '?'} ${h.weight != null ? (h.weight * 100).toFixed(1) + '%' : ''}`.trim()
    )
    .join(', ')
  const metrics = compact(
    metric('Expense ratio', e.expenseRatio, (n) => `${(n * 100).toFixed(2)}%`, score(e.expenseRatio, 'low', 0.002, 0.0075)),
    metric('Distribution yield', e.distributionYield, (n) => `${(n * 100).toFixed(2)}%`, 'neutral'),
    metric('AUM', e.totalAssets, fmtBigUsd, score(e.totalAssets, 'high', 1e9, 5e7))
  )
  const note = top ? `Top holdings: ${top}` : undefined
  return card('etf-profile', '🧺 ETF Profile', metrics, note)
}

// ── Public entry point ───────────────────────────────────────────────────────

export function buildScorecards(research: YahooResearch | null, bars: DailyBar[]): Scorecard[] {
  const isEtf = (research?.quoteType ?? '').toUpperCase() === 'ETF'
  if (isEtf) {
    return [etfProfileCard(research ?? {}), technicalCard(bars, 'etf-technical')]
  }
  const r = research ?? {}
  return [valueCard(r), growthCard(r), dividendCard(r), technicalCard(bars, 'technical')]
}
