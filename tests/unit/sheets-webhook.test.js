import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as XLSX from 'xlsx'
import {
  getConfig, saveConfig, resetSyncState,
  postToWebhook, enqueueEvent, getPendingQueue, clearPendingQueue,
  syncNow, createWebhookTransport, importFromFile, exportSheetToCsv,
} from '@/services/sheets'
import { storageKey } from '@/client/storage'
import { freshSystem, seedCustomer, STORAGE_KEYS } from '../helpers/fakeRepo'

// V3.59 — Webhook-only channel tests: the client posts JSON snapshots to an
// Apps Script webhook with fetch(..., { mode: 'no-cors' }) and keeps an event
// queue that is cleared when the request dispatches without a network error.

const WH_URL = 'https://script.google.com/macros/s/WH-TEST/exec'

beforeEach(() => {
  localStorage.clear()
  window.isSandboxMode = false
  window.getOrders = () => []
  window.getPayments = () => []
  window.getCustomers = () => []
  window.getSuppliers = () => []
  window.getProducts = () => []
  window.getUsers = () => []
  window.getSupplierReturns = () => []
  window.STORAGE_KEYS = { USER: 'users' }
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true }))
})

afterEach(() => {
  resetSyncState()
  localStorage.clear()
  delete globalThis.fetch
})

describe('services/sheets — webhook config', () => {
  it('saveConfig persists webhookUrl and drops every legacy OAuth field', () => {
    const cfg = saveConfig({
      webhookUrl: WH_URL,
      spreadsheetId: 'LEGACY-SHEET',      // legacy OAuth-era field
      clientId: 'CLIENT.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-LEGACY',
      refreshToken: '1//0legacy',
      accessToken: 'ya29.legacy',
      apiKey: 'AIza-LEGACY',
      tokenExpiresAt: 12345,
      direction: 'both',
      enabled: true,
    })
    expect(cfg.webhookUrl).toBe(WH_URL)
    expect(cfg.direction).toBe('both')
    expect(cfg.enabled).toBe(true)
    // V3.59 — no OAuth secret may survive a save (or leak into the raw storage).
    expect(cfg.spreadsheetId).toBeUndefined()
    expect(cfg.clientSecret).toBeUndefined()
    expect(cfg.refreshToken).toBeUndefined()
    expect(cfg.accessToken).toBeUndefined()
    const raw = JSON.parse(localStorage.getItem(storageKey('data_syncConfig')))
    expect(raw.webhookUrl).toBe(WH_URL)
    expect(raw.clientSecret).toBeUndefined()
    expect(JSON.stringify(raw)).not.toContain('GOCSPX-LEGACY')
    expect(JSON.stringify(raw)).not.toContain('ya29.legacy')
    expect(getConfig().webhookUrl).toBe(WH_URL)
  })

  it('a legacy V3.58 googleSheetsWebhookUrl migrates into webhookUrl', () => {
    window.localStorage.setItem(storageKey('data_syncConfig'),
      JSON.stringify({ googleSheetsWebhookUrl: WH_URL, direction: 'export' }))
    expect(getConfig().webhookUrl).toBe(WH_URL)
  })
})

