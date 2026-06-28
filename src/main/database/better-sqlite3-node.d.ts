// Type shim: 'better-sqlite3-node' is a test-only npm alias of better-sqlite3
// that keeps its Node-ABI prebuild (the main copy is electron-rebuilt to
// Electron's ABI, which system-Node vitest can't load). Same package → reuse
// its types.
declare module 'better-sqlite3-node' {
  import Database from 'better-sqlite3'
  export = Database
}
