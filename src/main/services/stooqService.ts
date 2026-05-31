// Live quotes via stooq.com's free CSV endpoint.
// Example: https://stooq.com/q/l/?s=aapl.us+msft.us&f=sd2t2ohlcv&h&e=csv
// Columns: Symbol,Date,Time,Open,High,Low,Close,Volume
// "Intraday" change uses close - open because stooq doesn't expose previous-close
// on this endpoint.
//
// Adapted (decoupled copy) from Pulse's stooqService — trimmed to the lean quote
// shape Assay needs (no Yahoo extended-session overlay).

import { net } from 'electron'
import type { StockQuote, DailyBar } from '../../shared/types'

const STOOQ_BASE = 'https://stooq.com/q/l/'
const FETCH_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 55_000
// Stooq silently drops rows once a batch passes ~100 symbols. Chunk well under
// the cliff so a growing watchlist can't drift into truncation.
const CHUNK_SIZE = 50

interface CacheEntry {
  quotes: StockQuote[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

export async function getQuote(symbol: string): Promise<StockQuote | null> {
  const [quote] = await getQuotes([symbol])
  return quote ?? null
}

export async function getQuotes(symbols: string[]): Promise<StockQuote[]> {
  const unique = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)))
  if (unique.length === 0) return []

  const key = unique.slice().sort().join(',')
  const cached = cache.get(key)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.quotes
  }

  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    chunks.push(unique.slice(i, i + CHUNK_SIZE))
  }

  const chunkResults = await Promise.all(chunks.map((c) => fetchChunk(c)))

  // If every chunk failed and we have a prior snapshot, fall back to stale
  // rather than broadcasting an empty list.
  const allFailed = chunkResults.every((r) => r === null)
  if (allFailed && cached) return cached.quotes

  const bySymbol = new Map<string, StockQuote>()
  chunkResults.forEach((chunk, idx) => {
    const requested = chunks[idx]
    const quotes = chunk ?? requested.map(nullQuote)
    for (const q of quotes) bySymbol.set(q.symbol, q)
  })

  const quotes = unique.map((s) => bySymbol.get(s) ?? nullQuote(s))
  cache.set(key, { quotes, fetchedAt: Date.now() })
  return quotes
}

async function fetchChunk(symbols: string[]): Promise<StockQuote[] | null> {
  const encoded = symbols.map((s) => `${s.toLowerCase()}.us`).join('+')
  const url = `${STOOQ_BASE}?s=${encoded}&f=sd2t2ohlcv&h&e=csv`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    // Electron's net.fetch (not global fetch) so HTTPS routes through Chromium's
    // network stack — it trusts the OS certificate store and honors system proxy
    // settings, which global/undici fetch does not. On networks doing TLS
    // inspection (corporate CA in the Windows store) global fetch fails with
    // UNABLE_TO_VERIFY_LEAF_SIGNATURE; net.fetch just works.
    const res = await net.fetch(url, {
      headers: { 'User-Agent': 'Assay/0.1 (stock research)' },
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.text()
    return parseCsv(body, symbols)
  } catch (err) {
    console.warn('[stooq] chunk fetch failed:', err instanceof Error ? err.message : err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

function nullQuote(symbol: string): StockQuote {
  return {
    symbol,
    price: null,
    open: null,
    high: null,
    low: null,
    change: null,
    changePct: null,
    volume: null,
    time: null
  }
}

function parseCsv(body: string, requested: string[]): StockQuote[] {
  const lines = body.trim().split(/\r?\n/)
  if (lines.length <= 1) return []
  const bySymbol = new Map<string, StockQuote>()
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',')
    if (cells.length < 8) continue
    const rawSym = cells[0].trim().toUpperCase()
    const symbol = rawSym.replace(/\.US$/, '')
    const date = cells[1].trim()
    const time = cells[2].trim()
    const open = parseNum(cells[3])
    const high = parseNum(cells[4])
    const low = parseNum(cells[5])
    const close = parseNum(cells[6])
    const volume = parseNum(cells[7])
    const change = close !== null && open !== null ? close - open : null
    const changePct = change !== null && open !== null && open !== 0 ? (change / open) * 100 : null
    bySymbol.set(symbol, {
      symbol,
      price: close,
      open,
      high,
      low,
      change,
      changePct,
      volume,
      time: date && date !== 'N/D' ? `${date} ${time}` : null
    })
  }
  return requested.map((s) => bySymbol.get(s) ?? nullQuote(s))
}

function parseNum(raw: string | undefined): number | null {
  if (!raw) return null
  const t = raw.trim()
  if (!t || t === 'N/D') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// Daily OHLCV history via stooq.com's CSV download endpoint.
// Example: https://stooq.com/q/d/l/?s=aapl.us&i=d
// Columns: Date,Open,High,Low,Close,Volume (ascending). Returns the most recent
// ~2 years (504 trading days) — plenty for 200-day MAs and a 52-week range.
const HISTORY_LIMIT = 504

export async function getDailyHistory(symbol: string): Promise<DailyBar[]> {
  const s = symbol.trim().toLowerCase()
  if (!s) return []
  const url = `https://stooq.com/q/d/l/?s=${s}.us&i=d`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': 'Assay/0.1 (stock research)' },
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.text()
    return parseHistory(body)
  } catch (err) {
    console.warn('[stooq] history fetch failed:', err instanceof Error ? err.message : err)
    return []
  } finally {
    clearTimeout(timer)
  }
}

function parseHistory(body: string): DailyBar[] {
  const lines = body.trim().split(/\r?\n/)
  // First line is the header; an invalid symbol returns "No data" instead.
  if (lines.length <= 1 || !lines[0].toLowerCase().startsWith('date')) return []
  const bars: DailyBar[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',')
    if (cells.length < 6) continue
    const open = parseNum(cells[1])
    const high = parseNum(cells[2])
    const low = parseNum(cells[3])
    const close = parseNum(cells[4])
    const volume = parseNum(cells[5])
    if (open === null || high === null || low === null || close === null) continue
    bars.push({ time: cells[0].trim(), open, high, low, close, volume: volume ?? 0 })
  }
  return bars.slice(-HISTORY_LIMIT)
}