describe('services/sheets — postToWebhook (fire-and-forget)', () => {
  it('POSTs a JSON body with mode no-cors and text/plain, resolves true', async () => {
    saveConfig({ webhookUrl: WH_URL })
    const ok = await postToWebhook({ type: '__ping__', sentAt: '2026-08-13 00:00' })
    expect(ok).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = globalThis.fetch.mock.calls[0]
    expect(url).toBe(WH_URL)
    expect(init.method).toBe('POST')
    expect(init.mode).toBe('no-cors')
    expect(init.headers['Content-Type']).toBe('text/plain')
    expect(JSON.parse(init.body).type).toBe('__ping__')
  })

  it('never touches the network when no webhookUrl is configured', async () => {
    const ok = await postToWebhook({ type: '__ping__' })
    expect(ok).toBe(false)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('resolves false (not throw) when the fetch itself rejects', async () => {
    saveConfig({ webhookUrl: WH_URL })
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    const ok = await postToWebhook({ type: '__ping__' })
    expect(ok).toBe(false)
  })
})

describe('services/sheets — event queue', () => {
  it('enqueueEvent appends to the queue and triggers a debounced scheduleSync', () => {
    expect(getPendingQueue()).toHaveLength(0)
    enqueueEvent({ type: 'update', entityKey: 'orders', entityId: 'ORD-9' })
    enqueueEvent({ type: 'add', entityKey: 'customers', entityId: 'C-3' })
    const q = getPendingQueue()
    expect(q).toHaveLength(2)
    expect(q[0].type).toBe('update')
    expect(q[0].entityKey).toBe('orders')
    expect(q[0].entityId).toBe('ORD-9')
    expect(q[1].type).toBe('add')
  })

  it('caps the queue at 500 events and clearPendingQueue empties it', () => {
    for (let i = 0; i < 505; i++) enqueueEvent({ type: 'op', entityId: 'x' + i })
    expect(getPendingQueue().length).toBeLessThanOrEqual(500)
    clearPendingQueue()
    expect(getPendingQueue()).toHaveLength(0)
  })
})

describe('services/sheets — syncNow over the webhook', () => {
  it('builds a full snapshot payload, posts it once, clears the queue', async () => {
    saveConfig({ webhookUrl: WH_URL, direction: 'export', enabled: true })
    enqueueEvent({ type: 'update', entityKey: 'orders', entityId: 'ORD-1' })

    const res = await syncNow()
    expect(res.direction).toBe('export')
    expect(res.exported.sheets.length).toBe(8)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = globalThis.fetch.mock.calls[0]
    expect(url).toBe(WH_URL)
    const body = JSON.parse(init.body)
    expect(body.type).toBe('snapshot')
    expect(body.sheets['Orders_Sales']).toBeDefined()
    expect(body.sheets['Orders_Sales'].headers).toContain('إجمالي الفاتورة')
    // V3.59.1 — the canonical keys travel with the payload so the Apps Script
    // can map label → value (without them every row lands blank in the sheet).
    expect(body.sheets['Orders_Sales'].keys).toContain('totalAmount')
    expect(body.pendingEvents.some(e => e.entityId === 'ORD-1')).toBe(true)
    // Queue is cleared after a dispatched request.
    expect(getPendingQueue()).toHaveLength(0)
    expect(getConfig().lastSyncStatus).toBe('success')
  })

  it('keeps the queue when the webhook fetch fails', async () => {
    saveConfig({ webhookUrl: WH_URL, direction: 'export' })
    enqueueEvent({ type: 'op', entityId: 'ORD-2' })
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network down')))
    await expect(syncNow()).rejects.toThrow()
    expect(getPendingQueue()).toHaveLength(1)
    expect(getConfig().lastSyncStatus).toBe('failed')
  })

  it('rejects an import-only sync with a clear file-import message', async () => {
    saveConfig({ webhookUrl: WH_URL, direction: 'import' })
    await expect(syncNow()).rejects.toThrow(/استورد من ملف Excel\/CSV/)
  })

  it('createWebhookTransport accumulates sheets and flush() posts them', async () => {
    saveConfig({ webhookUrl: WH_URL })
    const t = createWebhookTransport({ webhookUrl: WH_URL })
    await t.writeSheet('Orders_Sales', ['id'], [{ id: 'ORD-1' }], ['id'])
    const sent = await t.flush()
    expect(sent).toBe(true)
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
    expect(body.type).toBe('snapshot')
    expect(body.sheets['Orders_Sales'].rows).toHaveLength(1)
    expect(body.sheets['Orders_Sales'].keys).toEqual(['id'])
  })
})

describe('services/sheets — offline file import/export (CSV/Excel)', () => {
  it('exportSheetToCsv returns label-keyed rows for a sheet', () => {
    const out = exportSheetToCsv('Customers_Balances')
    expect(out.title).toBe('Customers_Balances')
    expect(out.rows).toBeInstanceOf(Array)
    expect(Object.keys(out.rows[0] || {})).not.toContain('password')
  })

  it('importFromFile upserts rows from a CSV into the matching sheet', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.CUSTOMERS]: [seedCustomer({ id: 'C-1', name: 'أحمد', phone: '01012345678' })] })
    window.getCustomers = () => repo.getCustomers()
    window.getCustomerById = repo.getCustomerById
    window.findCustomerByPhone = repo.findCustomerByPhone
    window.addFirestoreDoc = repo.addFirestoreDoc
    window.updateFirestoreDoc = repo.updateFirestoreDoc
    window.STORAGE_KEYS = { CUSTOMERS: STORAGE_KEYS.CUSTOMERS }

    const file = {
      name: 'customers.csv',
      text: () => Promise.resolve('رقم العميل (ID),اسم العميل,الهاتف الرئيسي\nC-2,سيدة,01111111111\n'),
    }
    const res = await importFromFile(file)
    expect(res.sheet).toBe('Customers_Balances')
    expect(res.rowsImported).toBe(1)
    const c2 = db.getCollection(STORAGE_KEYS.CUSTOMERS).find(c => c.id === 'C-2')
    expect(c2).toBeDefined()
    expect(c2.name).toBe('سيدة')
    // C-1 keeps its balance untouched (nothing re-imported for it).
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)).toHaveLength(2)
  })

  it('importFromFile rejects files whose columns match no system sheet', async () => {
    const file = { name: 'misc.csv', text: () => Promise.resolve('foo,bar\n1,2\n') }
    await expect(importFromFile(file)).rejects.toThrow(/لا تطابق/)
  })

  it('importFromFile rejects a null file', async () => {
    await expect(importFromFile(null)).rejects.toThrow(/اختر ملف/)
  })

  it('V3.61 importFromFile restores EVERY matching tab from a multi-sheet workbook (webhook export)', async () => {
    const { db, repo } = freshSystem()
    window.getCustomers = () => repo.getCustomers()
    window.getCustomerById = repo.getCustomerById
    window.findCustomerByPhone = repo.findCustomerByPhone
    window.getExpenses = () => db.getCollection(STORAGE_KEYS.EXPENSES)
    window.addFirestoreDoc = repo.addFirestoreDoc
    window.updateFirestoreDoc = repo.updateFirestoreDoc
    window.STORAGE_KEYS = { CUSTOMERS: STORAGE_KEYS.CUSTOMERS, EXPENSES: STORAGE_KEYS.EXPENSES }

    // Full webhook export layout — Expenses_Register tab comes FIRST so the
    // old single-match resolver would have stopped there and dropped customers.
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 'رقم المصروف (ID)': 'EXP-9', 'البيان': 'إيجار', 'المبلغ': 1200 }
    ]), 'Expenses_Register')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 'رقم العميل (ID)': 'C-9', 'اسم العميل': 'عادل', 'الهاتف الرئيسي': '01233333333' }
    ]), 'Customers_Balances')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })

    window.XLSX = XLSX
    const file = { name: 'workbook.xlsx', arrayBuffer: () => Promise.resolve(buf), text: () => Promise.resolve('') }

    const res = await importFromFile(file)
    expect(res.rowsImported).toBe(2)
    expect(res.matchedTabs).toEqual(['Expenses_Register', 'Customers_Balances'])
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS).find(c => c.id === 'C-9')).toBeDefined()
    expect(db.getCollection(STORAGE_KEYS.EXPENSES).find(e => e.id === 'EXP-9')).toBeDefined()
  })
})
