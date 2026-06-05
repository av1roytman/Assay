import { app } from 'electron'
import { initDatabase, closeDatabase, getDb } from './database/connection'
import { registerIpc } from './ipc/handlers'
import { startControlServer, stopControlServer } from './server/controlServer'
import { createHomeWindow, openResearchWindow, pushPanel, openValueChainWindow, pushValueChain } from './windows'
import { recordResearch } from './database/history'
import { savePanel } from './database/panels'
import { upsertGraph, getGraph } from './database/valueChain'
import { getResearchData } from './services/yahooService'
import { getSecData } from './services/secService'
import { computeValuation } from './services/dcf'

// Single instance: all research windows live in one process so the control
// server and DB are shared. A second launch just focuses the home window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => createHomeWindow())

  app.whenReady().then(() => {
    initDatabase()
    registerIpc()
    startControlServer({
      onResearch: (ticker) => {
        recordResearch(ticker)
        openResearchWindow(ticker)
      },
      onPanel: (panel) => {
        const savedAt = savePanel(panel)
        return pushPanel({ ...panel, savedAt })
      },
      onData: async (ticker) => {
        const [yahoo, sec] = await Promise.all([getResearchData(ticker), getSecData(ticker)])
        const valuation = computeValuation(yahoo ?? null, ticker, new Date().toISOString())
        return { symbol: ticker, ...(yahoo ?? {}), sec, valuation }
      },
      onValueChainOpen: (ticker) => {
        openValueChainWindow(ticker)
        const g = getGraph(getDb(), ticker)
        return { lastGeneratedAt: g.lastGeneratedAt, nodeCount: g.nodes.length }
      },
      onValueChainPush: (payload) => {
        upsertGraph(getDb(), payload)
        return pushValueChain(payload.seed, getGraph(getDb(), payload.seed))
      }
    })
    createHomeWindow()

    app.on('activate', () => createHomeWindow())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    stopControlServer()
    closeDatabase()
  })
}
