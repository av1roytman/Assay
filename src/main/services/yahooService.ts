// Yahoo Finance fundamentals service. Provides the valuation fields Stooq lacks
// (market cap, P/E, EPS, dividend yield, beta) for the Key Stats panel.
//
// Yahoo's quoteSummary endpoint requires a per-session crumb tied to a cookie.
// We fetch the cookie (fc.yahoo.com) then the crumb, and cache the crumb until a
// request 401s. Uses Electron's net.fetch (Chromium stack) so it trusts the OS
// cert store — required where AVG MITMs TLS. Never use global fetch here.
//
// Every request is timeout-bounded so a hung fetch resolves to null (panel just
// omits the valuation block) rather than leaving the renderer stuck on "Loading…".

import { net } from 'electron'
import type { DailyBar, IntradayBar, Fundamentals, YahooResearch } from '../../shared/types'

const CRUMB_URL = 'https://query1.finance.yahoo.com/v1/test/getcrumb'
const COOKIE_URL = 'https://fc.yahoo.com'
const SUMMARY_URL = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary'
const MODULES = 'price,summaryDetail,defaultKeyStatistics'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const TIMEOUT_MS = 8000

let crumb: string | null = null

interface FetchResult {
  ok: boolean
  status: number
  text: string
}

async function fetchText(url: string): Promise<FetchResult | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await net.fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal })
    return { ok: res.ok, status: res.status, text: await res.text() }
  } catch (e) {
    console.warn('[yahoo] fetch failed:', url, '-', e instanceof Error ? e.message : e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function ensureCrumb(): Promise<string | null> {
  if (crumb) return crumb
  await fetchText(COOKIE_URL) // sets the session cookie the crumb is tied to (404 is expected)
  const r = await fetchText(CRUMB_URL)
  const text = r?.text.trim()
  if (r?.ok && text && !text.includes('<') && text.length < 64) {
    crumb = text
    return crumb
  }
  console.warn('[yahoo] could not obtain crumb (status', r?.status, ')')
  return null
}

function rawNum(node: unknown): number | undefined {
  if (node && typeof node === 'object' && 'raw' in node) {
    const raw = (node as { raw: unknown }).raw
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  }
  return undefined
}

interface QuoteSummaryResponse {
  quoteSummary?: {
    result?: Array<Record<string, Record<string, unknown>>>
    error?: unknown
  }
}

function parse(json: unknown): Fundamentals | null {
  const result = (json as QuoteSummaryResponse).quoteSummary?.result?.[0]
  if (!result) return null
  const sd = result.summaryDetail ?? {}
  const ks = result.defaultKeyStatistics ?? {}
  const pr = result.price ?? {}
  const divYield = rawNum(sd.dividendYield)
  return {
    marketCap: rawNum(pr.marketCap) ?? rawNum(sd.marketCap),
    trailingPE: rawNum(sd.trailingPE),
    forwardPE: rawNum(sd.forwardPE) ?? rawNum(ks.forwardPE),
    eps: rawNum(ks.trailingEps),
    dividendYield: divYield != null ? divYield * 100 : undefined,
    beta: rawNum(sd.beta)
  }
}

// ── Richer research bundle (for the /research skill's qualitative panels) ─────
// Same crumb flow, more modules, but we extract only the ~30 fields Claude needs
// for the recommendation + sec-summary panels — a fraction of the yfinance MCP
// blob's size (no officers, governance scores, address, etc.).

const RESEARCH_MODULES = 'assetProfile,price,summaryDetail,defaultKeyStatistics,financialData'

function strVal(node: unknown): string | undefined {
  return typeof node === 'string' && node.trim() ? node.trim() : undefined
}

function parseResearch(json: unknown): YahooResearch | null {
  const r = (json as QuoteSummaryResponse).quoteSummary?.result?.[0]
  if (!r) return null
  const ap = r.assetProfile ?? {}
  const pr = r.price ?? {}
  const sd = r.summaryDetail ?? {}
  const ks = r.defaultKeyStatistics ?? {}
  const fd = r.financialData ?? {}
  const divYield = rawNum(sd.dividendYield)
  return {
    business: strVal(ap.longBusinessSummary),
    sector: strVal(ap.sector),
    industry: strVal(ap.industry),
    price: rawNum(fd.currentPrice) ?? rawNum(pr.regularMarketPrice),
    marketCap: rawNum(pr.marketCap) ?? rawNum(sd.marketCap),
    trailingPE: rawNum(sd.trailingPE),
    forwardPE: rawNum(sd.forwardPE) ?? rawNum(ks.forwardPE),
    pegRatio: rawNum(ks.pegRatio),
    priceToSales: rawNum(sd.priceToSalesTrailing12Months),
    priceToBook: rawNum(ks.priceToBook),
    beta: rawNum(sd.beta),
    fiftyTwoWeekLow: rawNum(sd.fiftyTwoWeekLow),
    fiftyTwoWeekHigh: rawNum(sd.fiftyTwoWeekHigh),
    fiftyDayAverage: rawNum(sd.fiftyDayAverage),
    twoHundredDayAverage: rawNum(sd.twoHundredDayAverage),
    trailingEps: rawNum(ks.trailingEps),
    forwardEps: rawNum(ks.forwardEps),
    totalRevenue: rawNum(fd.totalRevenue),
    revenueGrowth: rawNum(fd.revenueGrowth),
    earningsGrowth: rawNum(fd.earningsGrowth),
    grossMargins: rawNum(fd.grossMargins),
    operatingMargins: rawNum(fd.operatingMargins),
    profitMargins: rawNum(fd.profitMargins),
    returnOnEquity: rawNum(fd.returnOnEquity),
    freeCashflow: rawNum(fd.freeCashflow),
    operatingCashflow: rawNum(fd.operatingCashflow),
    totalCash: rawNum(fd.totalCash),
    totalDebt: rawNum(fd.totalDebt),
    dividendYield: divYield != null ? divYield * 100 : undefined,
    analyst: {
      rating: strVal(fd.recommendationKey),
      score: rawNum(fd.recommendationMean),
      count: rawNum(fd.numberOfAnalystOpinions),
      targetLow: rawNum(fd.targetLowPrice),
      targetMean: rawNum(fd.targetMeanPrice),
      targetMedian: rawNum(fd.targetMedianPrice),
      targetHigh: rawNum(fd.targetHighPrice)
    }
  }
}

export async function getResearchData(symbol: string): Promise<YahooResearch | null> {
  const sym = encodeURIComponent(symbol.trim().toUpperCase())
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = await ensureCrumb()
    if (!c) return null
    const url = `${SUMMARY_URL}/${sym}?modules=${RESEARCH_MODULES}&crumb=${encodeURIComponent(c)}`
    const r = await fetchText(url)
    if (!r) return null
    if (r.status === 401 || r.status === 403) {
      crumb = null // stale crumb — refresh and retry
      continue
    }
    if (!r.ok) {
      console.warn('[yahoo] research status', r.status)
      return null
    }
    try {
      const data = parseResearch(JSON.parse(r.text))
      console.log('[yahoo] research for', sym, '->', data ? 'ok' : 'empty')
      return data
    } catch (e) {
      console.warn('[yahoo] research parse error:', e instanceof Error ? e.message : e)
      return null
    }
  }
  return null
}

// ── Daily price history (for the chart panel) ────────────────────────────────
// Yahoo's public v8 chart endpoint — no crumb needed. Replaces Stooq's history
// download, which now requires an API key. We request the full daily history via
// period1=0..now — NOT range=max, which silently downsamples to ~monthly bars.
// Key stats only ever uses the recent tail.
const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart'

interface ChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          open?: (number | null)[]
          high?: (number | null)[]
          low?: (number | null)[]
          close?: (number | null)[]
          volume?: (number | null)[]
        }>
      }
    }>
  }
}

