import { describe, it, expect, beforeEach } from 'vitest'
import { __COMPAT_BRIDGE_VERSION } from '@/legacy/compat'

// Importing compat attaches every new module to `window` (jsdom provides it).
// These tests prove the bridge wiring is complete and behaviourally identical.

beforeEach(() => {
  // Simulate the legacy data-access layer the bridge reads at call time.
  window.getExpenses = () => []
  window.getCurrentOperatingExpenses = () => ({ total: 0 })
  window.getSupplierReturns = () => []
  window.getCustomers = () => []
  window.getSuppliers = () => []
  window.getProducts = () => []
  window.getUsers = () => []
  window.getOrders = () => orders
  window.getPayments = () => payments
  window.getCollection = (key) => collections[key] || []
  window.STORAGE_KEYS = { SUPPLIERS: 'suppliers', PAYMENTS: 'payments', ORDERS: 'orders', EXPENSES: 'expenses' }
})

const orders = [
  {
    id: 'ORD-1', status: 'delivered',
    items: [{ purchasePrice: 100, sellingPrice: 250, quantity: 2 }],
    itemsSubtotal: 500, totalAmount: 500,
    shippingCost: 30, shippingPayer: 'merchant',
    extraExpenses: 20, extraExpensesPayer: 'merchant',
    downPayment: 250, shippingRevenueDeposit: 0, refundedAmount: 0,
  },
]
const payments = []
const collections = {}

