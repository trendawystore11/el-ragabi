import { describe, it, expect } from 'vitest'
import {
  calculateNetProfit, computeShippingRevenueDeposit, getOrderShippingRevenue,
  getOrderRetainedShippingDeposit, getOrderRemainingAmount,
  isFulfilledOrderStatus, isActiveOrderStatus,
} from '@/domain/accounting/accounting'
import {
  sortPaymentsDesc, getPaymentsByEntity, getTotalCustomerReceivables,
  getTotalSupplierPayables, getTotalPaymentsCollected, createPaymentRecord,
} from '@/domain/accounting/payments'
import { getExpenseNextDueDate, getCurrentOperatingExpenses } from '@/domain/accounting/expenses'
import { freshSystem, seedCustomer, STORAGE_KEYS } from '../helpers/fakeRepo'

const EMPTY_DEPS = {
  getExpenses: () => [],
  getCurrentOperatingExpenses: () => ({ total: 0 }),
  getSupplierReturns: () => [],
}

// Order shape mirrors what window.createOrder produces (test-logic Suite A).
function makeOrder({ status = 'delivered', items, itemsSubtotal, totalAmount, shippingCost = 0, shippingPayer = 'merchant', extraExpenses = 0, extraExpensesPayer = 'merchant', downPayment = 0, shippingRevenueDeposit = 0, refundedAmount = 0, retainedDeposit }) {
  const o = {
    status, items, itemsSubtotal,
    totalAmount: totalAmount != null ? totalAmount : itemsSubtotal,
    shippingCost, shippingPayer, extraExpenses, extraExpensesPayer,
    downPayment, shippingRevenueDeposit, refundedAmount,
  }
  if (retainedDeposit !== undefined) o.retainedDeposit = retainedDeposit
  return o
}

describe('accounting.calculateNetProfit (parity with test-logic Tests 1-2)', () => {
  it('Test 1: pure merchandise profit — 500 − COGS 200 − merchant exp 50 = 250', () => {
    const order = makeOrder({
      items: [{ purchasePrice: 100, sellingPrice: 250, quantity: 2 }],
      itemsSubtotal: 500,
      shippingCost: 30, shippingPayer: 'merchant',
      extraExpenses: 20, extraExpensesPayer: 'merchant',
    })
    const calc = calculateNetProfit([order], EMPTY_DEPS)
    expect(calc.itemsSales).toBe(500)
    expect(calc.cogs).toBe(200)
    expect(calc.merchantShippingTotal).toBe(30)
    expect(calc.merchantExtraExpensesTotal).toBe(20)
    expect(calc.netProfit).toBe(250)
  })

  it('Test 2: client pass-through — invoice 570, profit stays 500 − 200 = 300', () => {
    const order = makeOrder({
      items: [{ purchasePrice: 100, sellingPrice: 250, quantity: 2 }],
      itemsSubtotal: 500, totalAmount: 570,
      shippingCost: 40, shippingPayer: 'customer',
      extraExpenses: 30, extraExpensesPayer: 'customer',
    })
    expect(order.totalAmount).toBe(570)
    const calc = calculateNetProfit([order], EMPTY_DEPS)
    expect(calc.totalSales).toBe(570)
    expect(calc.itemsSales).toBe(500)
    expect(calc.merchantShippingTotal).toBe(0)
    expect(calc.merchantExtraExpensesTotal).toBe(0)
    expect(calc.netProfit).toBe(300)
  })

  it('only fulfilled orders (delivered/completed) count toward sales; pending excluded', () => {
    const delivered = makeOrder({ items: [{ purchasePrice: 100, sellingPrice: 250, quantity: 1 }], itemsSubtotal: 250 })
    const pending = makeOrder({ status: 'new', items: [{ purchasePrice: 100, sellingPrice: 250, quantity: 5 }], itemsSubtotal: 1250 })
    const calc = calculateNetProfit([delivered, pending], EMPTY_DEPS)
    expect(calc.itemsSales).toBe(250)
    expect(calc.cogs).toBe(100)
  })

  it('returned orders deduct merchant shipping but never count as sales', () => {
    const returned = makeOrder({
      status: 'returned',
      items: [{ purchasePrice: 100, sellingPrice: 250, quantity: 2 }],
      itemsSubtotal: 500,
      shippingCost: 30, shippingPayer: 'merchant',
      retainedDeposit: 250,
    })
    const calc = calculateNetProfit([returned], EMPTY_DEPS)
    expect(calc.itemsSales).toBe(0)
    expect(calc.cogs).toBe(0)
    expect(calc.merchantShippingTotal).toBe(30)
  })

  it('supplier cash refunds count toward treasury inflow but NEVER add to net profit', () => {
    const order = makeOrder({ items: [{ purchasePrice: 100, sellingPrice: 250, quantity: 1 }], itemsSubtotal: 250 })
    const deps = { ...EMPTY_DEPS, getSupplierReturns: () => [
      { refundType: 'cash', totalValue: 150, cashRefund: 150 },
      { refundType: 'debt', totalValue: 999, cashRefund: 0 },
    ] }
    const calc = calculateNetProfit([order], deps)
    // netProfit = (250 − 100) — إرجاع بضاعة لا يولّد دخلاً والكاش المقبوض وارد خزينة فقط
    expect(calc.supplierCashRefunds).toBe(150)
    expect(calc.netProfit).toBe(150)
  })

  it('supplier cash refund stat falls back to totalValue for legacy cash returns without cashRefund', () => {
    const order = makeOrder({ items: [{ purchasePrice: 100, sellingPrice: 250, quantity: 1 }], itemsSubtotal: 250 })
    const deps = { ...EMPTY_DEPS, getSupplierReturns: () => [
      { refundType: 'cash', totalValue: 500 },
    ] }
    const calc = calculateNetProfit([order], deps)
    expect(calc.supplierCashRefunds).toBe(500)
    expect(calc.netProfit).toBe(150)
  })
})

