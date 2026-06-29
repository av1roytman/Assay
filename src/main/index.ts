import { app } from 'electron'
import { initDatabase, closeDatabase, getDb } from './database/connection'
import { registerIpc } from './ipc/handlers'
import { startControlServer, stopControlServer } from './server/controlServer'
import { createHomeWindow, openResearchWindow, pushPanel, openValueChainWindow, pushValueChain } from './windows'
import { recordResearch } from './database/history'
import { savePanel } from './database/panels'
import { recordCall } from './database/calls'
import { buildPeersData } from './services/peers'
import { mergeStreet } from './services/consensus'
import type { RecommendationData } from '../shared/types'
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
      onPanel: async (panel) => {
        let p = panel
        // Peers pushes carry just tickers — enrich into the comparison table
        // app-side (cached Yahoo bundle) before persisting/forwarding.
        if (p.type === 'peers') {
          const tickers = (p.data as { tickers?: unknown } | undefined)?.tickers
          if (Array.isArray(tickers)) {
            const list = tickers.filter((t): t is string => typeof t === 'string')
            p = { ...p, data: await buildPeersData(p.ticker, list) }
          }
        }
        // Recommendation pushes: fill the street consensus with the app's real
        // Yahoo numbers (Claude keeps `notable`), mirroring the peers enrichment.
        // Runs before savePanel AND before the recordCall block below, so the
        // persisted panel and the track-record price-at-call both use real data.
        if (p.type === 'recommendation') {
          const d = p.data as RecommendationData | undefined
          if (d) {
            const r = await getResearchData(p.ticker)
            p = { ...p, data: { ...d, street: mergeStreet(d.street, r?.analyst, r?.price) } }
          }
        }
        const savedAt = savePanel(p)
        // Recommendations also append to the track record ("audit the analyst").
        if (p.type === 'recommendation') {
          const d = p.data as RecommendationData | undefined
          if (d?.call) recordCall(p.ticker, d.call, d.headline, d.street?.targets?.current)
        }
        return pushPanel({ ...p, savedAt })
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
