import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { PushPanel, VcGraph, SurfaceInit } from '../shared/types'

// Keyed by 'HOME' for the landing window, or by uppercase ticker for research
// windows (one window per ticker — may become tabs later).
const windows = new Map<string, BrowserWindow>()

function baseOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 820,
    minWidth: 820,
    minHeight: 540,
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }
}

function loadInto(win: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function createHomeWindow(): void {
  const existing = windows.get('HOME')
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }
  const win = new BrowserWindow({ ...baseOptions(), title: 'Assay' })
  windows.set('HOME', win)
  win.on('closed', () => windows.delete('HOME'))
  win.on('ready-to-show', () => win.show())
  loadInto(win)
}

export function openResearchWindow(ticker: string): void {
  const key = ticker.toUpperCase()
  const existing = windows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    existing.webContents.send('research:init', { kind: 'research', ticker: key } satisfies SurfaceInit)
    return
  }
  const win = new BrowserWindow({ ...baseOptions(), title: `Assay — ${key}` })
  windows.set(key, win)
  win.on('closed', () => windows.delete(key))
  win.on('ready-to-show', () => win.show())
  // Tell the renderer which ticker it owns once it's loaded.
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('research:init', { kind: 'research', ticker: key } satisfies SurfaceInit)
  })
  loadInto(win)
}

export function pushPanel(panel: PushPanel): boolean {
  const win = windows.get(panel.ticker.toUpperCase())
  if (!win || win.isDestroyed()) return false
  win.webContents.send('panel:update', panel)
  return true
}

// VC windows live in a separate key namespace ('VC:<TICKER>') so they don't
// collide with the research window for the same ticker.
export function openValueChainWindow(ticker: string): void {
  const key = `VC:${ticker.toUpperCase()}`
  const display = ticker.toUpperCase()
  const existing = windows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    existing.webContents.send('research:init', { kind: 'value-chain', ticker: display } satisfies SurfaceInit)
    return
  }
  const win = new BrowserWindow({ ...baseOptions(), title: `Assay — ${display} value chain` })
  windows.set(key, win)
  win.on('closed', () => windows.delete(key))
  win.on('ready-to-show', () => win.show())
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('research:init', { kind: 'value-chain', ticker: display } satisfies SurfaceInit)
  })
  loadInto(win)
}

export function pushValueChain(seed: string, graph: VcGraph): boolean {
  const win = windows.get(`VC:${seed.toUpperCase()}`)
  if (!win || win.isDestroyed()) return false
  win.webContents.send('value-chain:update', graph)
  return true
}
