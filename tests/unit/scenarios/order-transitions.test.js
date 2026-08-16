// =============================================================================
// سيناريوهات انتقالات حالة الطلب — مختبر سيناريوهات المحاسبة
// -----------------------------------------------------------------------------
// مسارات لم تكن مغطاة: الإتمام التلقائي (delivered → completed) بتسوية قيد
// settle، وإعادة تفعيل طلب مرتجع (returned → delivered) بتصفير ثم إعادة اعتماد،
// ومصيدة حقل paid الذي يتغير تراكمياً مع المرتجعات وإعادة الاعتماد.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { createOrder, updateOrderStatus } from '@/domain/orders/orderRepository'
import {
  seedStore, item, customerInfo, STORAGE_KEYS,
  expectSupplierConsistent, expectOrderMoneyConsistent, expectCustomerLedgerTies,
  expectStockTies, treasuryReport, profitReport,
} from './helpers'

describe('سيناريو انتقال 1 — delivered → completed تسوية تلقائية', () => {
  it('المتبقي يُحصَّل بقيد settle ويُعاد حساب رصيد العميل', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })

    const order = await createOrder({ customerInfo: customerInfo({ phone: '01012345001' }), items: [item({ quantity: 2 })], downPayment: 100, status: 'new' }, repo)
    await updateOrderStatus(order.id, 'delivered', 0, 0, repo)
    await updateOrderStatus(order.id, 'completed', 0, 0, repo)

    const settled = db.getCollection(STORAGE_KEYS.ORDERS)[0]
    expect(settled).toMatchObject({ status: 'completed', downPayment: 500, remainingBalance: 0, paidInFull: true })
    const settle = db.getCollection(STORAGE_KEYS.PAYMENTS).find(p => p.type === 'settle')
    expect(settle).toMatchObject({ amount: 400, isDownPayment: true, cycleKey: 'settle' })

    const customer = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customer).toMatchObject({ paid: 500, totalPurchases: 500, remainingBalance: 0 })
    expectCustomerLedgerTies(customer, db.getCollection(STORAGE_KEYS.ORDERS), db.getCollection(STORAGE_KEYS.PAYMENTS))
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 8)
    db.getCollection(STORAGE_KEYS.ORDERS).forEach(expectOrderMoneyConsistent)
    expectSupplierConsistent(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0], db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    // الخزينة: عربون 100 + تسوية 400 = 500
    expect(treasuryReport(db)).toMatchObject({ totalInflow: 500, netTreasury: 500 })
    // الربح لا يتضاعف بالإتمام التلقائي: هامش البضاعة فقط
    expect(profitReport(db)).toMatchObject({ itemsSales: 500, cogs: 200, netProfit: 300 })
  })
})

describe('سيناريو انتقال 2 — returned → delivered إعادة تفعيل مرتجع', () => {
  it('الاسترداد الكامل ثم إعادة الاعتماد يعيدان الوضع تماماً دون خلق مال', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })

    const order = await createOrder({ customerInfo: customerInfo({ phone: '01012345002' }), items: [item({ quantity: 2 })], downPayment: 200, status: 'delivered' }, repo)
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 8)

    // إرجاع: استرداد تلقائي لكامل الدفعة 200
    await updateOrderStatus(order.id, 'returned', 0, 0, repo)
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 10)
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]).toMatchObject({ paid: 0, totalPurchases: 0, remainingBalance: 0 })
    const refund = db.getCollection(STORAGE_KEYS.PAYMENTS).find(p => p.type === 'refund')
    expect(refund).toMatchObject({ amount: -200 })

    // إعادة تفعيل: يصفّر المخزون من جديد ويعيد اعتماد 200 (المرتجع لم يُسجَّل refundedAmount)
    await updateOrderStatus(order.id, 'delivered', 0, 0, repo)
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 8)
    const recredit = db.getCollection(STORAGE_KEYS.PAYMENTS).find(p => p.cycleKey === 'recredit-200')
    expect(recredit).toMatchObject({ amount: 200, isDownPayment: true })
    const customer = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customer).toMatchObject({ paid: 200, totalPurchases: 500, remainingBalance: 300 })
    expectCustomerLedgerTies(customer, db.getCollection(STORAGE_KEYS.ORDERS), db.getCollection(STORAGE_KEYS.PAYMENTS))
    db.getCollection(STORAGE_KEYS.ORDERS).forEach(expectOrderMoneyConsistent)

    // الخزينة: قبض 200 − رد 200 + إعادة اعتماد 200 = 200 (نفس وضع ما قبل الإرجاع)
    expect(treasuryReport(db)).toMatchObject({ totalInflow: 400, totalRefunds: 200, netTreasury: 200 })
    expectSupplierConsistent(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0], db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))
  })
})
