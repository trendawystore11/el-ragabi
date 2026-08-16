// =============================================================================
// سيناريوهات التقاطع النهائي: الخزينة والربح — مختبر سيناريوهات المحاسبة
// -----------------------------------------------------------------------------
// يختبر أعلى طبقة من التماسك: بعد كل دورة كاملة نعيد بناء تقرير الخزينة
// (computeTreasury) ومحرك الربح (calculateNetProfit) من سجل الحركات الفعلية،
// ونطابق النتائج مع توقّع يدوي مُحسَب من المعاملات الحقيقية. هذا يلتقط أي خطأ
// صغير في «اتجاه القيد» (وارد/صادر، ربح/خسارة) لا تكشفه اختبارات الوحدات المنعزلة.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { createOrder } from '@/domain/orders/orderRepository'
import { createProduct } from '@/domain/inventory/products'
import { createSupplierReturn } from '@/domain/inventory/supplierReturns'
import { createPaymentRecord } from '@/domain/accounting/payments'
import { createExpense, postDueRecurringExpenses } from '@/domain/accounting/expenses'
import {
  seedStore, item, customerInfo, STORAGE_KEYS,
  expectSupplierConsistent, treasuryReport, profitReport,
} from './helpers'

describe('سيناريو تقاطع 1 — ربح وخزينة فاتورة مكتملة', () => {
  it('الربح = هامش البضاعة، والخزينة = المقبوض الفعلي', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })

    await createOrder({ customerInfo: customerInfo({ phone: '01011122233' }), items: [item({ quantity: 2 })], downPayment: 500, status: 'delivered' }, repo)

    const p = profitReport(db)
    expect(p).toMatchObject({ itemsSales: 500, cogs: 200, grossProfit: 300, netProfit: 300 })

    const t = treasuryReport(db)
    expect(t).toMatchObject({ totalInflow: 500, totalRefunds: 0, totalSupplierPayments: 0, netTreasury: 500 })
  })
})

describe('سيناريو تقاطع 2 — شحن يدفعه العميل + مصروف تشغيلي', () => {
  it('الشحن يوسّع الدخل، والمصروف يقلص الربح دون أن يقترض من الخزينة', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })

    createExpense({ title: 'إيجار المحل', amount: 50, category: 'إيجار', date: '2026-08-01', createdBy: 'المدير العام' }, repo)
    await createOrder({
      customerInfo: customerInfo({ phone: '01044455566' }),
      items: [item({ quantity: 2 })],
      shippingCost: 40,
      shippingPayer: 'customer',
      downPayment: 540,
      status: 'delivered',
    }, repo)

    // الربح: (500 − 200) هامش البضاعة − 50 مصروف = 250
    const p = profitReport(db)
    expect(p).toMatchObject({ itemsSales: 500, customerShippingTotal: 40, grossSales: 540, cogs: 200, totalOpExpenses: 50, netProfit: 250 })

    // الخزينة: المصروف اللحظي لا يُقيد في الدفتر → 540 فقط
    const t = treasuryReport(db)
    expect(t).toMatchObject({ totalInflow: 540, totalSupplierPayments: 0, treasuryOutflow: 0, netTreasury: 540 })
  })
})

describe('سيناريو تقاطع 3 — مصروف شهري دوري يُقيد مرة واحدة بلا تضاعف', () => {
  it('postDueRecurringExpenses يقيد الشهر مرة واحدة ويغلق بالـ lastPostedPeriod', async () => {
    const { db, repo } = seedStore()
    // الواجهة الحالية لا تعرّض getExpenses على الريبو — نكملها مباشرة على المصدر الحقيقي
    repo.getExpenses = () => db.getCollection(STORAGE_KEYS.EXPENSES)

    createExpense({ title: 'إيجار شهري', amount: 300, category: 'إيجار', date: '2026-08-01', recurring: true, dueDay: 5, createdBy: 'المدير العام' }, repo)

    expect(await postDueRecurringExpenses(repo, '2026-08-10')).toBe(1)
    expect(await postDueRecurringExpenses(repo, '2026-08-12')).toBe(0)

    const expense = db.getCollection(STORAGE_KEYS.EXPENSES)[0]
    expect(expense.lastPostedPeriod).toBe('2026-08')

    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ entityType: 'treasury', amount: -300, type: 'expense', cycleKey: 'expense-2026-08' })

    const t = treasuryReport(db)
    expect(t).toMatchObject({ treasuryOutflow: 300, netTreasury: -300 })
  })
})

