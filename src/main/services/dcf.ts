// Pure 2-stage equity-DCF engine for the Valuation panel. NO I/O — callers pass an
// already-fetched YahooResearch; this returns a ValuationData. Kept free of
// Electron/network imports so it is unit-testable in plain Node (vitest), exactly
// like scoring.ts.
//
// Methodology (see docs/superpowers/specs/2026-06-03-dcf-valuation-panel-design.md):
//   5 explicit years of FCF growth at a clamped blended rate, then a Gordon
//   perpetuity at 2.5%, discounted at CAPM cost of equity. Treats Yahoo
//   freeCashflow as cash flow to equity (no WACC bridge) off a single TTM base.
//   A transparent model, not a forecast.

import type { YahooResearch, ValuationData, DcfAssumption, ValuationVerdict } from '../../shared/types'

const RF = 0.043 // risk-free (hardcoded; live FRED feed is sub-project E)
const ERP = 0.05 // equity risk premium
const G_TERM = 0.025 // terminal growth
const YEARS = 5 // explicit forecast horizon
const DEFAULT_BETA = 1.1
const DEFAULT_G1 = 0.08
const G1_FLOOR = 0.04
const G1_CAP = 0.2
const R_FLOOR = 0.07
const R_CAP = 0.14

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

function num(x: number | undefined | null): x is number {
  return x != null && Number.isFinite(x)
}

// CAPM cost of equity, clamped to a sane band.
export function costOfEquity(beta: number | undefined): number {
  const b = num(beta) ? beta : DEFAULT_BETA
  return clamp(RF + b * ERP, R_FLOOR, R_CAP)
}

// Stage-1 growth: average of earnings & revenue growth (whichever present),
// fallback 0.08, clamped to [0.04, 0.20].
export function blendGrowth(
  earningsGrowth: number | undefined,
  revenueGrowth: number | undefined
): number {
  const vals = [earningsGrowth, revenueGrowth].filter(num) as number[]
  const raw = vals.length === 2 ? (vals[0] + vals[1]) / 2 : vals.length === 1 ? vals[0] : DEFAULT_G1
  return clamp(raw, G1_FLOOR, G1_CAP)
}

// 2-stage equity DCF: PV of 5yr explicit FCF + PV of Gordon terminal, per share.
export function fairValuePerShare(fcf0: number, shares: number, g1: number, r: number): number {
  let pv = 0
  let fcf = fcf0
  for (let t = 1; t <= YEARS; t++) {
    fcf = fcf0 * Math.pow(1 + g1, t)
    pv += fcf / Math.pow(1 + r, t)
  }
  const terminal = (fcf * (1 + G_TERM)) / (r - G_TERM)
  pv += terminal / Math.pow(1 + r, YEARS)
  return pv / shares
}

// Reverse DCF: the stage-1 growth that makes fair value == price. Fair value is
// monotonically increasing in g1, so a binary search converges.
export function impliedGrowth(fcf0: number, shares: number, r: number, price: number): number {
  let lo = -0.5
  let hi = 1.0
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (fairValuePerShare(fcf0, shares, mid, r) < price) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}

function compactUsd(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e12) return `$${(n / 1e12).toFixed(1)}T`
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toFixed(0)}`
}

function compactNum(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return n.toFixed(0)
}

const BASE_NOTE =
  '2-stage DCF: 5yr at a blended growth rate, then a 2.5% perpetuity, discounted at CAPM cost of equity. ' +
  'Treats free cash flow as equity cash flow (no WACC bridge) off a single TTM base. A transparent model, not a forecast.'

function naResult(symbol: string, asOf: string, reason: string): ValuationData {
  return { symbol, applicable: false, reason, note: BASE_NOTE, asOf }
}

// Orchestrator. Pure — caller supplies symbol + asOf (so tests are deterministic).
export function computeValuation(
  research: YahooResearch | null,
  symbol: string,
  asOf: string
): ValuationData {
  const sym = symbol.toUpperCase()
  if (!research) return naResult(sym, asOf, 'Insufficient data.')
  if ((research.quoteType ?? '').toUpperCase() === 'ETF') {
    return naResult(sym, asOf, 'Not applicable to funds.')
  }
  const { price, marketCap, freeCashflow } = research
  if (!num(price) || !num(marketCap) || price <= 0 || marketCap <= 0) {
    return naResult(sym, asOf, 'Insufficient data — no price or market cap.')
  }
  if (!num(freeCashflow) || freeCashflow <= 0) {
    const fig = num(freeCashflow) ? ` (${compactUsd(freeCashflow)})` : ''
    return naResult(sym, asOf, `DCF not applicable — negative/insufficient free cash flow${fig}.`)
  }

  const shares = marketCap / price
  const r = costOfEquity(research.beta)
  const g1 = blendGrowth(research.earningsGrowth, research.revenueGrowth)

  const fairValue = fairValuePerShare(freeCashflow, shares, g1, r)
  // Sensitivity corners: fair value rises with g1, falls with r → extremes are the
  // diagonal corners of the r±0.01 × g1±0.03 grid.
  const fairValueLow = fairValuePerShare(freeCashflow, shares, g1 - 0.03, r + 0.01)
  const fairValueHigh = fairValuePerShare(freeCashflow, shares, g1 + 0.03, r - 0.01)

  const marginOfSafety = (fairValue - price) / price
  const verdict: ValuationVerdict =
    marginOfSafety >= 0.2 ? 'undervalued' : marginOfSafety < -0.15 ? 'overvalued' : 'fair'

  const implied = impliedGrowth(freeCashflow, shares, r, price)
  const impliedGrowthRead =
    implied > g1 + 0.02 ? 'demanding' : implied < g1 - 0.02 ? 'undemanding' : 'in line'

  const isFinancial = (research.sector ?? '').toLowerCase().includes('financial')
  const note = isFinancial
    ? `${BASE_NOTE} FCF-based DCF is unreliable for banks/insurers — read with caution.`
    : BASE_NOTE

  const assumptions: DcfAssumption[] = [
    { label: 'FCF base (TTM)', value: compactUsd(freeCashflow) },
    { label: 'Stage-1 growth (5yr)', value: pct(g1) },
    { label: 'Terminal growth', value: pct(G_TERM) },
    { label: 'Discount rate (CAPM)', value: pct(r) },
    { label: 'Shares', value: compactNum(shares) }
  ]

  return {
    symbol: sym,
    applicable: true,
    fairValue,
    fairValueLow,
    fairValueHigh,
    price,
    marginOfSafety,
    verdict,
    impliedGrowth: implied,
    impliedGrowthRead,
    assumptions,
    note,
    asOf
  }
}
