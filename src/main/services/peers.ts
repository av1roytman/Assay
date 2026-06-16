// Build the peer-comparison payload: Claude picks tickers, the app fills the
// metrics from the (cached) Yahoo research bundle. The seed renders as the
// first row so the table always compares against the researched company.

import { getResearchData } from './yahooService'
import type { PeersData, PeerRow } from '../../shared/types'

const MAX_PEERS = 6

export async function buildPeersData(seed: string, tickers: string[]): Promise<PeersData> {
  const seedSym = seed.toUpperCase()
  const peers = [...new Set(tickers.map((t) => t.toUpperCase()))]
    .filter((t) => t && t !== seedSym)
    .slice(0, MAX_PEERS)
  const rows = await Promise.all(
    [seedSym, ...peers].map(async (sym): Promise<PeerRow> => {
      const r = await getResearchData(sym)
      return {
        symbol: sym,
        marketCap: r?.marketCap,
        forwardPE: r?.forwardPE,
        priceToSales: r?.priceToSales,
        revenueGrowth: r?.revenueGrowth,
        operatingMargins: r?.operatingMargins,
        fcfYield:
          r?.freeCashflow != null && r?.marketCap ? r.freeCashflow / r.marketCap : undefined,
        dividendYield: r?.dividendYield,
        beta: r?.beta
      }
    })
  )
  return { rows, asOf: new Date().toISOString() }
}
