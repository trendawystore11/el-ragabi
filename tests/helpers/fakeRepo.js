// Shared in-memory repository for domain-layer unit tests.
// Mirrors the legacy db.js semantics exactly:
//   - addFirestoreDoc prepends (unshift) the doc into the collection cache
//   - updateFirestoreDoc REPLACES the matching doc with { ...old, ...fields }
//   - getCollection returns the live array (updates visible immediately)
// Orchestration methods (createCustomer / updateSupplier / createPaymentRecord /
// decrementProductStock / ...) DELEGATE to the real pure domain modules through
// this repo, so the tests exercise the whole domain layer — not a mock of it.
import { generateAutoId, getCairoFormattedDate, resolveIncrementFields } from '@/utils/formatters'
import { normalizePhone } from '@/utils/phones'
import { createPaymentRecord as createPaymentRecordDomain } from '@/domain/accounting/payments'
import {
  createCustomer as createCustomerDomain,
  updateCustomer as updateCustomerDomain,
  recalculateCustomerBalance as recalculateCustomerBalanceDomain,
} from '@/domain/customers/customers'
import {
  createSupplier as createSupplierDomain,
  updateSupplier as updateSupplierDomain,
} from '@/domain/suppliers/suppliers'
import {
  createProduct as createProductDomain,
  updateProduct as updateProductDomain,
  decrementProductStock as decrementProductStockDomain,
  incrementProductStock as incrementProductStockDomain,
} from '@/domain/inventory/products'
import { logSupplierTransaction as logSupplierTransactionDomain } from '@/domain/inventory/supplierReturns'

export const STORAGE_KEYS = {
  ORDERS: 'orders',
  CUSTOMERS: 'customers',
  PRODUCTS: 'products',
  SUPPLIERS: 'suppliers',
  PAYMENTS: 'payments',
  EXPENSES: 'expenses',
  SUPPLIER_RETURNS: 'supplier_returns',
  SUPPLIER_TRANSACTIONS: 'supplier_transactions',
}

export function createFakeDb(seed = {}) {
  const cache = new Map()
  Object.keys(STORAGE_KEYS).forEach(k => {
    cache.set(STORAGE_KEYS[k], seed[STORAGE_KEYS[k]] ? seed[STORAGE_KEYS[k]].map(o => ({ ...o })) : [])
  })

  const db = {
    cache,
    getCollection(key) {
      return cache.get(key) || []
    },
    addFirestoreDoc(key, doc) {
      if (!cache.has(key)) cache.set(key, [])
      cache.get(key).unshift({ ...doc })
      return doc
    },
    updateFirestoreDoc(key, id, fields) {
      const list = cache.get(key)
      if (!list) return
      const idx = list.findIndex(item => item.id === id)
      if (idx !== -1) list[idx] = { ...list[idx], ...resolveIncrementFields(list[idx], fields) }
    },
    deleteFirestoreDoc(key, id) {
      if (cache.has(key)) cache.set(key, cache.get(key).filter(item => item.id !== id))
    },
  }
  return db
}

