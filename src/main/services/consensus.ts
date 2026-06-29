// Pure helpers that make the recommendation panel's "street" half app-owned.
// The app holds the real Yahoo AnalystConsensus; these overlay it over whatever
// Claude pushed, keeping Claude's per-firm `notable` calls. No I/O, no Electron
// imports — unit-testable in plain Node (vitest), like scoring.ts / dcf.ts.

import type { RecommendationData, AnalystConsensus } from '../../shared/types'

type Street = RecommendationData['street']

const RATING_LABELS: Record<string, string> = {
  strong_buy: 'Strong Buy',
  buy: 'Buy',
  hold: 'Hold',
  underperform: 'Underperform',
  sell: 'Sell'
}

// Yahoo recommendationKey ("strong_buy") → display label ("Strong Buy").
// Unknown / missing keys return undefined so the caller can fall back.
export function mapRecommendationKey(key?: string): string | undefined {
  if (!key) return undefined
  return RATING_LABELS[key.toLowerCase()]
}

// Overlay the app's real Yahoo consensus over Claude's pushed `street`.
// App numbers win when present; Claude's value is the fallback; `notable` is
// always Claude's (Yahoo's bundle has no per-firm calls). When `analyst` is
// absent (ETFs, fetch miss) the pushed street is returned unchanged.
export function mergeStreet(
  claudeStreet: Street,
  analyst?: AnalystConsensus,
  currentPrice?: number
): Street {
  const base: Street = claudeStreet ?? {}
  if (!analyst) return base
  const t = base.targets ?? {}
  return {
    ...base,
    rating: mapRecommendationKey(analyst.rating) ?? base.rating,
    score: analyst.score ?? base.score,
    analysts: analyst.count ?? base.analysts,
    targets: {
      current: currentPrice ?? t.current,
      low: analyst.targetLow ?? t.low,
      mean: analyst.targetMean ?? t.mean,
      median: analyst.targetMedian ?? t.median,
      high: analyst.targetHigh ?? t.high
    },
    notable: base.notable
  }
}
