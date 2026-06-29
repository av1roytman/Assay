import { describe, it, expect } from 'vitest'
import { mapRecommendationKey, mergeStreet } from './consensus'
import type { AnalystConsensus, RecommendationData } from '../../shared/types'

type Street = RecommendationData['street']

const analyst: AnalystConsensus = {
  rating: 'strong_buy',
  score: 1.7,
  count: 42,
  targetLow: 180,
  targetMean: 240,
  targetMedian: 235,
  targetHigh: 300
}

const claude: Street = {
  rating: 'Buy (Claude)',
  score: 2.5,
  analysts: 3,
  targets: { current: 199, low: 150, mean: 210, median: 205, high: 250 },
  notable: [{ firm: 'Morgan Stanley', target: 260, note: 'reiterated' }]
}

describe('mapRecommendationKey', () => {
  it('maps each Yahoo key to its display label', () => {
    expect(mapRecommendationKey('strong_buy')).toBe('Strong Buy')
    expect(mapRecommendationKey('buy')).toBe('Buy')
    expect(mapRecommendationKey('hold')).toBe('Hold')
    expect(mapRecommendationKey('underperform')).toBe('Underperform')
    expect(mapRecommendationKey('sell')).toBe('Sell')
  })

  it('returns undefined for unknown or missing keys', () => {
    expect(mapRecommendationKey('none')).toBeUndefined()
    expect(mapRecommendationKey(undefined)).toBeUndefined()
    expect(mapRecommendationKey('')).toBeUndefined()
  })
})

describe('mergeStreet', () => {
  it('overrides Claude street numbers with the app analyst numbers', () => {
    const out = mergeStreet(claude, analyst, 222)
    expect(out.rating).toBe('Strong Buy')
    expect(out.score).toBe(1.7)
    expect(out.analysts).toBe(42)
    expect(out.targets?.low).toBe(180)
    expect(out.targets?.mean).toBe(240)
    expect(out.targets?.median).toBe(235)
    expect(out.targets?.high).toBe(300)
  })

  it('sets targets.current from the passed currentPrice, not Claude', () => {
    expect(mergeStreet(claude, analyst, 222).targets?.current).toBe(222)
  })

  it("preserves Claude's notable calls verbatim", () => {
    expect(mergeStreet(claude, analyst, 222).notable).toEqual(claude.notable)
  })

  it('returns the pushed street unchanged when analyst is absent', () => {
    expect(mergeStreet(claude, undefined, 222)).toEqual(claude)
  })

  it('falls back field-by-field when analyst is partial', () => {
    const partial: AnalystConsensus = { rating: 'buy', targetMean: 240 }
    const out = mergeStreet(claude, partial, undefined)
    expect(out.rating).toBe('Buy') // mapped from analyst
    expect(out.score).toBe(2.5) // fallback to Claude
    expect(out.analysts).toBe(3) // fallback to Claude
    expect(out.targets?.mean).toBe(240) // from analyst
    expect(out.targets?.high).toBe(250) // fallback to Claude
    expect(out.targets?.current).toBe(199) // fallback to Claude (no currentPrice)
  })

  it('keeps an unknown analyst rating as the Claude rating', () => {
    expect(mergeStreet(claude, { ...analyst, rating: 'none' }, 222).rating).toBe('Buy (Claude)')
  })
})