export function makeRepo(db) {
  const repo = {
    storageKeys: STORAGE_KEYS,
    getCollection: (key) => db.getCollection(key),
    addFirestoreDoc: (key, doc) => db.addFirestoreDoc(key, doc),
    updateFirestoreDoc: (key, id, fields) => db.updateFirestoreDoc(key, id, fields),
    deleteFirestoreDoc: (key, id) => db.deleteFirestoreDoc(key, id),

    getOrders: () => db.getCollection(STORAGE_KEYS.ORDERS),
    getOrderById: (id) => db.getCollection(STORAGE_KEYS.ORDERS).find(o => o.id === id) || null,
    getCustomers: () => db.getCollection(STORAGE_KEYS.CUSTOMERS),
    getCustomerById: (id) => db.getCollection(STORAGE_KEYS.CUSTOMERS).find(c => c.id === id) || null,
    getSuppliers: () => db.getCollection(STORAGE_KEYS.SUPPLIERS),
    getSupplierById: (id) => db.getCollection(STORAGE_KEYS.SUPPLIERS).find(s => s.id === id) || null,
    getProducts: () => db.getCollection(STORAGE_KEYS.PRODUCTS),
    getProductById: (id) => db.getCollection(STORAGE_KEYS.PRODUCTS).find(p => p.id === id || p.code === id) || null,
    getPayments: () => db.getCollection(STORAGE_KEYS.PAYMENTS),
    getPaymentsByEntity: (entityType, entityId) =>
      db.getCollection(STORAGE_KEYS.PAYMENTS).filter(p => p.entityType === entityType && p.entityId === entityId),
    getSupplierReturns: () => db.getCollection(STORAGE_KEYS.SUPPLIER_RETURNS),
    getSupplierTransactions: () => db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS),
    getSupplierTransactionsBySupplier: (supplierId) =>
      db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS).filter(t => t.supplierId === supplierId),

    findCustomerByPhone: (phone) => {
      const norm = normalizePhone(phone)
      if (!norm) return null
      return db.getCollection(STORAGE_KEYS.CUSTOMERS).find(c => {
        const p = c.phone ? normalizePhone(c.phone) : ''
        const s = c.secondaryPhone ? normalizePhone(c.secondaryPhone) : ''
        return (p && p === norm) || (s && s === norm)
      }) || null
    },
    getCustomerAddresses: (customerId) => {
      const c = db.getCollection(STORAGE_KEYS.CUSTOMERS).find(x => x.id === customerId)
      if (!c) return []
      return Array.isArray(c.addresses) ? c.addresses.filter(a => a && a.address && String(a.address).trim()) : []
    },

    createCustomer: (data) => createCustomerDomain(data, repo),
    updateCustomer: (id, fields) => updateCustomerDomain(id, fields, repo),
    createSupplier: (data) => createSupplierDomain(data, repo),
    updateSupplier: (id, fields) => updateSupplierDomain(id, fields, repo),
    createProduct: (input) => createProductDomain(input, repo),
    updateProduct: (id, data) => updateProductDomain(id, data, repo),
    decrementProductStock: (id, qty) => decrementProductStockDomain(id, qty, repo),
    incrementProductStock: (id, qty) => incrementProductStockDomain(id, qty, repo),
    createPaymentRecord: (input) => createPaymentRecordDomain(input, repo),
    logSupplierTransaction: (txn) => logSupplierTransactionDomain(txn, repo),
    recalculateCustomerBalance: (customerId) => recalculateCustomerBalanceDomain(customerId, repo),
  }
  return repo
}

export function freshSystem(seed = {}) {
  const db = createFakeDb(seed)
  return { db, repo: makeRepo(db) }
}

// Small helpers for building seed docs deterministically.
export function seedProduct({ id = 'PRD1', code = '', name = 'منتج اختباري', category = 'عام', purchasePrice = 100, sellingPrice = 250, stock = 10, minStock = 5, supplierId = '', supplierName = '' } = {}) {
  return { id, code: code || id, name, category, purchasePrice, sellingPrice, stock, minStock, supplierId, supplierName }
}

export function seedSupplier({ id = 'SUP1', name = 'مورد اختبار', phone = '01000000000', secondaryPhone = '', address = '', totalPurchases = 0, paid = 0 } = {}) {
  return { id, name, phone, secondaryPhone, address, notes: '', totalPurchases, paid, remainingBalance: Math.max(0, totalPurchases - paid) }
}

export function seedCustomer({ id = 'CUST1', name = 'عميل اختبار', phone = '01011111111', secondaryPhone = '', category = 'عميل قطاعي / فردي', address = '', addresses, ordersCount = 0, totalPurchases = 0, paid = 0, remainingBalance = 0 } = {}) {
  const addrs = addresses !== undefined ? addresses : (address ? [{ id: 'ADDR-DEFAULT', label: 'العنوان الأساسي', address, isDefault: true }] : [])
  return { id, name, phone, secondaryPhone, category, address, addresses: addrs, notes: '', ordersCount, totalPurchases, paid, remainingBalance, lastOrderDate: null, createdAt: getCairoFormattedDate(), updatedAt: getCairoFormattedDate() }
}

export function autoId(prefix) {
  return generateAutoId(prefix)
}