describe('سيناريو تقاطع 4 — مردود نقدي للمورد: وارد خزينة لا يلمس صافي الربح', () => {
  it('supplierCashRefunds يُبلَّغ في التقرير لكنه لا يدخل netProfit', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD0', code: 'FAB', stock: 300, purchasePrice: 100, sellingPrice: 150 } })

    const prod = createProduct({ name: 'قماش', code: 'FAB-001', purchasePrice: 100, sellingPrice: 150, stock: 300, supplierId: 'SUP1', supplierName: 'مورد أ' }, repo)
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 20000, date: '2026-08-02', paymentMethod: 'cash', notes: 'تسديد جزئي' }, repo)
    await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 300, unitCost: 100 }], refundType: 'cash' }, repo)

    // بلا أي مبيعات: الربح صفر رغم استلام 20,000 كاش مردود
    const p = profitReport(db)
    expect(p.supplierCashRefunds).toBe(20000)
    expect(p.netProfit).toBe(0)

    // الخزينة استلمتها وارداً مستقلاً، ودفعُ المورد 20,000 السابق يعود كاملاً → صافي صفر
    const t = treasuryReport(db)
    expect(t).toMatchObject({ treasuryInflow: 20000, totalInflow: 0, totalSupplierPayments: 20000, netTreasury: 0 })
    expectSupplierConsistent(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0], db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))
  })
})

describe('سيناريو تقاطع 5 — دورة كاملة شراء/تسديد/مرتجع/بيع تترك كل شيء متطابقاً', () => {
  it('خزينة سلبية من تسديد المورد + ربح من البيع + دفتر مغلق على الصفر للمورد', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 300, purchasePrice: 100, sellingPrice: 250 } })

    // 1) مخزون 300 من المورد = مديونية 30,000
    const prod = createProduct({ name: 'قماش', code: 'FAB-001', purchasePrice: 100, sellingPrice: 250, stock: 300, supplierId: 'SUP1', supplierName: 'مورد أ' }, repo)
    // 2) تسديد 12,000 → المتبقي 18,000
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 12000, date: '2026-08-02', paymentMethod: 'cash', notes: 'تسديد جزئي' }, repo)
    // 3) مرتجع تخفيض دين 100 قطعة = 10,000 → المتبقي 8,000
    await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 100, unitCost: 100 }], refundType: 'debt' }, repo)
    // 4) بيع كاش 2 قطعة × 250 = 500 (تكلفة 200)
    await createOrder({ customerInfo: customerInfo({ phone: '01022233344' }), items: [item({ quantity: 2 })], downPayment: 500, status: 'delivered' }, repo)

    // المورد: مشتريات 20,000 − مرتجع 10,000 = 20,000 متبقي منها 8,000
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ totalPurchases: 20000, paid: 12000, remainingBalance: 8000 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    // الربح من البيع فقط: 500 − 200 = 300 (المرتجع لا يولّد ربحاً)
    const p = profitReport(db)
    expect(p).toMatchObject({ itemsSales: 500, cogs: 200, netProfit: 300, supplierCashRefunds: 0 })

    // الخزينة: وارد بيع 500 − صادر مورد 12,000 = −11,500
    const t = treasuryReport(db)
    expect(t).toMatchObject({ totalInflow: 500, totalSupplierPayments: 12000, netTreasury: -11500 })
  })
})