describe('compat bridge (Phase 1 wiring)', () => {
  it('version is reported', () => {
    expect(__COMPAT_BRIDGE_VERSION).toBe('0.4.0')
  })

  it('formatters are wired to window', () => {
    expect(typeof window.round2).toBe('function')
    expect(window.round2(2000.0000000001)).toBe(2000)
    expect(typeof window.toNumber).toBe('function')
    expect(window.formatCurrency).toBeDefined()
    expect(window.getCairoFormattedDate).toBeDefined()
    expect(window.generateAutoId).toBeDefined()
  })

  it('egypt helpers are wired to window', () => {
    expect(window.EGYPT_GOVERNORATES['القاهرة']).toContain('مدينة نصر')
    expect(window.CITY_CUSTOM_STORAGE_KEY).toBe('bms_trendawy_city_custom_entries')
    expect(typeof window.citySelectOptions).toBe('function')
    expect(typeof window.parseAddressComponents).toBe('function')
  })

  it('phone helpers are wired to window', () => {
    expect(window.validateEgyptianPhone('01012345678').isValid).toBe(true)
    expect(window.normalizePhone('+201012345678')).toBe('01012345678')
  })

  it('accounting engine is wired and computes via injected window deps', () => {
    const calc = window.calculateNetProfit(window.getOrders())
    expect(calc.itemsSales).toBe(500)
    expect(calc.cogs).toBe(200)
    expect(calc.netProfit).toBe(250)
  })

  it('accounting order helpers are wired', () => {
    expect(window.getOrderRemainingAmount({ status: 'delivered', totalAmount: 600, downPayment: 100 })).toBe(500)
    expect(window.isFulfilledOrderStatus('delivered')).toBe(true)
    expect(window.isActiveOrderStatus('cancelled')).toBe(false)
    expect(window.computeShippingRevenueDeposit('shipping', 40, 40, 0, 'customer', 'customer')).toBe(40)
  })

  it('payments helpers are wired', () => {
    expect(typeof window.sortPaymentsDesc).toBe('function')
    expect(window.getTotalCustomerReceivables()).toBe(250) // ORD-1: 500 − 250 down
    expect(typeof window.createPaymentRecord).toBe('function')
  })

  it('expenses helpers are wired', () => {
    expect(window.getExpenseNextDueDate({ recurring: true, dueDay: 10 }, '2026-01-05')).toBe('2026-01-10')
    const r = window.getCurrentOperatingExpenses('2026-01-05')
    expect(r.total).toBe(0)
    expect(typeof window.createExpense).toBe('function')
  })

  it('sheets service is wired to window.GoogleSheetsSync', () => {
    const ns = window.GoogleSheetsSync
    expect(ns).toBeDefined()
    expect(typeof ns.createMemoryTransport).toBe('function')
    expect(typeof ns.createWebhookTransport).toBe('function')
    expect(typeof ns.importFromFile).toBe('function')
    expect(typeof ns.exportSheetToCsv).toBe('function')
    expect(typeof ns.exportAll).toBe('function')
    expect(typeof ns.importAll).toBe('function')
    expect(typeof ns.syncNow).toBe('function')
    expect(typeof ns.scheduleSync).toBe('function')
    expect(typeof ns.flushSync).toBe('function')
    expect(typeof ns.saveConfig).toBe('function')
    expect(typeof ns.resetSyncState).toBe('function')
    expect(typeof ns.hydrateConfigFromCloud).toBe('function')
    expect(typeof window.syncWithGoogleSheets).toBe('function')
    expect(typeof window.openSpreadsheet).toBe('function')
    expect(ns.getSheetDefinitions().length).toBe(8)
  })

  it('sheets memory transport round-trips an export', async () => {
    const ns = window.GoogleSheetsSync
    const sheets = {}
    const t = ns.createMemoryTransport(sheets)
    const report = await ns.exportAll(t)
    expect(report.sheets.length).toBe(8)
    // The single mocked order (ORD-1) is exported into Orders_Sales.
    expect(report.rowsTotal).toBe(1)
    expect(sheets['Orders_Sales'].headers).toContain('إجمالي الفاتورة')
    expect(sheets['Orders_Sales'].rows).toHaveLength(1)
  })

  it('statement helpers are wired and build a reconciling ledger', () => {
    window.getCustomerById = () => ({ id: 'C-1', name: 'أحمد', phone: '01012345678', remainingBalance: 1500 })
    window.getPaymentsByEntity = () => [
      { id: 'PAY-1', amount: -200, isDownPayment: false, createdAt: '2026-01-01T10:00:00', notes: '' },
      { id: 'PAY-2', amount: 700, isDownPayment: false, createdAt: '2026-01-02T10:00:00', notes: '' },
    ]
    const rows = window.buildCustomerStatementEntries('C-1')
    // Net ledger = refund(+200) − payment(700) = −500 → opening absorbs drift.
    expect(rows[0].type).toBe('تسوية افتتاحية')
    const last = rows[rows.length - 1]
    expect(last.balance).toBe(1500) // ties exactly to stored remainingBalance
    expect(typeof window.renderCustomerStatementHTML).toBe('function')
    expect(typeof window.openSupplierStatementModal).toBe('function')
  })

  it('excel utils are wired and exportToExcel round-trips through fake XLSX', async () => {
    let written = null
    const sheet = { '!views': [] }
    window.XLSX = {
      utils: {
        json_to_sheet: () => sheet,
        book_new: () => ({ Sheets: {}, SheetNames: [] }),
        book_append_sheet: (wb, ws, name) => { wb.Sheets[name] = ws; wb.SheetNames.push(name) },
      },
      writeFile: (wb, filename) => { written = { wb, filename } },
    }
    await window.exportToExcel([{ a: 1 }], 'r.xlsx', 'التقرير')
    expect(written.filename).toBe('r.xlsx')
    expect(sheet['!views'][0].RTL).toBe(true)
    expect(typeof window.exportTableToExcel).toBe('function')
    expect(typeof window.exportFullDatabaseToExcel).toBe('function')
  })

  it('dataRepo reads collections raw (no recursion) and getPayments is wired', () => {
    // window.getCollection is the raw storage read; the bridge readers wrap
    // dataRepo().getX() which MUST come from storage, not the wrapped readers,
    // or the two mutually recurse to a stack overflow (seen in test-logic).
    // getProductById is a bridge-wired (non-stubbed) reader, so it exercises
    // the exact raw-read path that used to blow the stack.
    collections.products = [{ id: 'PRD-1', name: 'x', code: 'X', purchasePrice: 1, sellingPrice: 2, stock: 3, minStock: 0 }]
    window.STORAGE_KEYS.PRODUCTS = 'products'
    expect(window.getProductById('PRD-1').name).toBe('x')
    expect(window.getProductById('missing')).toBeNull()
    expect(Array.isArray(window.getPayments())).toBe(true)
  })

  it('generateAutoId honors a window override (harness determinism)', async () => {
    const mod = await import('@/utils/formatters')
    const real = window.generateAutoId
    try {
      window.generateAutoId = () => 'SEQ-1'
      expect(mod.generateAutoId('PAY')).toBe('SEQ-1')
    } finally {
      window.generateAutoId = real
    }
  })
})
