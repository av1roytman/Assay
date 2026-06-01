// SEC EDGAR fundamentals for the sec-summary panel — fetched server-side via
// Electron net.fetch (Chromium stack → trusts the OS cert store, required where
// AVG MITMs TLS; never use global fetch here). Uses data.sec.gov's structured
// XBRL APIs and picks each figure from the latest filing's own accession number,
// which avoids the cross-context mixing that raw XBRL extraction is prone to.
// Returns null on any failure so the /research skill falls back to sec-edgar MCP.

import { net } from 'electron'
import type { SecData } from '../../shared/types'

// SEC asks every client to send a descriptive User-Agent with contact info.
const UA = 'Assay research app (contact: avi@ralfn.com)'
const TIMEOUT_MS = 10_000

let tickerMap: Map<string, string> | null = null // upper ticker -> 10-digit CIK

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal
    })
    if (!res.ok) {
      console.warn('[sec] status', res.status, url)
      return null
    }
    return await res.json()
  } catch (e) {
    console.warn('[sec] fetch failed:', url, '-', e instanceof Error ? e.message : e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function cikFor(symbol: string): Promise<string | null> {
  if (!tickerMap) {
    const json = await fetchJson('https://www.sec.gov/files/company_tickers.json')
    if (!json || typeof json !== 'object') return null
    tickerMap = new Map()
    for (const row of Object.values(json as Record<string, { ticker?: string; cik_str?: number }>)) {
      if (row.ticker && typeof row.cik_str === 'number') {
        tickerMap.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, '0'))
      }
    }
  }
  return tickerMap.get(symbol.trim().toUpperCase()) ?? null
}

interface RecentFilings {
  form?: string[]
  filingDate?: string[]
  reportDate?: string[]
  accessionNumber?: string[]
}

interface SubmissionsJson {
  filings?: { recent?: RecentFilings }
}

// The most recent 10-Q or 10-K (whichever was filed last).
function latestFiling(sub: SubmissionsJson): SecData['filing'] | null {
  const recent = sub.filings?.recent
  if (!recent?.form) return null
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i]
    if (form === '10-Q' || form === '10-K') {
      return {
        form,
        period: recent.reportDate?.[i],
        filed: recent.filingDate?.[i],
        accession: recent.accessionNumber?.[i]
      }
    }
  }
  return null
}

interface ConceptUnit {
  start?: string
  end?: string
  val?: number
  form?: string
  accn?: string
}

interface ConceptJson {
  units?: Record<string, ConceptUnit[]>
}

function dayspan(a?: string, b?: string): number {
  if (!a || !b) return 0
  return Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000
}

// Pick the figure that belongs to `filing`: prefer entries with the same
// accession number; among those ending on the report date, take the shortest
// (quarterly) duration for a 10-Q or the full-year duration for a 10-K.
function pickFigure(
  concept: ConceptJson | null,
  filing: NonNullable<SecData['filing']>,
  unit: 'USD' | 'USD/shares'
): number | undefined {
  const arr = concept?.units?.[unit]
  if (!arr) return undefined
  const sameFiling = arr.filter(
    (e) => e.accn === filing.accession && e.end === filing.period && typeof e.val === 'number'
  )
  const pool = sameFiling.length
    ? sameFiling
    : arr.filter(
        (e) => e.end === filing.period && e.form === filing.form && typeof e.val === 'number'
      )
  if (!pool.length) return undefined
  const wantShort = filing.form === '10-Q'
  pool.sort((a, b) => {
    const da = dayspan(a.start, a.end)
    const db = dayspan(b.start, b.end)
    return wantShort ? da - db : db - da
  })
  return pool[0].val
}

const CONCEPT_BASE = 'https://data.sec.gov/api/xbrl/companyconcept'

async function concept(cik: string, tag: string): Promise<ConceptJson | null> {
  return (await fetchJson(`${CONCEPT_BASE}/CIK${cik}/us-gaap/${tag}.json`)) as ConceptJson | null
}

export async function getSecData(symbol: string): Promise<SecData | null> {
  const cik = await cikFor(symbol)
  if (!cik) return null
  const sub = (await fetchJson(
    `https://data.sec.gov/submissions/CIK${cik}.json`
  )) as SubmissionsJson | null
  if (!sub) return null
  const filing = latestFiling(sub)
  if (!filing) return { cik }
  // Revenue is reported under one of two tags depending on the filer.
  const [rev1, rev2, ni, oi, gp, eps] = await Promise.all([
    concept(cik, 'Revenues'),
    concept(cik, 'RevenueFromContractWithCustomerExcludingAssessedTax'),
    concept(cik, 'NetIncomeLoss'),
    concept(cik, 'OperatingIncomeLoss'),
    concept(cik, 'GrossProfit'),
    concept(cik, 'EarningsPerShareDiluted')
  ])
  const revenue = pickFigure(rev1, filing, 'USD') ?? pickFigure(rev2, filing, 'USD')
  return {
    cik,
    filing,
    revenue,
    netIncome: pickFigure(ni, filing, 'USD'),
    operatingIncome: pickFigure(oi, filing, 'USD'),
    grossProfit: pickFigure(gp, filing, 'USD'),
    epsDiluted: pickFigure(eps, filing, 'USD/shares')
  }
}