function parseChart(json: unknown): DailyBar[] {
  const res = (json as ChartResponse).chart?.result?.[0]
  const ts = res?.timestamp
  const q = res?.indicators?.quote?.[0]
  if (!ts || !q) return []
  const bars: DailyBar[] = []
  for (let i = 0; i < ts.length; i++) {
    const open = q.open?.[i]
    const high = q.high?.[i]
    const low = q.low?.[i]
    const close = q.close?.[i]
    // Yahoo leaves nulls for non-trading gaps — skip those rows.
    if (open == null || high == null || low == null || close == null) continue
    bars.push({
      time: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: q.volume?.[i] ?? 0
    })
  }
  return bars
}

export async function getDailyHistory(symbol: string): Promise<DailyBar[]> {
  const sym = encodeURIComponent(symbol.trim().toUpperCase())
  if (!sym) return []
  const now = Math.floor(Date.now() / 1000)
  const r = await fetchText(`${CHART_URL}/${sym}?period1=0&period2=${now}&interval=1d`)
  if (!r || !r.ok) {
    console.warn('[yahoo] chart status', r?.status)
    return []
  }
  try {
    const bars = parseChart(JSON.parse(r.text))
    console.log('[yahoo] history for', sym, '->', bars.length, 'bars')
    return bars
  } catch (e) {
    console.warn('[yahoo] chart parse error:', e instanceof Error ? e.message : e)
    return []
  }
}

