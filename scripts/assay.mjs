#!/usr/bin/env node
// Assay control client. Used by the /research skill (and by you, manually) to
// drive the Assay desktop app over its localhost control server.
//
//   node scripts/assay.mjs health                 -> exit 0 if app is up
//   node scripts/assay.mjs ensure                 -> launch app if down, wait for ready
//   node scripts/assay.mjs research AAPL          -> open/focus the AAPL window
//   node scripts/assay.mjs panel AAPL recommendation --title "Call" --data rec.json
//   node scripts/assay.mjs panel AAPL sec-summary --title "SEC Summary" --file out.md
//   echo "## hi" | node scripts/assay.mjs panel AAPL news --title "News"
//
// Structured panels (recommendation, sec-summary) take a JSON payload via
// --data <file>; generic panels take markdown via --file <f> or stdin.
//
// Talks plain HTTP to 127.0.0.1 (no TLS), reading the port + token the app
// writes to ~/.assay/server.json on launch.

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const DESC = join(homedir(), '.assay', 'server.json')
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

function descriptor() {
  if (!existsSync(DESC)) return null
  try {
    return JSON.parse(readFileSync(DESC, 'utf8'))
  } catch {
    return null
  }
}

function baseUrl() {
  const d = descriptor()
  return `http://127.0.0.1:${d?.port ?? 8765}`
}

async function isHealthy() {
  try {
    const res = await fetch(`${baseUrl()}/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

async function post(path, body) {
  const d = descriptor()
  if (!d) throw new Error('Assay is not running (no ~/.assay/server.json). Run: ensure')
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-assay-token': d.token },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
  return text
}

function flag(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const [cmd, ...rest] = process.argv.slice(2)

if (cmd === 'health') {
  process.exit((await isHealthy()) ? 0 : 1)
} else if (cmd === 'ensure') {
  if (await isHealthy()) {
    console.log('Assay already running.')
    process.exit(0)
  }
  console.log('Launching Assay (npm run dev)…')
  const child = spawn('npm', ['run', 'dev'], {
    cwd: APP_DIR,
    detached: true,
    stdio: 'ignore',
    shell: true
  })
  child.unref()
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500))
    if (await isHealthy()) {
      console.log('Assay is ready.')
      process.exit(0)
    }
  }
  console.error(`Assay did not become ready in 90s. Try \`npm run dev\` manually in ${APP_DIR}.`)
  process.exit(1)
} else if (cmd === 'research') {
  const ticker = rest[0]
  if (!ticker) {
    console.error('usage: research <TICKER>')
    process.exit(1)
  }
  console.log(await post('/research', { ticker }))
} else if (cmd === 'data') {
  const ticker = rest[0]
  if (!ticker) {
    console.error('usage: data <TICKER>')
    process.exit(1)
  }
  console.log(await post('/research-data', { ticker }))
} else if (cmd === 'panel') {
  const ticker = rest[0]
  const type = rest[1]
  if (!ticker || !type) {
    console.error(
      'usage: panel <TICKER> <type> [--title T] (--data f.json | --file f.md | stdin markdown)'
    )
    process.exit(1)
  }
  const dataFile = flag('--data')
  if (dataFile) {
    const data = JSON.parse(readFileSync(dataFile, 'utf8'))
    console.log(await post('/panel', { ticker, type, title: flag('--title'), data }))
  } else {
    const file = flag('--file')
    const markdown = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8')
    console.log(await post('/panel', { ticker, type, title: flag('--title'), markdown }))
  }
} else {
  console.error('commands: health | ensure | research <T> | panel <T> <type> [--title][--file]')
  process.exit(1)
}
