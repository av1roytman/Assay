// Orchestrates the Scorecards panel: fetch Yahoo research + daily history, hand
// them to the pure scoring engine, assemble the Scorecards payload. All I/O lives
// here; the math lives in scoring.ts. Returns null only when we have neither
// research nor price history (panel then renders empty).

import { getResearchData, getDailyHistory } from './yahooService'
import { buildScorecards } from './scoring'
import type { Scorecards } from '../../shared/types'

export async function getScorecards(symbol: string): Promise<Scorecards | null> {
  const sym = symbol.trim().toUpperCase()
  if (!sym) return null
  const [research, bars] = await Promise.all([getResearchData(sym), getDailyHistory(sym)])
  if (!research && bars.length === 0) return null
  const kind = (research?.quoteType ?? '').toUpperCase() === 'ETF' ? 'etf' : 'stock'
  const cards = buildScorecards(research, bars)
  console.log('[scorecards] for', sym, '->', kind, cards.length, 'cards')
  return { symbol: sym, kind, cards, asOf: new Date().toISOString() }
}
