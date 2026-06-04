import { describe, it, expect } from 'vitest'
import {
  costOfEquity,
  blendGrowth,
  fairValuePerShare,
  impliedGrowth,
  computeValuation
} from './dcf'
import type { YahooResearch } from '../../shared/types'

const ASOF = '2026-06-03T00:00:00.000Z'

describe('costOfEquity (CAPM, clamped 0.07–0.14)', () => {
  it('uses rf + beta*ERP for a normal beta', () => {
    // 0.043 + 1.0 * 0.05 = 0.093
    expect(costOfEquity(1.0)).toBeCloseTo(0.093, 3)
  })
  it('floors at 0.07 for a tiny beta', () => {
    expect(costOfEquity(0.2)).toBeCloseTo(0.07, 3)
  })
  it('caps at 0.14 for a huge beta', () => {
    expect(costOfEquity(5)).toBeCloseTo(0.14, 3)
  })
  it('defaults beta to 1.1 when missing', () => {
    // 0.043 + 1.1 * 0.05 = 0.098
    expect(costOfEquity(undefined)).toBeCloseTo(0.098, 3)
  })
})

describe('blendGrowth (clamped 0.04–0.20)', () => {
  it('averages earnings and revenue growth', () => {
    expect(blendGrowth(0.1, 0.2)).toBeCloseTo(0.15, 5)
  })
  it('uses the single present value', () => {
    expect(blendGrowth(0.12, undefined)).toBeCloseTo(0.12, 5)
  })
  it('falls back to 0.08 when both absent', () => {
    expect(blendGrowth(undefined, undefined)).toBeCloseTo(0.08, 5)
  })
  it('clamps an absurd growth down to 0.20', () => {
    expect(blendGrowth(0.6, 0.6)).toBeCloseTo(0.2, 5)
  })
  it('clamps a tiny growth up to 0.04', () => {
    expect(blendGrowth(0.0, 0.0)).toBeCloseTo(0.04, 5)
  })
})

describe('fairValuePerShare (2-stage, gTerm=0.025)', () => {
  it('matches a hand-computed value when g1 == r', () => {
    // fcf0=100, shares=100, g1=r=0.10:
    //   each explicit year PV = 100 → 5yr sum = 500
    //   FCF5 = 100*1.1^5 = 161.051; terminal = 161.051*1.025/0.075 = 2201.03
    //   PV(terminal) = 2201.03 / 1.1^5 = 1366.66
    //   total = 1866.66; / 100 shares = 18.6666
    expect(fairValuePerShare(100, 100, 0.1, 0.1)).toBeCloseTo(18.67, 1)
  })
})

describe('impliedGrowth (reverse DCF round-trip)', () => {
  it("recovers g1 when fed the engine's own fair value as price", () => {
    const fair = fairValuePerShare(100, 100, 0.12, 0.1)
    expect(impliedGrowth(100, 100, 0.1, fair)).toBeCloseTo(0.12, 2)
  })
})

describe('computeValuation — applicable path', () => {
  const research: YahooResearch = {
    quoteType: 'EQUITY',
    price: 100,
    marketCap: 10_000, // shares = 100
    freeCashflow: 100,
    beta: 1.0,
    earningsGrowth: 0.1,
    revenueGrowth: 0.1
  }
  it('returns an applicable valuation with an ordered sensitivity band', () => {
    const v = computeValuation(research, 'TEST', ASOF)
    expect(v.applicable).toBe(true)
    expect(v.symbol).toBe('TEST')
    expect(v.fairValue).toBeGreaterThan(0)
    expect(v.fairValueLow!).toBeLessThan(v.fairValue!)
    expect(v.fairValueHigh!).toBeGreaterThan(v.fairValue!)
    expect(v.verdict).toBeDefined()
    expect(v.assumptions!.length).toBeGreaterThanOrEqual(4)
    expect(v.asOf).toBe(ASOF)
  })
})

describe('computeValuation — N/A paths', () => {
  it('gates out ETFs', () => {
    const v = computeValuation({ quoteType: 'ETF', price: 500, marketCap: 1e9 }, 'SPY', ASOF)
    expect(v.applicable).toBe(false)
    expect(v.reason).toMatch(/fund/i)
  })
  it('gates out negative free cash flow', () => {
    const v = computeValuation(
      { quoteType: 'EQUITY', price: 10, marketCap: 1000, freeCashflow: -50 },
      'XYZ',
      ASOF
    )
    expect(v.applicable).toBe(false)
    expect(v.reason).toMatch(/free cash flow/i)
  })
  it('gates out missing price', () => {
    const v = computeValuation({ quoteType: 'EQUITY', marketCap: 1000, freeCashflow: 100 }, 'XYZ', ASOF)
    expect(v.applicable).toBe(false)
    expect(v.reason).toMatch(/insufficient/i)
  })
  it('returns insufficient-data for null research', () => {
    const v = computeValuation(null, 'XYZ', ASOF)
    expect(v.applicable).toBe(false)
  })
})

describe('computeValuation — financials caveat', () => {
  it('still computes but flags banks/insurers in the note', () => {
    const v = computeValuation(
      {
        quoteType: 'EQUITY',
        sector: 'Financial Services',
        price: 100,
        marketCap: 10_000,
        freeCashflow: 100,
        beta: 1.0
      },
      'BANK',
      ASOF
    )
    expect(v.applicable).toBe(true)
    expect(v.note).toMatch(/bank|insurer|financial/i)
  })
})
