// =============================================================================
// سيناريوهات عائد خدمات الشحن — مختبر سيناريوهات المحاسبة
// -----------------------------------------------------------------------------
// حصة عربون الشحن المخصصة (depositType shipping/shipping_extra) تُبلَّغ كإيراد
// خدمات، والدخل المحتجز عند الإلغاء (الدفعة المحتجزة ناقص حصة الشحن) يدخل صافي
// الربح — ولا يكسر أي منهما تماسك الأرصدة.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { createOrder, updateOrderStatus } from '@/domain/orders/orderRepository'
import {
  seedStore, item, customerInfo, STORAGE_KEYS,
  expectOrderMoneyConsistent, expectCustomerLedgerTies, treasuryReport, profitReport,
} from './helpers'

describe('سيناريو شحن 1 — عربون بحصة خدمات شحن: تُبلَّغ ولا تلمس هامش البضاعة', () => {
  it('shippingRevenueIncome يُبلَّغ والمخزون والأرصدة سليمة', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })

    const order = await createOrder({
      customerInfo: customerInfo({ phone: '01012345009' }),
      items: [item({ quantity: 2 })],
      shippingCost: 40,
      shippingPayer: 'customer',
      extraExpenses: 30,
      extraExpensesPayer: 'customer',
      downPayment: 100,
      status: 'delivered',
      depositType: 'shipping_extra',
    }, repo)

    expect(order).toMatchObject({ totalAmount: 570, downPayment: 100, remainingBalance: 470, shippingRevenueDeposit: 70 })
    db.getCollection(STORAGE_KEYS.ORDERS).forEach(expectOrderMoneyConsistent)

    const customer = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customer).toMatchObject({ paid: 100, totalPurchases: 570, remainingBalance: 470 })
    expectCustomerLedgerTies(customer, db.getCollection(STORAGE_KEYS.ORDERS), db.getCollection(STORAGE_KEYS.PAYMENTS))

    const p = profitReport(db)
    expect(p).toMatchObject({ itemsSales: 500, customerShippingTotal: 40, customerExtraExpensesTotal: 30, grossSales: 570, cogs: 200, shippingRevenueIncome: 70, netProfit: 300 })
    expect(treasuryReport(db)).toMatchObject({ totalInflow: 100, netTreasury: 100 })
  })
})

describe('سيناريو شحن 2 — إلغاء بعربون بحصة شحن: الدخل المحتجز يدخل الربح', () => {
  it('retainedDepositIncome = الدفعة المحتجزة ناقص حصة الشحن', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })

    const order = await createOrder({
      customerInfo: customerInfo({ phone: '01012345010' }),
      items: [item({ quantity: 2 })],
      shippingCost: 40,
      shippingPayer: 'customer',
      extraExpenses: 30,
      extraExpensesPayer: 'customer',
      downPayment: 100,
      status: 'new',
      depositType: 'shipping_extra',
    }, repo)
    expect(order.shippingRevenueDeposit).toBe(70)

    await updateOrderStatus(order.id, 'cancelled', 40, 0, repo)

    const cancelled = db.getCollection(STORAGE_KEYS.ORDERS)[0]
    expect(cancelled).toMatchObject({ status: 'cancelled', refundedAmount: 40, retainedDeposit: 60 })

    // دخل محتجز 60 − حصة شحن 30 = 30 يربح في الربح
    const p = profitReport(db)
    expect(p).toMatchObject({ retainedDepositIncome: 30, netProfit: 30 })
    // الخزينة: قبض 100 − رد 40 = 60
    expect(treasuryReport(db)).toMatchObject({ totalInflow: 100, totalRefunds: 40, netTreasury: 60 })
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]).toMatchObject({ paid: 0, totalPurchases: 0, remainingBalance: 0 })
  })
})
