import { getDb } from './connection'
import type { HistoryEntry } from '../../shared/types'

export function recordResearch(symbol: string): void {
  getDb()
    .prepare('INSERT INTO research_history (symbol, researched_at) VALUES (?, ?)')
    .run(symbol.toUpperCase(), Date.now())
}

export function listHistory(limit = 20): HistoryEntry[] {
  return getDb()
    .prepare(
      `SELECT symbol,
              MAX(researched_at) AS lastResearchedAt,
              COUNT(*)           AS count
         FROM research_history
        GROUP BY symbol
        ORDER BY lastResearchedAt DESC
        LIMIT ?`
    )
    .all(limit) as HistoryEntry[]
}
