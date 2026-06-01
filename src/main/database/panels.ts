import { getDb } from './connection'
import type { PushPanel } from '../../shared/types'

// Persist the latest panel per (symbol, type) so a reopened window can show the
// last dossier instantly. Re-pushing the same type overwrites it and bumps the
// timestamp. Returns the stored creation time (epoch ms) to stamp the live push.
export function savePanel(panel: PushPanel): number {
  const createdAt = Date.now()
  const payload = JSON.stringify({ data: panel.data, markdown: panel.markdown })
  getDb()
    .prepare(
      `INSERT INTO panels (symbol, type, title, payload, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(symbol, type) DO UPDATE SET
         title = excluded.title,
         payload = excluded.payload,
         created_at = excluded.created_at`
    )
    .run(panel.ticker.toUpperCase(), panel.type, panel.title ?? null, payload, createdAt)
  return createdAt
}

interface PanelRow {
  symbol: string
  type: string
  title: string | null
  payload: string
  created_at: number
}

export function getStoredPanels(symbol: string): PushPanel[] {
  const rows = getDb()
    .prepare('SELECT symbol, type, title, payload, created_at FROM panels WHERE symbol = ?')
    .all(symbol.toUpperCase()) as PanelRow[]
  return rows.map((r) => {
    let parsed: { data?: unknown; markdown?: string } = {}
    try {
      parsed = JSON.parse(r.payload)
    } catch {
      /* corrupt payload — fall back to an empty panel rather than throwing */
    }
    return {
      ticker: r.symbol,
      type: r.type as PushPanel['type'],
      title: r.title ?? undefined,
      data: parsed.data,
      markdown: parsed.markdown,
      savedAt: r.created_at
    }
  })
}
