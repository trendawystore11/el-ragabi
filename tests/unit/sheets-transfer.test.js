import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resetSyncState, exportAll, importAll, createMemoryTransport, getSyncAuditRecords, getSheetDefinitions } from '@/services/sheets'

// V3.59 — the ENGINE (export/import/upsert/guardrails) is unchanged and
// transport-agnostic: these tests drive it through the in-memory transport
// (zero network) to prove the webhook era did not regress the two-way cycle.

const orders = [
  {
    id: 'ORD-1', status: 'delivered',
    items: [{ productId: 'PRD-1', productName: 'منتج', purchasePrice: 100, sellingPrice: 250, quantity: 2 }],
    itemsSubtotal: 500, totalAmount: 500,
    shippingCost: 30, shippingPayer: 'merchant',
    extraExpenses: 20, extraExpensesPayer: 'merchant',
    downPayment: 250, shippingRevenueDeposit: 0, refundedAmount: 0, retainedDeposit: 0,
    createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z',
  },
]
const users = [{ id: 'USR-1', name: 'موظف', email: 'u@store.com', role: 'admin', passwordHash: 'HASH-X', passwordSalt: 'SALT-Y' }]
const customers = [{ id: 'C-1', name: 'أحمد', phone: '01012345678', remainingBalance: 0 }]

beforeEach(() => {
  localStorage.clear()
  window.isSandboxMode = false
  window.getOrders = () => orders
  window.getPayments = () => []
  window.getCustomers = () => customers
  window.getSuppliers = () => []
  window.getProducts = () => []
  window.getUsers = () => users
  window.getSupplierReturns = () => []
  window.STORAGE_KEYS = { USER: 'users' }
})

afterEach(() => {
  resetSyncState()
  localStorage.clear()
})

describe('services/sheets — engine round-trip (memory transport)', () => {
  it('exportAll writes all 7 sheets and importAll restores rows into the mirror', async () => {
    const sheets = {}
    const t = createMemoryTransport(sheets)
    const report = await exportAll(t)
    expect(report.sheets.length).toBe(8)
    expect(sheets['Orders_Sales'].rows).toHaveLength(1)
    expect(sheets['Orders_Sales'].headers).toContain('إجمالي الفاتورة')

    const imp = await importAll(t)
    expect(imp.rowsImported).toBeGreaterThanOrEqual(1)
    const audit = getSyncAuditRecords()
    expect(audit.length).toBeGreaterThan(0)
  })

  it('exports the orders sheet with the invoice-total header intact', () => {
    const defs = getSheetDefinitions()
    const ord = defs.find(d => d.title === 'Orders_Sales')
    expect(ord.headers).toContain('إجمالي الفاتورة')
    expect(ord.headers).toContain('شحنات المورد (JSON)')
  })

  it('never exports user passwords and rejects imported password columns', async () => {
    const sheets = {}
    const t = createMemoryTransport(sheets)
    await exportAll(t)
    const usersSheet = sheets['Employees_Roles']
    expect(usersSheet).toBeDefined()
    const headers = usersSheet.headers
    expect(headers.some(h => String(h).toLowerCase().indexOf('password') !== -1)).toBe(false)
    expect(usersSheet.rows[0].password).toBeUndefined()

    // A malicious sheet carrying a plaintext password column must not restore it.
    const evil = createMemoryTransport({
      Employees_Roles: {
        headers: ['id', 'name', 'email', 'role', 'password'],
        rows: [{ id: 'USR-1', name: 'موظف', email: 'u@store.com', role: 'admin', password: 'PWNED' }],
      },
    })
    await importAll(evil)
    const recs = getSyncAuditRecords()
    expect(recs.some(r => r.type === 'SYNC_REJECT_FIELD')).toBe(true)
  })

  it('importAll ignores computed ledger columns (totalAmount never overwritten)', async () => {
    const sheets = {
      Orders_Sales: {
        headers: ['id', 'status', 'totalAmount', 'items'],
        rows: [{ id: 'ORD-1', status: 'delivered', totalAmount: 9999, items: JSON.stringify([{ productId: 'PRD-1', quantity: 2, sellingPrice: 250 }]) }],
      },
    }
    const t = createMemoryTransport(sheets)
    const imp = await importAll(t)
    expect(imp.rowsImported).toBeGreaterThanOrEqual(1)
    // totalAmount is a protected/computed column — the order keeps 500.
    const restored = orders.find(o => o.id === 'ORD-1')
    expect(restored.totalAmount).toBe(500)
  })

  it('expenses export the Expenses_Register sheet and guard against bad amounts', async () => {
    const expenses = [
      { id: 'EXP-1', title: 'إيجار المحل', amount: 5000, category: 'إيجار', date: '2026-08-01', notes: '', recurring: true, dueDay: 5, createdBy: 'المدير العام', createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z' },
    ]
    window.getExpenses = () => expenses
    window.STORAGE_KEYS = window.STORAGE_KEYS || {}
    window.STORAGE_KEYS.EXPENSES = 'expenses'
    window.addFirestoreDoc = (key, doc) => { if (key === 'expenses') expenses.push(doc) }
    window.updateFirestoreDoc = (key, id, fields) => {
      if (key !== 'expenses') return
      const idx = expenses.findIndex(e => e.id === id)
      if (idx !== -1) expenses[idx] = { ...expenses[idx], ...fields }
    }

    const sheets = {}
    const t = createMemoryTransport(sheets)
    await exportAll(t)
    const expSheet = sheets['Expenses_Register']
    expect(expSheet).toBeDefined()
    expect(expSheet.headers).toContain('البيان')
    expect(expSheet.rows).toHaveLength(1)
    expect(expSheet.rows[0].amount).toBe('5000')
    expect(expSheet.rows[0].recurring).toBe('نعم')

    // Guardrail: a negative amount must be rejected and never created.
    const evil = createMemoryTransport({
      Expenses_Register: {
        headers: ['id', 'title', 'amount'],
        rows: [{ id: 'EXP-9', title: 'مصروف خاطئ', amount: -100 }],
      },
    })
    const imp = await importAll(evil)
    expect(imp.errors.length).toBeGreaterThan(0)
    expect(expenses.find(e => e.id === 'EXP-9')).toBeUndefined()
  })
})
