import { describe, it, expect } from 'vitest'
import { reconcile } from './reconcile'
import type { Scorecards, ValuationData, AnalystConsensus, ScorecardTone } from '../../shared/types'

function scorecardsWith(valueStatus: ScorecardTone): Scorecards {
  return {
    symbol: 'TEST',
    kind: 'stock',
    cards: [
      { key: 'value', title: '💰 Value', status: valueStatus, metrics: [] },
      { key: 'growth', title: '📈 Growth', status: 'good', metrics: [] }
    ],
    asOf: '2026-06-28T00:00:00.000Z'
  }
}

function valuationWith(
  verdict: ValuationData['verdict'],
  marginOfSafety?: number,
  applicable = true
): ValuationData {
  return {
    symbol: 'TEST',
    applicable,
    verdict,
    marginOfSafety,
    note: 'test',
    asOf: '2026-06-28T00:00:00.000Z'
  }
}

describe('reconcile — DCF rules', () => {
  it('flags a conflict when a buy fights an overvalued DCF, with the margin', () => {
    const out = reconcile('buy', null, valuationWith('overvalued', -0.18))
    expect(out.verdict).toBe('conflicted')
    expect(out.conflicts).toHaveLength(1)
    expect(out.conflicts[0]).toEqual({
      kind: 'dcf',
      severity: 'conflict',
      message: 'Buy thesis vs DCF overvalued (-18% margin of safety)'
    })
  })

  it('flags a conflict when an avoid fights an undervalued DCF, with the margin', () => {
    const out = reconcile('avoid', null, valuationWith('undervalued', 0.22))
    expect(out.verdict).toBe('conflicted')
    expect(out.conflicts[0]).toEqual({
      kind: 'dcf',
      severity: 'conflict',
      message: 'Avoid thesis vs DCF undervalued (+22% margin of safety)'
    })
  })

  it('omits the margin parenthetical when marginOfSafety is absent', () => {
    const out = reconcile('buy', null, valuationWith('overvalued', undefined))
    expect(out.conflicts[0].message).toBe('Buy thesis vs DCF overvalued')
  })

  it('does not fire when the DCF verdict is fair', () => {
    expect(reconcile('buy', null, valuationWith('fair', 0.01)).verdict).toBe('aligned')
  })

  it('skips DCF rules when the valuation is not applicable (ETF)', () => {
    const out = reconcile('buy', null, valuationWith('overvalued', -0.3, false))
    expect(out.verdict).toBe('aligned')
    expect(out.conflicts).toHaveLength(0)
  })

  it('does not fire DCF rules for a hold call', () => {
    expect(reconcile('hold', null, valuationWith('overvalued', -0.18)).verdict).toBe('aligned')
  })
})

describe('reconcile — Value scorecard rule', () => {
  it('flags a conflict when a buy fights a red Value card', () => {
    const out = reconcile('buy', scorecardsWith('bad'), null)
    expect(out.verdict).toBe('conflicted')
    expect(out.conflicts[0]).toEqual({
      kind: 'value',
      severity: 'conflict',
      message: 'Buy thesis vs red Value scorecard'
    })
  })

  it('does not fire when the Value card is not red', () => {
    expect(reconcile('buy', scorecardsWith('neutral'), null).verdict).toBe('aligned')
  })

  it('skips the value rule when there is no value card', () => {
    const cards: Scorecards = {
      symbol: 'TEST',
      kind: 'etf',
      cards: [{ key: 'etf-profile', title: 'ETF', status: 'bad', metrics: [] }],
      asOf: '2026-06-28T00:00:00.000Z'
    }
    expect(reconcile('buy', cards, null).verdict).toBe('aligned')
  })
})

describe('reconcile — street rules', () => {
  it('flags a divergence (mixed) when a buy meets bearish consensus', () => {
    const consensus: AnalystConsensus = { score: 4.0 }
    const out = reconcile('buy', null, null, consensus)
    expect(out.verdict).toBe('mixed')
    expect(out.conflicts[0]).toEqual({
      kind: 'street',
      severity: 'divergence',
      message: 'Buy thesis vs bearish street consensus (mean 4.0)'
    })
  })

  it('flags a divergence when an avoid meets bullish consensus', () => {
    const out = reconcile('avoid', null, null, { score: 1.5 })
    expect(out.verdict).toBe('mixed')
    expect(out.conflicts[0].message).toBe('Avoid thesis vs bullish street consensus (mean 1.5)')
  })

  it('skips the street rule when consensus score is absent', () => {
    expect(reconcile('buy', null, null, {}).verdict).toBe('aligned')
    expect(reconcile('buy', null, null, undefined).verdict).toBe('aligned')
  })
})

describe('reconcile — roll-up + graceful skips', () => {
  it('prefers conflicted over divergence when both are present', () => {
    const out = reconcile('buy', null, valuationWith('overvalued', -0.18), { score: 4.0 })
    expect(out.verdict).toBe('conflicted')
    expect(out.conflicts).toHaveLength(2)
    expect(out.conflicts.map((c) => c.kind)).toEqual(['dcf', 'street'])
  })

  it('returns aligned with no conflicts when everything agrees', () => {
    const out = reconcile('buy', scorecardsWith('good'), valuationWith('undervalued', 0.2), {
      score: 1.8
    })
    expect(out.verdict).toBe('aligned')
    expect(out.conflicts).toHaveLength(0)
  })

  it('returns aligned when all inputs are missing', () => {
    expect(reconcile('hold', null, null)).toEqual({ verdict: 'aligned', conflicts: [] })
  })
})
