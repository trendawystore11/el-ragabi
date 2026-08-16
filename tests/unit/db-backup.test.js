import { describe, it, expect, beforeEach, vi } from 'vitest'
import { exportFullBackup, importFullBackup, getCollection, firestoreCache } from '@/services/db'

// V3.60 — FULL JSON BACKUP/RESTORE: a complete byte-for-byte copy of every
// synced collection (the CSV/Excel path only covers the 8 sheet tables and
// re-derives fields). Access-control collections (staff/settings) are never
// part of business data and are deliberately excluded — same guard as the wipe.

const KEYS = {
  PRODUCTS: 'products',
  CUSTOMERS: 'customers',
  SUPPLIERS: 'suppliers',
  ORDERS: 'orders',
  PAYMENTS: 'payments',
  USER: 'users',
  SUPPLIER_RETURNS: 'supplierReturns',
  SUPPLIER_TRANSACTIONS: 'supplierTransactions',
  EXPENSES: 'expenses',
}

const products = [
  { id: 'PRD-1', name: 'منتج أ', purchasePrice: 100, sellingPrice: 250, stock: 5, updatedAt: '2026-08-01' },
]
const customers = [{ id: 'C-1', name: 'أحمد', phone: '01012345678', remainingBalance: 350 }]
const orders = [
  {
    id: 'ORD-1', status: 'delivered',
    items: [{ productId: 'PRD-1', productName: 'منتج أ', purchasePrice: 100, sellingPrice: 250, quantity: 2 }],
    itemsSubtotal: 500, totalAmount: 500,
    shippingCost: 30, shippingPayer: 'merchant',
    downPayment: 250,
    createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z',
  },
]
const expenses = [{ id: 'EXP-1', title: 'إيجار المحل', amount: 5000, category: 'إيجار', date: '2026-08-01', recurring: true, dueDay: 5, createdBy: 'المدير العام', createdAt: '2026-08-01T10:00:00Z' }]

beforeEach(() => {
  localStorage.clear()
  Object.keys(firestoreCache).forEach(k => { firestoreCache[k] = [] })
  window.isSandboxMode = false
  window.STORAGE_KEYS = { ...KEYS }
  window.db = null
})

describe('services/db — full JSON backup / restore', () => {
  it('exports every collection as-is (byte-for-byte, incl. stored hashes)', () => {
    const seed = {
      products,
      customers,
      orders,
      expenses,
      users: [{ id: 'USR-1', name: 'موظف', email: 'u@store.com', role: 'admin', passwordHash: 'HASH-X', passwordSalt: 'SALT-Y' }],
    }
    Object.keys(seed).forEach(key => {
      window.firestoreCache[key] = seed[key]
      localStorage.setItem('bms_trendawy_data_' + key, JSON.stringify(seed[key]))
    })

    const backup = exportFullBackup()

    expect(backup.type).toBe('full-backup')
    expect(backup.exportedAt).toBeDefined()
    expect(backup.collections.products).toEqual(seed.products)
    expect(backup.collections.orders).toEqual(seed.orders)
    expect(backup.collections.expenses).toEqual(seed.expenses)
    expect(backup.collections.users).toEqual(seed.users)
    // Every synced collection key is present (empty arrays included).
    expect(Object.keys(backup.collections).sort()).toEqual(Object.values(KEYS).sort())
    // Access-control collections are never exported.
    expect(backup.collections.staff).toBeUndefined()
    expect(backup.collections.settings).toBeUndefined()
  })

  it('imports a backup wholesale into local mirrors, preserving hashes', () => {
    const backup = {
      app: 'bms',
      type: 'full-backup',
      version: 1,
      exportedAt: '2026-08-13',
      collections: {
        products,
        customers,
        orders,
        expenses,
        users: [{ id: 'USR-1', name: 'موظف', email: 'u@store.com', role: 'admin', passwordHash: 'HASH-X', passwordSalt: 'SALT-Y' }],
        junk_collection: [{ id: 'X' }],
      },
    }

    const report = importFullBackup(backup)

    expect(report.collections).toBe(5)
    expect(report.records).toBe(5)
    expect(report.skipped).toEqual(['junk_collection'])
    expect(getCollection('products')).toEqual(products)
    expect(getCollection('orders')).toEqual(orders)
    expect(getCollection('expenses')).toEqual(expenses)
    // Stored hashes survive the restore — unlike the CSV path (default password).
    expect(getCollection('users')[0].passwordHash).toBe('HASH-X')
    // Local mirror file was rewritten too.
    expect(JSON.parse(localStorage.getItem('bms_trendawy_data_products'))).toEqual(products)
  })

  it('rejects malformed payloads and sandbox mode', () => {
    expect(() => importFullBackup(null)).toThrow(/غير صالح/)
    expect(() => importFullBackup({})).toThrow(/غير صالح/)
    expect(() => importFullBackup({ collections: 'nope' })).toThrow(/غير صالح/)
    window.isSandboxMode = true
    expect(() => importFullBackup({ collections: { products } })).toThrow(/وضع الاختبار/)
  })

  it('pushes restored docs to Firestore when a connection exists', () => {
    const setMock = vi.fn(() => Promise.resolve())
    const docMock = { set: setMock }
    window.db = {
      collection: () => ({ doc: () => docMock }),
    }

    importFullBackup({ collections: { products, customers } })

    expect(setMock).toHaveBeenCalledTimes(2)
    setMock.mock.calls.forEach(call => {
      expect(call[1]).toEqual({ merge: true })
    })
  })
})
