// Orchestrates the Valuation panel: fetch Yahoo research, hand it to the pure DCF
// engine, return the ValuationData. All I/O lives here; the math lives in dcf.ts.
// Returns null only for an empty symbol — otherwise always returns a ValuationData
// (applicable:false carries the reason), so the renderer can show "why not".

import { getResearchData } from './yahooService'
import { computeValuation } from './dcf'
import type { ValuationData } from '../../shared/types'

export async function getValuation(symbol: string): Promise<ValuationData | null> {
  const sym = symbol.trim().toUpperCase()
  if (!sym) return null
  const research = await getResearchData(sym)
  const valuation = computeValuation(research, sym, new Date().toISOString())
  console.log(
    '[valuation] for',
    sym,
    '->',
    valuation.applicable
      ? `$${valuation.fairValue?.toFixed(2)}/sh (${valuation.verdict})`
      : valuation.reason
  )
  return valuation
}
