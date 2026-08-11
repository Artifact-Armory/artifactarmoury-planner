#!/usr/bin/env node
/**
 * Zero-dependency screenshot tool.
 *
 * Drives your installed Chrome over the DevTools Protocol using Node's built-in
 * WebSocket + fetch. Nothing is downloaded and nothing is installed — no
 * Puppeteer, no Playwright, no MCP server.
 *
 *   node screenshot.mjs                      # /  at 1440x1000
 *   node screenshot.mjs /browse /planner     # several routes in one run
 *   node screenshot.mjs /planner --webgl     # routes that render 3D
 *   node screenshot.mjs / --full             # full scroll height
 *   node screenshot.mjs --url https://artifactarmoury-planner.pages.dev
 *
 * Options:
 *   --url <base>     base URL (default http://localhost:3000)
 *   --width  <px>    viewport width  (default 1440)
 *   --height <px>    viewport height (default 1000)
 *   --wait <ms>      settle time after load (default 2500)
 *   --full           capture the whole scroll height, not just the viewport
 *   --webgl          software-render WebGL; required for the 3D planner
 *   --out <dir>      output directory (default .screenshots)
 *
 * Why CDP instead of `chrome --screenshot`: that flag relies on
 * --virtual-time-budget, which waits for the page to go idle. The planner runs a
 * continuous requestAnimationFrame loop, so it never goes idle and Chrome hangs
 * forever. Driving CDP lets us wait a fixed time and capture regardless.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

function findChrome() {
  const hit = CHROME_PATHS.find((p) => p && existsSync(p))
  if (!hit) {
    console.error('Could not find Chrome or Edge. Set CHROME_PATH and retry.')
    process.exit(1)
  }
  return hit
}

// ---------------------------------------------------------------- args

/**
 * Git Bash (MSYS) rewrites arguments that look like absolute paths, turning
 * "/planner" into "C:/Program Files/Git/planner". It sets EXEPATH to that
 * install dir, so we can strip it back off. A no-op in PowerShell/cmd/Linux.
 */
function demangleRoute(arg) {
  if (!process.env.EXEPATH) return arg
  const norm = (s) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const slashed = arg.replace(/\\/g, '/')
  // EXEPATH is ...\Git\bin but the prefix MSYS prepends is its parent, ...\Git.
  const roots = [process.env.EXEPATH, dirname(process.env.EXEPATH)]
  for (const root of roots) {
    const r = norm(root)
    if (norm(slashed) === r) return '/'
    if (norm(slashed).startsWith(r + '/')) {
      return '/' + slashed.slice(r.length).replace(/^\/+/, '')
    }
  }
  return arg
}

const argv = process.argv.slice(2)
const opts = {
  url: 'http://localhost:3000',
  width: 1440,
  height: 1000,
  wait: 2500,
  out: '.screenshots',
  full: false,
  webgl: false,
}
const routes = []

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--full') opts.full = true
  else if (a === '--webgl') opts.webgl = true
  else if (a === '--url') opts.url = argv[++i]
  else if (a === '--out') opts.out = argv[++i]
  else if (a === '--width') opts.width = Number(argv[++i])
  else if (a === '--height') opts.height = Number(argv[++i])
  else if (a === '--wait') opts.wait = Number(argv[++i])
  else if (a.startsWith('--')) { console.error(`Unknown option ${a}`); process.exit(1) }
  else routes.push(demangleRoute(a))
}
if (routes.length === 0) routes.push('/')

if (typeof globalThis.WebSocket !== 'function') {
  console.error('Node 22+ is required (needs the built-in WebSocket client).')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const nameFor = (route) => {
  const slug = route.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-')
  return (slug || 'home').toLowerCase()
}

// ---------------------------------------------------------------- CDP

/** Minimal JSON-RPC wrapper over a CDP WebSocket. */
function connect(wsUrl) {
  return new Promise((resolveConn, rejectConn) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
      }
    })
    ws.addEventListener('error', () => rejectConn(new Error(`WebSocket failed: ${wsUrl}`)))
    ws.addEventListener('open', () =>
      resolveConn({
        send(method, params = {}) {
          const id = nextId++
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        close: () => ws.close(),
      })
    )
  })
}

// ---------------------------------------------------------------- run

const chrome = findChrome()
const outDir = resolve(process.cwd(), opts.out)
mkdirSync(outDir, { recursive: true })

const userDataDir = resolve(tmpdir(), `shot-profile-${Date.now()}`)
const flags = [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${userDataDir}`,
  `--window-size=${opts.width},${opts.height}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--hide-scrollbars',
  // Chrome's GCM/registration chatter is noisy and irrelevant here.
  '--disable-background-networking',
]
// Software-rasterise WebGL. Without this the 3D planner renders an empty canvas
// in headless; with it, --disable-gpu must NOT be set or GL is disabled outright.
if (opts.webgl) flags.push('--use-gl=swiftshader', '--enable-unsafe-swiftshader')
else flags.push('--disable-gpu')

const proc = spawn(chrome, flags, { stdio: ['ignore', 'pipe', 'pipe'] })

// Chrome prints the browser WebSocket endpoint to stderr on startup.
const browserWs = await new Promise((res, rej) => {
  let buf = ''
  const timer = setTimeout(() => rej(new Error('Chrome did not report a debugging port')), 20000)
  proc.stderr.on('data', (chunk) => {
    buf += chunk.toString()
    const m = buf.match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-f0-9-]+/i)
    if (m) { clearTimeout(timer); res(m[0]) }
  })
  proc.on('exit', (code) => { clearTimeout(timer); rej(new Error(`Chrome exited early (${code})`)) })
})

const browser = await connect(browserWs)
const port = new URL(browserWs).port
let failures = 0

for (const route of routes) {
  const target = `${opts.url.replace(/\/+$/, '')}${route.startsWith('/') ? route : `/${route}`}`
  const file = resolve(outDir, `${nameFor(route)}.png`)

  try {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
    const page = await connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`)

    await page.send('Page.enable')
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await page.send('Page.navigate', { url: target })
    await sleep(opts.wait)

    const params = { format: 'png' }
    if (opts.full) {
      const { cssContentSize } = await page.send('Page.getLayoutMetrics')
      params.captureBeyondViewport = true
      params.clip = {
        x: 0,
        y: 0,
        width: cssContentSize.width,
        height: cssContentSize.height,
        scale: 1,
      }
    }
    const { data } = await page.send('Page.captureScreenshot', params)

    writeFileSync(file, Buffer.from(data, 'base64'))
    page.close()
    await browser.send('Target.closeTarget', { targetId })
    console.log(`  ${target}  ->  ${file}`)
  } catch (err) {
    failures++
    console.error(`  ${target}  FAILED: ${err.message}`)
  }
}

browser.close()
proc.kill()
process.exit(failures > 0 ? 1 : 0)
