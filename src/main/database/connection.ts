import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { migrations } from './migrations'

let dbInstance: Database.Database | null = null

export function initDatabase(): Database.Database {
  if (dbInstance) return dbInstance

  const userDataDir = app.getPath('userData')
  mkdirSync(userDataDir, { recursive: true })
  const dbPath = join(userDataDir, 'assay.db')

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')

  runMigrations(db)

  dbInstance = db
  return db
}

export function getDb(): Database.Database {
  if (!dbInstance) throw new Error('Database not initialized — call initDatabase() first')
  return dbInstance
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}

function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number
  const pending = migrations.filter((m) => m.version > currentVersion)
  if (pending.length === 0) return

  for (const migration of pending) {
    const apply = db.transaction(() => {
      migration.up(db)
      db.pragma(`user_version = ${migration.version}`)
    })
    apply()
    console.log(`[db] applied migration v${migration.version}: ${migration.name}`)
  }
}
