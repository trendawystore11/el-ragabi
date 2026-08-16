import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { importFromFile } from '@/services/sheets'
import { freshSystem, STORAGE_KEYS } from '../helpers/fakeRepo'
import { validateEgyptianPhone } from '@/utils/phones'
import { findDuplicateProduct } from '@/domain/inventory/products'
import { assertCustomerPhoneAvailable } from '@/domain/customers/customers'
import { assertSupplierPhoneAvailable } from '@/domain/suppliers/suppliers'
import { recalculateAllCustomerBalances, recalculateCustomerBalance } from '@/domain/customers/customers'

describe('simulate real user env: seeded admin USR-1001 before import', () => {
  let db, repo, res
  beforeAll(async () => {
    const sys = freshSystem({})
    db = sys.db
    repo = sys.repo
    const seedAdmin = {
      id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', role: 'admin',
      createdAt: '2026-07-01T10:00:00Z', updatedAt: '2026-07-01T10:00:00Z', syncUpdatedAt: '2026-07-01T10:00:00Z',
    }
    db.addFirestoreDoc('users', seedAdmin)

    window.getOrders = () => repo.getOrders()
    window.getPayments = () => repo.getPayments()
    window.getCustomers = () => repo.getCustomers()
    window.getSuppliers = () => repo.getSuppliers()
    window.getProducts = () => repo.getProducts()
    window.getUsers = () => db.getCollection('users')
    window.getSupplierReturns = () => repo.getSupplierReturns()
    window.getExpenses = () => db.getCollection(STORAGE_KEYS.EXPENSES)
    window.getCollection = repo.getCollection
    window.addFirestoreDoc = repo.addFirestoreDoc
    window.updateFirestoreDoc = repo.updateFirestoreDoc
    window.getCustomerById = repo.getCustomerById
    window.getSupplierById = repo.getSupplierById
    window.findCustomerByPhone = repo.findCustomerByPhone
    window.getCustomerAddresses = repo.getCustomerAddresses
    window.validateEgyptianPhone = validateEgyptianPhone
    window.assertCustomerPhoneAvailable = (phone, secondary, excludeId) =>
      assertCustomerPhoneAvailable(repo.getCustomers(), phone, secondary, excludeId)
    window.assertSupplierPhoneAvailable = (phone, secondary, excludeId) =>
      assertSupplierPhoneAvailable(repo.getSuppliers(), phone, secondary, excludeId)
    window.findDuplicateProduct = (args) => findDuplicateProduct(repo.getProducts(), args)
    window.recalculateAllCustomerBalances = () => recalculateAllCustomerBalances(repo)
    window.recalculateCustomerBalance = (id) => recalculateCustomerBalance(id, repo)
    window.round2 = (await import('@/utils/formatters')).round2
    window.STORAGE_KEYS = { ...STORAGE_KEYS, USER: 'users' }
    window.XLSX = XLSX

    const buf = new Uint8Array(readFileSync(new URL('file://' + process.cwd() + '/test1-600.xlsx')))
    const file = { name: 'test1-600.xlsx', arrayBuffer: () => Promise.resolve(buf), text: () => Promise.resolve('') }
    res = await importFromFile(file)
  })

  it('prints user-env import result', () => {
    const users = db.getCollection('users')
    const out = {
      rowsImported: res.rowsImported,
      rowsSkipped: res.rowsSkipped,
      errors: res.errors,
      perSheet: res.sheets.map(s => ({ label: s.label, rows: s.rows, imported: s.imported, skipped: s.skipped })),
      usersAfter: users.map(u => ({ id: u.id, email: u.email, role: u.role })),
    }
    console.log('USER-ENV-JSON:', JSON.stringify(out))
    expect(1).toBe(1)
  })
})
