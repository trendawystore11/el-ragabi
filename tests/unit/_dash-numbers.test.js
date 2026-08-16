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
import { calculateNetProfit } from '@/domain/accounting/accounting'
import { getTotalCustomerReceivables, getTotalSupplierPayables } from '@/domain/accounting/payments'
import { getOpenOrdersCount, getTotalSalesAmount } from '@/domain/orders/orderRepository'
import { getLowStockProducts } from '@/domain/inventory/products'
import { getCurrentOperatingExpenses, getTotalExpenses } from '@/domain/accounting/expenses'
import { computeTreasury, filterOrdersSmart } from '@/state/reportsStore'
import { round2, toNumber, formatCurrency } from '@/utils/formatters'

describe('compute dashboard numbers (temp)', () => {
  let db, repo, res
  const orders = () => db.getCollection(STORAGE_KEYS.ORDERS)
  const payments = () => db.getCollection(STORAGE_KEYS.PAYMENTS)
  const customers = () => db.getCollection(STORAGE_KEYS.CUSTOMERS)
  const suppliers = () => db.getCollection(STORAGE_KEYS.SUPPLIERS)
  const products = () => db.getCollection(STORAGE_KEYS.PRODUCTS)
  const users = () => db.getCollection('users')
  const returns = () => db.getCollection(STORAGE_KEYS.SUPPLIER_RETURNS)
  const expenses = () => db.getCollection(STORAGE_KEYS.EXPENSES)

  beforeAll(async () => {
    const sys = freshSystem({ users: [] })
    db = sys.db
    repo = sys.repo
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
    window.getCurrentOperatingExpenses = () => getCurrentOperatingExpenses(window.getExpenses())
    window.round2 = round2
    window.STORAGE_KEYS = {
      ORDERS: STORAGE_KEYS.ORDERS,
      CUSTOMERS: STORAGE_KEYS.CUSTOMERS,
      PRODUCTS: STORAGE_KEYS.PRODUCTS,
      SUPPLIERS: STORAGE_KEYS.SUPPLIERS,
      PAYMENTS: STORAGE_KEYS.PAYMENTS,
      EXPENSES: STORAGE_KEYS.EXPENSES,
      SUPPLIER_RETURNS: STORAGE_KEYS.SUPPLIER_RETURNS,
      USER: 'users',
    }
    window.XLSX = XLSX

    const buf = new Uint8Array(readFileSync(new URL('file://' + process.cwd() + '/test1-600.xlsx')))
    const file = { name: 'test1-600.xlsx', arrayBuffer: () => Promise.resolve(buf), text: () => Promise.resolve('') }
    res = await importFromFile(file)
  })

  it('prints all dashboard + report numbers', () => {
    const calc = calculateNetProfit(orders(), {
      getExpenses: () => window.getExpenses(),
      getCurrentOperatingExpenses: () => window.getCurrentOperatingExpenses(),
      getSupplierReturns: () => window.getSupplierReturns(),
    })
    const opExp = getCurrentOperatingExpenses(expenses())
    const treasury = computeTreasury(payments(), orders())
    const invValuation = round2(products().reduce((s, p) => s + Math.max(0, toNumber(p.stock)) * toNumber(p.purchasePrice), 0))
    const receivables = getTotalCustomerReceivables(orders())
    const payables = getTotalSupplierPayables(suppliers())
    const pending = orders().filter(o => o.status === 'new')
    const lowStock = getLowStockProducts(products())
    const statusCounts = {}
    orders().forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1 })
    const payByType = {}
    payments().forEach(p => {
      const t = String(p.entityType)
      payByType[t] = payByType[t] || { count: 0, sum: 0 }
      payByType[t].count++
      payByType[t].sum = round2(payByType[t].sum + toNumber(p.amount))
    })

    const out = {
      today: new Date().toISOString().slice(0, 10),
      import: { rowsImported: res.rowsImported, rowsSkipped: res.rowsSkipped, errors: res.errors, matchedTabs: res.matchedTabs },
      counts: {
        orders: orders().length, payments: payments().length, customers: customers().length,
        suppliers: suppliers().length, products: products().length, users: users().length,
        returns: returns().length, expenses: expenses().length,
      },
      orderStatuses: statusCounts,
      dashboard: {
        grossSales: calc.grossSales,
        inventoryValuation: invValuation,
        netProfit: calc.netProfit,
        customerReceivables: receivables,
        supplierPayables: payables,
        openOrdersCount: getOpenOrdersCount(orders()),
        lowStockCount: lowStock.length,
        shippingRevenueIncome: calc.shippingRevenueIncome,
        pendingCount: pending.length,
        pendingCollectedDeposits: round2(pending.reduce((s, o) => s + toNumber(o.downPayment), 0)),
      },
      profitReport: {
        totalSales: calc.totalSales,
        grossSales: calc.grossSales,
        itemsSales: calc.itemsSales,
        customerShippingTotal: calc.customerShippingTotal,
        customerExtraExpensesTotal: calc.customerExtraExpensesTotal,
        cogs: calc.cogs,
        merchantShippingTotal: calc.merchantShippingTotal,
        merchantExtraExpensesTotal: calc.merchantExtraExpensesTotal,
        merchantExpenses: calc.merchantExpenses,
        grossProfit: calc.grossProfit,
        totalOpExpenses: calc.totalOpExpenses,
        retainedDepositIncome: calc.retainedDepositIncome,
        shippingRevenueIncome: calc.shippingRevenueIncome,
        supplierCashRefunds: calc.supplierCashRefunds,
        netProfit: calc.netProfit,
      },
      operatingExpenses: {
        oneTime: opExp.oneTime,
        recurringThisMonth: opExp.recurringThisMonth,
        recurringFuture: opExp.recurringFuture,
        total: opExp.total,
        allExpensesTotal: getTotalExpenses(expenses()),
      },
      treasury: treasury,
      balances: {
        customersPaid: round2(customers().reduce((s, c) => s + toNumber(c.paid), 0)),
        customersRemaining: round2(customers().reduce((s, c) => s + toNumber(c.remainingBalance), 0)),
        customersTotalPurchases: round2(customers().reduce((s, c) => s + toNumber(c.totalPurchases), 0)),
        suppliersPaid: round2(suppliers().reduce((s, c) => s + toNumber(c.paid), 0)),
        suppliersRemaining: round2(suppliers().reduce((s, c) => s + toNumber(c.remainingBalance), 0)),
        suppliersTotalPurchases: round2(suppliers().reduce((s, c) => s + toNumber(c.totalPurchases), 0)),
      },
      paymentsByEntity: payByType,
    }
    console.log('DASH-NUMBERS-JSON:', JSON.stringify(out))
    expect(1).toBe(1)
  })

  it('prints reports-tab numbers (default last-30-days filter)', () => {
    const filtered = filterOrdersSmart(orders(), null, null)
    const calc = calculateNetProfit(filtered, {
      getExpenses: () => window.getExpenses(),
      getCurrentOperatingExpenses: () => window.getCurrentOperatingExpenses(),
      getSupplierReturns: () => window.getSupplierReturns(),
    })
    const pending = filtered.filter(o => o.status === 'new')
    const out = {
      filteredOrders: filtered.length,
      itemsSales: calc.itemsSales,
      totalSales: calc.grossSales,
      cogs: calc.cogs,
      merchantExpenses: calc.merchantExpenses,
      totalOpExpenses: calc.totalOpExpenses,
      retainedDepositIncome: calc.retainedDepositIncome,
      shippingRevenueIncome: calc.shippingRevenueIncome,
      supplierCashRefunds: calc.supplierCashRefunds,
      netProfit: calc.netProfit,
      pendingOrders: pending.length,
      pendingTotalValue: round2(pending.reduce((s, o) => s + toNumber(o.totalAmount), 0)),
      pendingCollectedDeposits: round2(pending.reduce((s, o) => s + toNumber(o.downPayment), 0)),
      customerShippingTotal: calc.customerShippingTotal,
      customerExtraExpensesTotal: calc.customerExtraExpensesTotal,
      minDate: filtered.reduce((a, o) => (a < o.createdAt ? a : o.createdAt), '9999'),
      maxDate: filtered.reduce((a, o) => (a > o.createdAt ? a : o.createdAt), ''),
    }
    console.log('REPORT-TAB-JSON:', JSON.stringify(out))
    expect(1).toBe(1)
  })
})