describe('accounting order money helpers (parity)', () => {
  it('getOrderRemainingAmount: active orders = totalAmount − downPayment', () => {
    expect(getOrderRemainingAmount({ status: 'delivered', totalAmount: 600, downPayment: 100 })).toBe(500)
    expect(getOrderRemainingAmount({ status: 'cancelled', totalAmount: 600, downPayment: 100 })).toBe(0)
    expect(getOrderRemainingAmount({ status: 'returned', totalAmount: 600, downPayment: 100 })).toBe(0)
    expect(getOrderRemainingAmount(null)).toBe(0)
  })

  it('status predicates', () => {
    expect(isFulfilledOrderStatus('delivered')).toBe(true)
    expect(isFulfilledOrderStatus('completed')).toBe(true)
    expect(isFulfilledOrderStatus('new')).toBe(false)
    expect(isFulfilledOrderStatus('returned')).toBe(false)
    expect(isActiveOrderStatus('new')).toBe(true)
    expect(isActiveOrderStatus('cancelled')).toBe(false)
    expect(isActiveOrderStatus('returned')).toBe(false)
  })

  it('computeShippingRevenueDeposit: customer-paid services only, capped by deposit', () => {
    expect(computeShippingRevenueDeposit('shipping', 40, 40, 0, 'customer', 'customer')).toBe(40)
    expect(computeShippingRevenueDeposit('shipping', 30, 40, 0, 'customer', 'customer')).toBe(30)
    expect(computeShippingRevenueDeposit('shipping', 40, 40, 0, 'merchant', 'customer')).toBe(0)
    expect(computeShippingRevenueDeposit('shipping_extra', 100, 40, 60, 'customer', 'customer')).toBe(100)
    expect(computeShippingRevenueDeposit('custom', 100, 40, 0, 'customer', 'customer')).toBe(0)
  })

  it('getOrderShippingRevenue / getOrderRetainedShippingDeposit', () => {
    const o = { status: 'cancelled', shippingRevenueDeposit: 40, refundedAmount: 10 }
    expect(getOrderShippingRevenue(o)).toBe(30)
    expect(getOrderRetainedShippingDeposit(o)).toBe(30)
    expect(getOrderRetainedShippingDeposit({ status: 'delivered', shippingRevenueDeposit: 40 })).toBe(0)
  })
})

