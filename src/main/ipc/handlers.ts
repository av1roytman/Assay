import { ipcMain } from 'electron'
import { getQuote, getDailyHistory } from '../services/stooqService'
import { getFundamentals } from '../services/yahooService'
import { listHistory } from '../database/history'

// Renderer-facing channels. Keep mirrored in src/shared/types.ts (AssayApi)
// and src/preload/index.ts. Push channels (research:init, panel:update) are
// sent from the main process via webContents.send — see windows.ts.
export function registerIpc(): void {
  ipcMain.handle('stocks:quote', (_e, symbol: string) => getQuote(symbol))
  ipcMain.handle('stocks:history', (_e, symbol: string) => getDailyHistory(symbol))
  ipcMain.handle('stocks:fundamentals', (_e, symbol: string) => getFundamentals(symbol))
  ipcMain.handle('history:list', () => listHistory())
}
