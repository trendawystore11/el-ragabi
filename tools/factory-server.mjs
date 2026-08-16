#!/usr/bin/env node
// =============================================================================
// factory-server.mjs — واجهة المصنع (Client Factory UI) — سيرفر محلي
// -----------------------------------------------------------------------------
// يفتح صفحة ويب محلية تملأ فيها بيانات العميل وتضغط "بناء" فينفّذ المصنع
// (create-client.mjs) بنفس جلسة المصنع ويعرض سجل التنفيذ حيًّا ورابط التسليم.
//
// التشغيل:
//   node tools\factory-server.mjs            # ثم افتح http://localhost:8787
//   $env:PORT=9000; node tools\factory-server.mjs
//
// الأمان: يستمع على 127.0.0.1 فقط. التوكن يُستلم من الصفحة ويُحقن كمتغير
// بيئة GITHUB_TOKEN لعملية المصنع المؤقتة فقط ولا يُكتب على القرص إطلاقًا.
// =============================================================================
import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { spawn, exec } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const HERE = resolve(dirname(fileURLToPath(import.meta.url)))
const TEMPLATE_ROOT = resolve(HERE, '..')
const FACTORY = join(HERE, 'create-client.mjs')
const UI_FILE = join(HERE, 'factory-ui.html')
const PORT = Number(process.env.PORT || 8787)
const HOST = '127.0.0.1'
const MAX_BODY = 8 * 1024 * 1024

const THEMES = ['dark', 'light', 'ocean', 'emerald', 'royal', 'coffee', 'luxury-gold', 'graphite', 'mint', 'midnight', 'deep-purple', 'light-professional']

// ── قراءة قيم القالب لملء الواجهة مسبقًا ─────────────────────────────────────
let DEFAULTS = null
try {
  const mod = await import(pathToFileURL(join(TEMPLATE_ROOT, 'src/client/config.js')).href)
  DEFAULTS = {
    appName: mod.CLIENT?.appName || '',
    tagline: mod.CLIENT?.tagline || '',
    logo: mod.CLIENT?.logo || '2.png',
    primaryColor: mod.CLIENT?.primaryColor || '#8B7CFF',
    theme: mod.CLIENT?.theme || 'graphite',
    governorate: mod.CLIENT?.region?.defaultGovernorate || 'القاهرة',
    governorates: Object.keys(mod.CLIENT?.region?.governorates || { 'القاهرة': [] }),
    currencySymbol: mod.CLIENT?.currency?.symbol || '',
    currencyLocale: mod.CLIENT?.currency?.locale || 'ar-EG',
    timeZone: mod.CLIENT?.region?.timeZone || 'Africa/Cairo',
    customerCategories: Array.isArray(mod.CLIENT?.customerCategories) ? mod.CLIENT.customerCategories : [],
    defaultCustomerCategory: mod.CLIENT?.defaultCustomerCategory || '',
    expenseCategories: Array.isArray(mod.CLIENT?.expenseCategories) ? mod.CLIENT.expenseCategories : [],
    direction: mod.SHEETS_SYNC_CONFIG?.direction || 'export',
    frequency: mod.SHEETS_SYNC_CONFIG?.frequency || 'every-op',
    aiModel: mod.AI_CONFIG?.model || 'gemini-3.1-flash-lite',
    themes: THEMES,
    templateRoot: TEMPLATE_ROOT,
    outDirBase: 'E:\\محمد\\سييتم علاء\\Projects',
  }
} catch (e) {
  console.error('تعذّر قراءة قالب السيستم:', e.message)
  process.exit(1)
}

// ── أدوات ────────────────────────────────────────────────────────────────────
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (c) => {
      buf += c
      if (buf.length > MAX_BODY) { reject(new Error('الطلب كبير جداً')); req.destroy() }
    })
    req.on('end', () => resolve(buf))
    req.on('error', reject)
  })
}

const FLAG_MAP = {
  clientId: '--name',
  appName: '--appName',
  tagline: '--tagline',
  logo: '--logo',
  primaryColor: '--primaryColor',
  theme: '--theme',
  governorate: '--governorate',
  customerCategories: '--customerCategories',
  defaultCategory: '--defaultCategory',
  expenseCategories: '--expenseCategories',
  currencyLocale: '--currencyLocale',
  timeZone: '--timeZone',
  fbApiKey: '--fbApiKey',
  fbAuthDomain: '--fbAuthDomain',
  fbProjectId: '--fbProjectId',
  fbBucket: '--fbBucket',
  fbSenderId: '--fbSenderId',
  fbAppId: '--fbAppId',
  fbMeasurementId: '--fbMeasurementId',
  webhookUrl: '--webhookUrl',
  syncDirection: '--syncDirection',
  syncFrequency: '--syncFrequency',
  geminiKey: '--geminiKey',
  aiModel: '--aiModel',
  backupOwnerEmail: '--backupOwnerEmail',
  repoName: '--repo',
  outDir: '--out',
}