// Intraday candles from the same v8 chart endpoint. Yahoo limits how far back
// each interval reaches (1m≤7d, 5/15/30m≤60d, 60m≤730d); the caller passes a
// matching range. interval/range are allow-listed before hitting the URL.
const INTRADAY_INTERVALS = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h'])
const INTRADAY_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo'])

function parseIntraday(json: unknown): IntradayBar[] {
  const res = (json as ChartResponse).chart?.result?.[0]
  const ts = res?.timestamp
  const q = res?.indicators?.quote?.[0]
  if (!ts || !q) return []
  const bars: IntradayBar[] = []
  for (let i = 0; i < ts.length; i++) {
    const open = q.open?.[i]
    const high = q.high?.[i]
    const low = q.low?.[i]
    const close = q.close?.[i]
    if (open == null || high == null || low == null || close == null) continue
    bars.push({ time: ts[i], open, high, low, close, volume: q.volume?.[i] ?? 0 })
  }
  return bars
}

export async function getIntradayHistory(
  symbol: string,
  interval: string,
  range: string
): Promise<IntradayBar[]> {
  if (!INTRADAY_INTERVALS.has(interval) || !INTRADAY_RANGES.has(range)) return []
  const sym = encodeURIComponent(symbol.trim().toUpperCase())
  if (!sym) return []
  const r = await fetchText(`${CHART_URL}/${sym}?range=${range}&interval=${interval}`)
  if (!r || !r.ok) {
    console.warn('[yahoo] intraday status', r?.status)
    return []
  }
  try {
    const bars = parseIntraday(JSON.parse(r.text))
    console.log('[yahoo] intraday', sym, interval, range, '->', bars.length, 'bars')
    return bars
  } catch (e) {
    console.warn('[yahoo] intraday parse error:', e instanceof Error ? e.message : e)
    return []
  }
}

export async function getFundamentals(symbol: string): Promise<Fundamentals | null> {
  const sym = encodeURIComponent(symbol.trim().toUpperCase())
  // Try twice: a cached crumb may have expired, in which case we reset and retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = await ensureCrumb()
    if (!c) return null
    const url = `${SUMMARY_URL}/${sym}?modules=${MODULES}&crumb=${encodeURIComponent(c)}`
    const r = await fetchText(url)
    if (!r) return null
    if (r.status === 401 || r.status === 403) {
      crumb = null // stale crumb — refresh and retry
      continue
    }
    if (!r.ok) {
      console.warn('[yahoo] quoteSummary status', r.status)
      return null
    }
    try {
      const f = parse(JSON.parse(r.text))
      console.log('[yahoo] fundamentals for', sym, '->', f ? 'ok' : 'empty')
      return f
    } catch (e) {
      console.warn('[yahoo] parse error:', e instanceof Error ? e.message : e)
      return null
    }
  }
  return null
}
