import { describe, it, expect } from 'vitest'
import { rollup, buildScorecards } from './scoring'
import type { YahooResearch, DailyBar } from '../../shared/types'

describe('rollup', () => {
  it('is good when good metrics exceed bad by >= 2', () => {
    expect(rollup(['good', 'good', 'bad'])).toBe('good')
  })
  it('is bad when bad metrics exceed good by >= 2', () => {
    expect(rollup(['bad', 'bad', 'good'])).toBe('bad')
  })
  it('is neutral when the margin is < 2', () => {
    expect(rollup(['good', 'bad'])).toBe('neutral')
  })
  it('is neutral when fewer than 2 metrics are scored', () => {
    expect(rollup(['good'])).toBe('neutral')
    expect(rollup([])).toBe('neutral')
  })
  it('ignores neutral tones in the margin', () => {
    expect(rollup(['good', 'good', 'neutral'])).toBe('good')
  })
})

function bars(closes: number[]): DailyBar[] {
  // Daily bars one calendar day apart, oldest first.
  const start = Date.parse('2023-01-01')
  return closes.map((c, i) => ({
    time: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1000
  }))
}

describe('buildScorecards — stock', () => {
  const research: YahooResearch = {
    quoteType: 'EQUITY',
    trailingPE: 12, // good (<=15)
    returnOnEquity: 0.2, // good (>=0.15)
    grossMargins: 0.5, // good
    revenueGrowth: 0.15, // good
    dividendYield: 1.5, // payer
    payoutRatio: 0.3,
    freeCashflow: 1000,
    marketCap: 10000 // FCF yield 10% → good
  }
  const cards = buildScorecards(research, bars(Array.from({ length: 60 }, (_, i) => 100 + i)))

  it('returns the four stock cards in order', () => {
    expect(cards.map((c) => c.key)).toEqual(['value', 'growth', 'dividend', 'technical'])
  })
  it('scores a cheap, profitable name as a good value card', () => {
    expect(cards[0].status).toBe('good')
  })
  it('omits metrics whose source data is missing', () => {
    expect(cards[0].metrics.find((m) => m.label === 'P/B')).toBeUndefined()
  })
})

describe('buildScorecards — non-dividend payer', () => {
  it('shows a neutral dividend card with a note and no metrics', () => {
    const cards = buildScorecards({ quoteType: 'EQUITY' }, [])
    const div = cards.find((c) => c.key === 'dividend')!
    expect(div.metrics).toHaveLength(0)
    expect(div.note).toBe('No dividend')
    expect(div.status).toBe('neutral')
  })
})

describe('buildScorecards — ETF', () => {
  it('returns the ETF card set', () => {
    const cards = buildScorecards(
      { quoteType: 'ETF', etf: { expenseRatio: 0.0009, totalAssets: 5e10 } },
      bars(Array.from({ length: 5 }, (_, i) => 100 + i))
    )
    expect(cards.map((c) => c.key)).toEqual(['etf-profile', 'etf-technical'])
  })
})

describe('buildScorecards — short history', () => {
  it('omits MA/RSI metrics when there are too few bars', () => {
    const cards = buildScorecards({ quoteType: 'EQUITY' }, bars([100, 101, 102]))
    const tech = cards.find((c) => c.key === 'technical')!
    expect(tech.metrics.find((m) => m.label === 'vs 200-day MA')).toBeUndefined()
    expect(tech.metrics.find((m) => m.label === 'RSI (14)')).toBeUndefined()
  })
})