// ── السيرفر ──────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + HOST)

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    if (!existsSync(UI_FILE)) return json(res, 500, { error: 'factory-ui.html غير موجود بجانب السيرفر' })
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(readFileSync(UI_FILE))
    return
  }

  if (req.method === 'GET' && url.pathname === '/defaults') {
    return json(res, 200, DEFAULTS)
  }

  if (req.method === 'POST' && url.pathname === '/build') {
    let body
    try { body = JSON.parse(await readBody(req)) } catch (e) { return json(res, 400, { error: 'بيانات غير صالحة' }) }

    const token = String(body.token || '').trim()
    const dryRun = !!body.dryRun
    const fields = body.fields || {}

    if (!token && !dryRun) return json(res, 400, { error: 'أدخل GITHUB_TOKEN أولاً (أو فعّل الوضع التجريبي)' })
    const clientId = String(fields.clientId || '').trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]*$/.test(clientId)) {
      return json(res, 400, { error: 'معرّف العميل (clientId) مطلوب: حروف/أرقام/شرطات فقط وابدأ بحرف' })
    }

    // مجلد المشروع: صريح من المستخدم أو افتراضي E:\...\Projects\<اسم المتجر>
    const sanitizeFolder = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').trim()
    const appName = String(fields.appName || '').trim() || clientId
    const outDir = String(fields.outDir || '').trim() || join(DEFAULTS.outDirBase, sanitizeFolder(appName))
    if (!dryRun && existsSync(outDir)) {
      return json(res, 400, { error: `المجلد موجود مسبقاً: ${outDir}\nاختر اسم مستودع/مجلد مختلف أو احذف المجلد القديم أولاً.` })
    }

    // اللوجو المرفوع: فك ترميز base64 وكتابته كملف مؤقت يُمرَّر للمصنع ليُنسخ بعد نسخ القالب
    let logoFile = ''
    const logo = body.logo
    if (logo && logo.dataUrl && logo.name) {
      try {
        const b64 = String(logo.dataUrl).replace(/^data:[^;]+;base64,/, '')
        const ext = (String(logo.name).match(/\.([a-z0-9]{2,5})$/i) || [])[1] || 'png'
        logoFile = join(os.tmpdir(), `client-factory-logo-${clientId}-${Date.now()}.${ext}`)
        writeFileSync(logoFile, Buffer.from(b64, 'base64'))
        fields.logo = String(logo.name).replace(/[\\/]/g, '_')
      } catch (e) {
        return json(res, 400, { error: 'تعذّر معالجة ملف اللوجو المرفوع: ' + e.message })
      }
    }

    // ملف مفتاح الخدمة (service account JSON): ملف مؤقت يُمرَّر للمصنع لتوليد backup .gs
    let backupSaFile = ''
    const backupSa = body.backupSa
    if (backupSa && backupSa.content) {
      try {
        const content = String(backupSa.content)
        JSON.parse(content) // تحقق سريع من صلاحية JSON قبل التخزين
        backupSaFile = join(os.tmpdir(), `client-factory-sa-${clientId}-${Date.now()}.json`)
        writeFileSync(backupSaFile, content, 'utf8')
      } catch (e) {
        return json(res, 400, { error: 'ملف مفتاح الخدمة ليس JSON صالحاً: ' + e.message })
      }
    }

    const flags = []
    for (const [key, flag] of Object.entries(FLAG_MAP)) {
      let v = fields[key]
      if (Array.isArray(v)) v = v.join(',')
      if (typeof v === 'string' && v.trim() !== '') flags.push(flag, v.trim())
    }
    // رمز العملة: يُرسل دائماً حتى وإن كان فارغاً (فارغ = النظام بلا عملة).
    if (Object.prototype.hasOwnProperty.call(fields, 'currencySymbol')) {
      flags.push('--currencySymbol', String(fields.currencySymbol ?? ''))
    }
    flags.push('--out', outDir)
    if (logoFile) flags.push('--logoFile', logoFile)
    if (backupSaFile) flags.push('--backupSaFile', backupSaFile)
    if (dryRun) flags.push('--dry-run')

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.write(`━━━ بدء بناء العميل: ${clientId} ━━━\n`)
    res.write(`القالب: ${TEMPLATE_ROOT}\n${dryRun ? '[وضع تجريبي — لن يُنشأ أو يُرفع أي شيء]\n' : ''}`)

    const env = { ...process.env, GITHUB_TOKEN: token }
    const child = spawn(process.execPath, [FACTORY, ...flags], { env, cwd: TEMPLATE_ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

    let full = ''
    child.stdout.on('data', (d) => { full += d; res.write(d) })
    child.stderr.on('data', (d) => { full += d; res.write(d) })
    child.on('error', (e) => { res.write(`\nخطأ في تشغيل المصنع: ${e.message}\n`) })
    child.on('close', (code) => {
      if (logoFile) { try { rmSync(logoFile, { force: true }) } catch {} }
      if (backupSaFile) { try { rmSync(backupSaFile, { force: true }) } catch {} }
      const linkMatch = full.match(/https:\/\/\S+\.github\.io\/[^\s/]+/)
      if (linkMatch) res.write(`\n✅ الرابط الجاهز: ${linkMatch[0]}\n`)
      res.end(`\n━━━ انتهى التنفيذ (رمز ${code}) ${code === 0 ? '— نجح ✓' : '— راجع السجل أعلاه'} ━━━\n`)
    })

    req.on('close', () => { if (!child.killed && child.exitCode === null) child.kill() })
    return
  }

  return json(res, 404, { error: 'غير موجود' })
})

server.listen(PORT, HOST, () => {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Client Factory UI')
  console.log(`  القالب: ${TEMPLATE_ROOT}`)
  console.log(`  افتح:  http://${HOST}:${PORT}`)
  console.log('  أوقفه:  Ctrl+C  |  مدة الحساسية: محلي فقط')
  console.log('═══════════════════════════════════════════════════')
  if (process.platform === 'win32' && process.env.FACTORY_NO_OPEN !== '1') {
    try { exec(`start "" "http://${HOST}:${PORT}"`) } catch { /* تجاهل */ }
  }
})
