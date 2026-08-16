// =============================================================================
// سيناريوهات دورة حياة العميل — مختبر سيناريوهات المحاسبة
// -----------------------------------------------------------------------------
// كل سيناريو يحاكي حركة مستخدم كاملة من البداية للنهاية عبر الدومين الحقيقي،
// وبعد كل خطوة (وليس في النهاية فقط) نتحقق من ثوابت النظام: تماسك مالية كل طلب،
// صافي دفتر المورد مع رصيده، المخزون لا يُخلق ولا يُحرق، ومحصلة الخزينة تطابق
// التوقّع اليدوي. أي خطأ صغير في توجيه القيود يكشف نفسه هنا كفارق قابل للتتبّع.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { createOrder, updateOrderStatus } from '@/domain/orders/orderRepository'
import { createPaymentRecord } from '@/domain/accounting/payments'
import {
  seedStore, item, customerInfo, STORAGE_KEYS,
  expectSupplierConsistent, expectOrderMoneyConsistent, expectCustomerLedgerTies,
  expectStockTies, treasuryReport,
} from './helpers'

describe('سيناريو عميل أ — عربون → توصيل → تسديد كامل', () => {
  it('كل لوحة الأرقام تبقى متماسكة بعد كل خطوة', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })
    const customerPhone = '01012345678'

    // 1) عربون 100 على فاتورة 500 (حالة جديدة) — لا صرف مخزون بعد، ولا مشتريات بعد
    const order = await createOrder({ customerInfo: customerInfo({ phone: customerPhone }), items: [item({ quantity: 2 })], downPayment: 100, status: 'new' }, repo)
    expect(order).toMatchObject({ totalAmount: 500, downPayment: 100, remainingBalance: 400, status: 'new' })
    expectOrderMoneyConsistent(db.getCollection(STORAGE_KEYS.ORDERS)[0])
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 10)

    const customerNew = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customerNew).toMatchObject({ paid: 100, totalPurchases: 0, remainingBalance: 0 })
    expectSupplierConsistent(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0], db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    // 2) توصيل — يستهلك المخزون ويسجّل المديونية على العميل
    await updateOrderStatus(order.id, 'delivered', 0, 0, repo)
    const customerDelivered = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customerDelivered).toMatchObject({ paid: 100, totalPurchases: 500, remainingBalance: 400 })
    expectOrderMoneyConsistent(db.getCollection(STORAGE_KEYS.ORDERS)[0])
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 8)
    expectSupplierConsistent(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0], db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))
    expect(treasuryReport(db).netTreasury).toBe(100)

    // 3) تحصيل المتبقي 400 — يقفل الطلب والعميل معاً
    createPaymentRecord({ entityType: 'customer', entityId: customerDelivered.id, entityName: customerDelivered.name, amount: 400, date: '2026-08-10', paymentMethod: 'cash', notes: 'تحصيل باقي الفاتورة' }, repo)
    const customerPaid = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customerPaid).toMatchObject({ paid: 500, totalPurchases: 500, remainingBalance: 0 })
    const settledOrder = db.getCollection(STORAGE_KEYS.ORDERS)[0]
    expect(settledOrder).toMatchObject({ downPayment: 500, remainingBalance: 0, paidInFull: true })

    // 4) تحقق نهائي: كاملٌ ومتسق
    expectCustomerLedgerTies(customerPaid, db.getCollection(STORAGE_KEYS.ORDERS), db.getCollection(STORAGE_KEYS.PAYMENTS))
    db.getCollection(STORAGE_KEYS.ORDERS).forEach(expectOrderMoneyConsistent)
    const t = treasuryReport(db)
    expect(t).toMatchObject({ totalInflow: 500, netTreasury: 500 })
  })
})

describe('سيناريو عميل ب — دفعة كاملة ثم إرجاع الفاتورة', () => {
  it('المرتجع يعيد المخزون والمبالغ: الخزينة تعود للصفر والدخل لا يتضاعف', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })

    // 1) بيع كاش كامل (كاشير) — حالة مكتملة فوراً
    const order = await createOrder({ customerInfo: customerInfo({ phone: '01098765432' }), items: [item({ quantity: 2 })], downPayment: 0, status: 'delivered', cashierMode: true }, repo)
    expect(order).toMatchObject({ status: 'completed', downPayment: 500, remainingBalance: 0 })
    const customerSold = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customerSold).toMatchObject({ paid: 500, totalPurchases: 500, remainingBalance: 0 })
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 8)
    expect(treasuryReport(db).netTreasury).toBe(500)

    // 2) إرجاع كامل — المخزون يعود والدفعة تُرد كلها
    await updateOrderStatus(order.id, 'returned', 0, 0, repo)
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 10)
    const customerReturned = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customerReturned).toMatchObject({ paid: 0, totalPurchases: 0, remainingBalance: 0 })
    const refunds = db.getCollection(STORAGE_KEYS.PAYMENTS).filter(p => p.type === 'refund')
    expect(refunds).toHaveLength(1)
    expect(refunds[0]).toMatchObject({ amount: -500, entityType: 'customer' })
    const returnedOrder = db.getCollection(STORAGE_KEYS.ORDERS)[0]
    expectOrderMoneyConsistent(returnedOrder)
    expect(returnedOrder.remainingBalance).toBe(0)

    // 3) تحقق نهائي: الخزينة صفر (قبض 500 − رد 500) والعميل خالص
    const t = treasuryReport(db)
    expect(t).toMatchObject({ totalInflow: 500, totalRefunds: 500, netTreasury: 0 })
    expectCustomerLedgerTies(customerReturned, db.getCollection(STORAGE_KEYS.ORDERS), db.getCollection(STORAGE_KEYS.PAYMENTS))
    expectSupplierConsistent(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0], db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))
  })
})

