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
  ,{
    version: 4,
    name: 'value-chain-graph',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS vc_entities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          ticker TEXT UNIQUE,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          aliases TEXT,
          description TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS vc_entities_norm
          ON vc_entities(normalized_name) WHERE ticker IS NULL;
        CREATE TABLE IF NOT EXISTS vc_edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id INTEGER NOT NULL REFERENCES vc_entities(id),
          target_id INTEGER NOT NULL REFERENCES vc_entities(id),
          relation TEXT NOT NULL,
          confidence TEXT NOT NULL,
          source_tag TEXT NOT NULL,
          rationale TEXT,
          seed_ticker TEXT NOT NULL,
          generated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS vc_edges_seed ON vc_edges(seed_ticker);
        CREATE INDEX IF NOT EXISTS vc_edges_source ON vc_edges(source_id);
        CREATE INDEX IF NOT EXISTS vc_edges_target ON vc_edges(target_id);
        CREATE TABLE IF NOT EXISTS vc_generations (
          seed_ticker TEXT PRIMARY KEY,
          generated_at INTEGER NOT NULL,
          note TEXT
        );
      `)
    }
  }
]
