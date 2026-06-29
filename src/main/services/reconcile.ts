// Pure, deterministic reconciliation between Claude's recommendation `call` and
// the app's own hard numbers (scorecards, DCF, analyst consensus). This is the
// trust mechanism: the app — not the model that wrote the thesis — flags where
// the verdict contradicts the math. No I/O, no Electron imports — unit-testable
// in plain Node (vitest), like scoring.ts / dcf.ts / consensus.ts.

import type {
  AnalystCall,
  Scorecards,
  ValuationData,
  AnalystConsensus,
  ConsistencyCheck,
  ConsistencyConflict
} from '../../shared/types'

// Signed percent from a fraction: 0.22 → "+22%", -0.18 → "-18%", 0 → "0%".
function signedPct(fraction: number): string {
  const p = Math.round(fraction * 100)
  return `${p > 0 ? '+' : ''}${p}%`
}

export function reconcile(
  call: AnalystCall,
  scorecards: Scorecards | null,
  valuation: ValuationData | null,
  consensus?: AnalystConsensus
): ConsistencyCheck {
  const conflicts: ConsistencyConflict[] = []

  // DCF rules — only when the model produced a usable verdict (skips ETFs etc.).
  if (valuation && valuation.applicable && valuation.verdict) {
    const mos =
      typeof valuation.marginOfSafety === 'number'
        ? ` (${signedPct(valuation.marginOfSafety)} margin of safety)`
        : ''
    if (call === 'buy' && valuation.verdict === 'overvalued') {
      conflicts.push({
        kind: 'dcf',
        severity: 'conflict',
        message: `Buy thesis vs DCF overvalued${mos}`
      })
    } else if (call === 'avoid' && valuation.verdict === 'undervalued') {
      conflicts.push({
        kind: 'dcf',
        severity: 'conflict',
        message: `Avoid thesis vs DCF undervalued${mos}`
      })
    }
  }

  // Value scorecard rule — a buy into a red ('bad') Value card.
  const valueCard = scorecards?.cards.find((c) => c.key === 'value')
  if (call === 'buy' && valueCard?.status === 'bad') {
    conflicts.push({
      kind: 'value',
      severity: 'conflict',
      message: 'Buy thesis vs red Value scorecard'
    })
  }

  // Street rules — divergence (informational), not a hard conflict.
  if (typeof consensus?.score === 'number') {
    const mean = consensus.score.toFixed(1)
    if (call === 'buy' && consensus.score >= 3.5) {
      conflicts.push({
        kind: 'street',
        severity: 'divergence',
        message: `Buy thesis vs bearish street consensus (mean ${mean})`
      })
    } else if (call === 'avoid' && consensus.score <= 2) {
      conflicts.push({
        kind: 'street',
        severity: 'divergence',
        message: `Avoid thesis vs bullish street consensus (mean ${mean})`
      })
    }
  }

  const verdict: ConsistencyCheck['verdict'] = conflicts.some((c) => c.severity === 'conflict')
    ? 'conflicted'
    : conflicts.some((c) => c.severity === 'divergence')
      ? 'mixed'
      : 'aligned'

  return { verdict, conflicts }
}
