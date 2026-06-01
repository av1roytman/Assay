import type Database from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  up: (db: Database.Database) => void
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-watchlist',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS watchlist (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL UNIQUE,
          note TEXT,
          added_at INTEGER NOT NULL
        );
      `)
    }
  },
  {
    version: 2,
    name: 'research-history',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS research_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          researched_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_research_history_symbol ON research_history(symbol);
      `)
    }
  },
  {
    version: 3,
    name: 'persisted-panels',
    up: (db) => {
      // One row per (symbol, type): the latest pushed panel, upserted on re-push.
      db.exec(`
        CREATE TABLE IF NOT EXISTS panels (
          symbol TEXT NOT NULL,
          type TEXT NOT NULL,
          title TEXT,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (symbol, type)
        );
      `)
    }
  }
]