describe('payments pure helpers (parity with js/services/payments.js)', () => {
  it('sortPaymentsDesc: newest first, then id desc', () => {
    const list = [
      { id: 'PAY-2', createdAt: '2026-01-02 10:00', amount: 2 },
      { id: 'PAY-1', createdAt: '2026-01-01 10:00', amount: 1 },
      { id: 'PAY-1B', createdAt: '2026-01-01 10:00', amount: 1 },
    ]
    const sorted = sortPaymentsDesc(list)
    expect(sorted[0].id).toBe('PAY-2')
    expect(sorted[1].id).toBe('PAY-1B')
    expect(sorted[2].id).toBe('PAY-1')
  })

  it('getPaymentsByEntity filters type+id', () => {
    const payments = [
      { entityType: 'customer', entityId: 'C1', amount: 10 },
      { entityType: 'supplier', entityId: 'C1', amount: 20 },
      { entityType: 'customer', entityId: 'C2', amount: 30 },
    ]
    expect(getPaymentsByEntity(payments, 'customer', 'C1')).toHaveLength(1)
    expect(getPaymentsByEntity(payments, 'customer', 'C2')[0].amount).toBe(30)
  })

  it('getTotalCustomerReceivables sums order remaining for active orders only', () => {
    const orders = [
      { status: 'delivered', totalAmount: 600, downPayment: 100 }, // 500
      { status: 'cancelled', totalAmount: 600, downPayment: 0 },   // 0
      { status: 'returned', totalAmount: 600, downPayment: 0 },    // 0
      { status: 'new', totalAmount: 300, downPayment: 0 },         // 300
    ]
    expect(getTotalCustomerReceivables(orders)).toBe(800)
  })

  it('getTotalSupplierPayables / getTotalPaymentsCollected', () => {
    expect(getTotalSupplierPayables([{ remainingBalance: 2000 }, { remainingBalance: 0.5 }])).toBe(2000.5)
    expect(getTotalPaymentsCollected([{ amount: 100 }, { amount: 0.1 }, { amount: 'x' }])).toBe(100.1)
  })
})

describe('payments.createPaymentRecord — idempotent updates (refOrderId + cycleKey)', () => {
  function deposit(repo, cust, amount, cycleKey = 'deposit') {
    return createPaymentRecord({
      entityType: 'customer', entityId: cust.id, entityName: cust.name,
      amount, date: '2026-08-01', paymentMethod: 'cash', isDownPayment: true,
      refOrderId: 'ORD-X', cycleKey,
    }, repo)
  }

  it('re-submitting a positive deposit applies only the delta, not the full amount again', () => {
    const { repo } = freshSystem({ [STORAGE_KEYS.CUSTOMERS]: [seedCustomer()] })
    const cust = repo.getCustomers()[0]
    deposit(repo, cust, 500)
    expect(repo.getCustomerById(cust.id).paid).toBe(500)
    deposit(repo, cust, 700)
    expect(repo.getCustomerById(cust.id).paid).toBe(700)
    const records = repo.getPayments()
    expect(records).toHaveLength(1)
    expect(records[0].amount).toBe(700)
  })

  it('an identical retry is a true no-op — no double count', () => {
    const { repo } = freshSystem({ [STORAGE_KEYS.CUSTOMERS]: [seedCustomer()] })
    const cust = repo.getCustomers()[0]
    deposit(repo, cust, 500)
    deposit(repo, cust, 500)
    expect(repo.getCustomerById(cust.id).paid).toBe(500)
    expect(repo.getPayments()).toHaveLength(1)
  })

  it('refund corrections apply the signed delta too', () => {
    const { repo } = freshSystem({ [STORAGE_KEYS.CUSTOMERS]: [seedCustomer({ paid: 1000 })] })
    const cust = repo.getCustomers()[0]
    deposit(repo, cust, -500, 'refund-500')
    expect(repo.getCustomerById(cust.id).paid).toBe(500)
    deposit(repo, cust, -700, 'refund-500')
    expect(repo.getCustomerById(cust.id).paid).toBe(300)
    expect(repo.getPayments()).toHaveLength(1)
  })
})

describe('expenses pure helpers (parity with js/services/expenses.js)', () => {
  it('getExpenseNextDueDate: recurring due day logic', () => {
    expect(getExpenseNextDueDate({ recurring: false }, '2026-01-05')).toBe('')
    expect(getExpenseNextDueDate({ recurring: true, dueDay: 10 }, '2026-01-05')).toBe('2026-01-10')
    expect(getExpenseNextDueDate({ recurring: true, dueDay: 5 }, '2026-01-05')).toBe('2026-02-05')
    expect(getExpenseNextDueDate({ recurring: true, dueDay: 31 }, '2026-02-10')).toBe('2026-02-28')
  })

  it('getCurrentOperatingExpenses: one-time + due recurring count, future do not', () => {
    const expenses = [
      { amount: 100, recurring: false },
      { amount: 50, recurring: true, dueDay: 5 },
      { amount: 30, recurring: true, dueDay: 15 },
    ]
    const r = getCurrentOperatingExpenses(expenses, '2026-01-10')
    expect(r.oneTime).toBe(100)
    expect(r.recurringThisMonth).toBe(50)
    expect(r.recurringFuture).toBe(30)
    expect(r.total).toBe(150)
  })
})
