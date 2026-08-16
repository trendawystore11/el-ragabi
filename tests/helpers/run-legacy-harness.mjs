// =============================================================================
// run-legacy-harness.mjs — drives the 7 legacy reference harnesses through the
// REAL installed Chrome via puppeteer-core, waits for the actual result marker
// (no --virtual-time-budget race), extracts the summary and writes BASELINE.txt.
// Usage: node tests/helpers/run-legacy-harness.mjs
// Exit code 1 if any harness failed (failed > 0) or errored.
// =============================================================================
import { launch } from 'puppeteer-core'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const legacyDir = path.join(repo, 'tests', 'legacy')
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const HARNESSES = [
  { name: 'features-test', file: 'features-test.html', ready: '#o' },
  { name: 'e2e-runner', file: 'e2e-runner.html', ready: '#o' },
  { name: 'test-logic', file: 'test-logic.html', ready: '#summary' },
  { name: 'audit-test', file: 'audit-test.html', ready: '#o' },
  { name: 'phone2-test', file: 'phone2-test.html', ready: '#o' },
  { name: 'orders-filter', file: 'orders-filter-test.html', ready: '#o' },
  { name: 'sandbox-test', file: 'sandbox-test.html', ready: '#o' },
]

const RESULT_RE = /(?:Total:\s*(\d+)|total=\s*(\d+)).*?(?:Failed:\s*(\d+)|failed=\s*(\d+))/i
const DONE_RE = /Total:|total=|HAS_FAILURES|ALL_PASS/i

async function runHarness(browser, h, timeoutMs) {
  const url = 'file:///' + path.join(legacyDir, h.file).replace(/\\/g, '/').replace(/ /g, '%20')
  const page = await browser.newPage()
  page.setDefaultTimeout(timeoutMs)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(String(m.text()))
  })

  await page.goto(url, { waitUntil: 'load', timeout: timeoutMs })

  // Wait for the result marker (real time, poll-based).
  const deadline = Date.now() + timeoutMs
  let text = ''
  while (Date.now() < deadline) {
    try {
      text = await page.$eval(h.ready, (el) => el.textContent || '')
    } catch {
      text = ''
    }
    if (DONE_RE.test(text) && !/running/.test(text)) break
    if (/TOPLEVEL_ERROR|RUNALL_ERROR|Uncaught/.test(text)) break
    await new Promise((r) => setTimeout(r, 300))
  }

  await page.close()

  const tm = text.match(RESULT_RE)
  if (tm) {
    const total = tm[1] !== undefined ? Number(tm[1]) : Number(tm[2])
    const failed = tm[3] !== undefined ? Number(tm[3]) : Number(tm[4])
    return { status: failed === 0 ? 'PASS' : 'FAIL', total, failed, text: text.slice(0, 120) }
  }
  return { status: 'ERROR', total: -1, failed: -1, text: text.slice(0, 200) }
}

const browser = await launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-background-networking', '--disable-extensions'],
})

const lines = []
let grandTotal = 0
let grandFailed = 0
let grandErrors = 0
for (const h of HARNESSES) {
  let r
  try {
    r = await runHarness(browser, h, 180000)
  } catch (e) {
    r = { status: 'ERROR', total: -1, failed: -1, text: String(e) }
  }
  grandTotal += r.total
  grandFailed += r.failed
  if (r.status === 'ERROR') grandErrors++
  const line = `${h.name} | ${r.status} | Total=${r.total} Failed=${r.failed}`
  lines.push(line)
  console.log(line)
  if (r.status !== 'PASS') console.log(`   -> ${r.text}`)
}

await browser.close()

const summary = `GRAND | ${grandErrors === 0 && grandFailed === 0 ? 'PASS' : 'FAIL'} | Total=${grandTotal} Failed=${grandFailed}`
lines.push(summary)
console.log(summary)

const header = [
  '# BASELINE - reference parity target (Phase 0)',
  `# recorded: ${new Date().toISOString()}`,
  '# Any phase that does NOT match Total/Failed below is FAILED.',
]
writeFileSync(path.join(repo, 'tests', 'BASELINE.txt'), [...header, ...lines].join('\n') + '\n', 'utf8')
console.log('BASELINE.txt written:', path.join(repo, 'tests', 'BASELINE.txt'))

process.exit(grandFailed === 0 && grandErrors === 0 ? 0 : 1)