describe('سيناريو عميل ج — فاتورة بعجز مخزون (مورد مدين لنا مستحق) + تسديد الطرفين', () => {
  it('العجز يصبح مديونية للمورد، وتسديد العميل والمورد يقفل كل شيء', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 2, purchasePrice: 150, sellingPrice: 300 } })

    // 1) بيع 5 قطع والمخزن 2 فقط → عجز 3 قطع = 450 مستحق للمورد
    const order = await createOrder({ customerInfo: customerInfo({ phone: '01055511122' }), items: [item({ quantity: 5, sellingPrice: 300, purchasePrice: 150 })], downPayment: 0, status: 'delivered' }, repo)
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 0)
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0].supplierDeficits).toHaveLength(1)
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0].supplierDeficits[0]).toMatchObject({ units: 3, amount: 450 })

    const supplierAfterSale = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplierAfterSale).toMatchObject({ totalPurchases: 450, paid: 0, remainingBalance: 450 })
    expectSupplierConsistent(supplierAfterSale, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    const customerAfterSale = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customerAfterSale).toMatchObject({ paid: 0, totalPurchases: 1500, remainingBalance: 1500 })
    expectOrderMoneyConsistent(db.getCollection(STORAGE_KEYS.ORDERS)[0])

    // 2) العميل يسدد كامل فاتورته 1500
    createPaymentRecord({ entityType: 'customer', entityId: customerAfterSale.id, entityName: customerAfterSale.name, amount: 1500, date: '2026-08-10', paymentMethod: 'cash', notes: 'سداد فاتورة العجز' }, repo)
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]).toMatchObject({ paid: 1500, remainingBalance: 0 })
    expect(treasuryReport(db).totalInflow).toBe(1500)

    // 3) تسديد مستحقات المورد 450
    createPaymentRecord({ entityType: 'supplier', entityId: supplierAfterSale.id, entityName: supplierAfterSale.name, amount: 450, date: '2026-08-11', paymentMethod: 'cash', notes: 'تسديد مديونية عجز مخزون' }, repo)
    const supplierPaid = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplierPaid).toMatchObject({ totalPurchases: 450, paid: 450, remainingBalance: 0 })
    expectSupplierConsistent(supplierPaid, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    // 4) تحقق نهائي: خزينة = وارد 1500 − صادر مورد 450 = 1050
    expectCustomerLedgerTies(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0], db.getCollection(STORAGE_KEYS.ORDERS), db.getCollection(STORAGE_KEYS.PAYMENTS))
    expect(treasuryReport(db)).toMatchObject({ totalInflow: 1500, totalSupplierPayments: 450, netTreasury: 1050 })
  })
})

describe('سيناريو عميل د — إلغاء بعربون واسترداد جزئي ثم إعادة تفعيل', () => {
  it('الحجز المحتجز يُعاد اعتماده عند إعادة التفعيل دون خلق مال', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })

    // 1) عربون 200 على فاتورة 500
    const order = await createOrder({ customerInfo: customerInfo({ phone: '01033344455' }), items: [item({ quantity: 2 })], downPayment: 200, status: 'new' }, repo)

    // 2) إلغاء باسترداد 120 → حجز 80
    await updateOrderStatus(order.id, 'cancelled', 120, 0, repo)
    const cancelled = db.getCollection(STORAGE_KEYS.ORDERS)[0]
    expect(cancelled).toMatchObject({ status: 'cancelled', refundedAmount: 120, retainedDeposit: 80, remainingBalance: 0 })
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]).toMatchObject({ paid: 0, totalPurchases: 0, remainingBalance: 0 })
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 10)
    const refund = db.getCollection(STORAGE_KEYS.PAYMENTS).find(p => p.type === 'refund')
    expect(refund).toMatchObject({ amount: -120 })

    // 3) إعادة تفعيل → إعادة اعتماد الحجز 80 كدفعة جديدة
    await updateOrderStatus(order.id, 'new', 0, 0, repo)
    const reactivated = db.getCollection(STORAGE_KEYS.ORDERS)[0]
    expect(reactivated.status).toBe('new')
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS).some(p => p.cycleKey === 'recredit-80' && p.amount === 80)).toBe(true)
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]).toMatchObject({ paid: 80, totalPurchases: 0 })

    // 4) توصيل — المتبقي 300 فقط (الدفعة 200 محفوظة على الطلب)
    await updateOrderStatus(order.id, 'delivered', 0, 0, repo)
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 8)
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0]).toMatchObject({ status: 'delivered', remainingBalance: 300 })
    const customer = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customer).toMatchObject({ paid: 80, totalPurchases: 500, remainingBalance: 300 })

    // 5) تحقق نهائي: مدفوع 80 + متبقٍّ 300 + مُسترد 120 = مشتريات 500
    expectCustomerLedgerTies(customer, db.getCollection(STORAGE_KEYS.ORDERS), db.getCollection(STORAGE_KEYS.PAYMENTS))
    const t = treasuryReport(db)
    // قبض 200 (عربون) − رد 120 + إعادة اعتماد 80 = 160 صافي في الخزينة
    expect(t).toMatchObject({ totalInflow: 280, totalRefunds: 120, netTreasury: 160 })
  })
})
