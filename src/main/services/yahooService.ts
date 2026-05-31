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
import type { Fundamentals } from '../../shared/types'

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
