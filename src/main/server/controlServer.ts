// Localhost-only control server. Claude (via scripts/assay.mjs) POSTs research
// requests and panels here; we forward them into the app. Bound to 127.0.0.1
// and guarded by a per-launch token written to ~/.assay/server.json. The token
// lives in a custom header, which forces a CORS preflight that a browser page
// can't satisfy — so random web pages can't drive the app even on localhost.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import type { PushPanel } from '../../shared/types'

const PORT = 8765
const HOST = '127.0.0.1'
const MAX_BODY = 5_000_000

export interface ControlCallbacks {
  onResearch: (ticker: string) => void
  onPanel: (panel: PushPanel) => boolean
  // Fetch the slim research bundle (Yahoo + SEC) for a ticker. Returns whatever
  // the data services produce; the server just serializes it back to the client.
  onData: (ticker: string) => Promise<unknown>
}

let server: Server | null = null
let token = ''

function descriptorPath(): string {
  return join(homedir(), '.assay', 'server.json')
}

export function startControlServer(cb: ControlCallbacks): void {
  token = randomBytes(24).toString('hex')
  server = createServer((req, res) => {
    void handle(req, res, cb)
  })
  server.on('error', (e) => console.error('[control] server error:', e))
  server.listen(PORT, HOST, () => {
    const dir = join(homedir(), '.assay')
    mkdirSync(dir, { recursive: true })
    writeFileSync(descriptorPath(), JSON.stringify({ port: PORT, token, pid: process.pid }, null, 2))
    console.log(`[control] listening on http://${HOST}:${PORT}`)
  })
}

export function stopControlServer(): void {
  server?.close()
  server = null
  try {
    rmSync(descriptorPath())
  } catch {
    /* descriptor may already be gone */
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new Error('payload too large')
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

async function handle(req: IncomingMessage, res: ServerResponse, cb: ControlCallbacks): Promise<void> {
  const url = req.url ?? '/'
  const method = req.method ?? 'GET'

  if (method === 'GET' && url === '/health') {
    send(res, 200, { ok: true, app: 'assay' })
    return
  }

  if (method !== 'POST') {
    send(res, 404, { ok: false, error: 'not found' })
    return
  }

  if (req.headers['x-assay-token'] !== token) {
    send(res, 401, { ok: false, error: 'bad token' })
    return
  }

  let payload: Record<string, unknown>
  try {
    payload = await readJson(req)
  } catch (e) {
    send(res, 400, { ok: false, error: e instanceof Error ? e.message : 'bad body' })
    return
  }

  if (url === '/research') {
    const ticker = String(payload.ticker ?? '').trim().toUpperCase()
    if (!ticker) {
      send(res, 400, { ok: false, error: 'ticker required' })
      return
    }
    cb.onResearch(ticker)
    send(res, 200, { ok: true, ticker })
    return
  }

  if (url === '/panel') {
    const ticker = String(payload.ticker ?? '').trim().toUpperCase()
    const type = String(payload.type ?? '').trim()
    if (!ticker || !type) {
      send(res, 400, { ok: false, error: 'ticker and type required' })
      return
    }
    const delivered = cb.onPanel({ ...payload, ticker, type } as unknown as PushPanel)
    send(res, 200, { ok: true, delivered })
    return
  }

  if (url === '/research-data') {
    const ticker = String(payload.ticker ?? '').trim().toUpperCase()
    if (!ticker) {
      send(res, 400, { ok: false, error: 'ticker required' })
      return
    }
    try {
      const data = await cb.onData(ticker)
      send(res, 200, { ok: true, ticker, data })
    } catch (e) {
      send(res, 500, { ok: false, error: e instanceof Error ? e.message : 'fetch failed' })
    }
    return
  }

  send(res, 404, { ok: false, error: 'unknown endpoint' })
}
