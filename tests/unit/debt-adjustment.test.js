// =============================================================================
// اختبارات قيد تسوية المديونية (V3.65) — العميل والمورد
// -----------------------------------------------------------------------------
// تغطية: تعديل مديونية العميل يُسجَّل كقيد دفتر (customerDebtAdjustment) داخل
// الدفعات فيصمد أمام recalculateCustomerBalance، ولا يمس الطلبات/الدفعات الفعلية
// ولا الخزينة (computeTreasury). وتعديل مديونية المورد يُسجَّل في دفتر الموردين
// فيصمد أمام recalculateTotals.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { adjustCustomerDebt, recalculateCustomerBalance } from '@/domain/customers/customers'
import { adjustSupplierDebt } from '@/domain/suppliers/suppliers'
import { recalculateTotals } from '@/domain/inventory/supplierReturns'
import { computeTreasury } from '@/state/reportsStore'
import { freshSystem, seedCustomer, seedSupplier, STORAGE_KEYS } from '../helpers/fakeRepo'

function customerWithOrder() {
  return freshSystem({
    [STORAGE_KEYS.CUSTOMERS]: [seedCustomer({ id: 'CUST1', totalPurchases: 1000, paid: 0, remainingBalance: 1000 })],
    [STORAGE_KEYS.ORDERS]: [
      { id: 'ORD1', customerId: 'CUST1', status: 'delivered', totalAmount: 1000, downPayment: 0, remainingBalance: 1000, createdAt: '2026-08-01T10:00:00' },
    ],
  })
}

describe('adjustCustomerDebt — قيد تسوية دفتري دائم', () => {
  it('يخفض المديونية بقيد موجب ويصمد أمام إعادة الاحتساب', () => {
    const { db, repo } = customerWithOrder()
    adjustCustomerDebt('CUST1', { remainingBalance: 750 }, repo)

    const pays = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(pays).toHaveLength(1)
    expect(pays[0]).toMatchObject({ entityType: 'customer', entityId: 'CUST1', amount: 250, type: 'customerDebtAdjustment' })
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]).toMatchObject({ paid: 250, remainingBalance: 750 })
    // الطلبات لا تُمس
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0]).toMatchObject({ downPayment: 0, remainingBalance: 1000 })

    recalculateCustomerBalance('CUST1', repo)
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]).toMatchObject({ paid: 250, remainingBalance: 750 })
  })

  it('يزيد المديونية بقيد سالب ويصمد أمام إعادة الاحتساب', () => {
    const { db, repo } = customerWithOrder()
    adjustCustomerDebt('CUST1', { remainingBalance: 1300 }, repo)

    const pays = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(pays[0]).toMatchObject({ amount: -300, type: 'customerDebtAdjustment' })

    recalculateCustomerBalance('CUST1', repo)
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0].remainingBalance).toBe(1300)
  })

  it('لا يُنشئ قيداً إذا لم يتغير الرصيد', () => {
    const { db, repo } = customerWithOrder()
    adjustCustomerDebt('CUST1', { remainingBalance: 1000 }, repo)
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS)).toHaveLength(0)
  })

  it('تعديل ثانٍ يُسجَّل بالفرق فقط (القيود تُجمَّع لصافي واحد)', () => {
    const { db, repo } = customerWithOrder()
    adjustCustomerDebt('CUST1', { remainingBalance: 750 }, repo) // +250
    adjustCustomerDebt('CUST1', { remainingBalance: 600 }, repo) // +150 صافية جديدة

    const pays = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(pays).toHaveLength(2)
    expect(pays.reduce((s, p) => s + Number(p.amount), 0)).toBe(400)
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]).toMatchObject({ remainingBalance: 600 })
  })
})

describe('adjustSupplierDebt — قيد دفتر مورد دائم', () => {
  it('يخفّض الرصيد بقيد تسوية دائن ويصمد أمام recalculateTotals', () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', totalPurchases: 1000, paid: 0 })],
      [STORAGE_KEYS.SUPPLIER_TRANSACTIONS]: [
        { id: 'T1', supplierId: 'SUP1', type: 'شحنة توريد', debit: 1000, credit: 0, createdAt: '2026-08-01T10:00:00' },
      ],
    })
    adjustSupplierDebt('SUP1', { remainingBalance: 600 }, repo)

    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns).toHaveLength(2)
    expect(txns.find(t => t.type === 'تسوية مديونية مورد')).toMatchObject({ debit: 0, credit: 400 })
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]).toMatchObject({ remainingBalance: 600, paid: 400 })

    recalculateTotals(repo)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]).toMatchObject({ remainingBalance: 600, paid: 400 })
  })

  it('يسمح برصيد سالب (مستحق لنا من المورد) ويصمد', () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', totalPurchases: 1000, paid: 0 })],
      [STORAGE_KEYS.SUPPLIER_TRANSACTIONS]: [
        { id: 'T1', supplierId: 'SUP1', type: 'شحنة توريد', debit: 1000, credit: 0, createdAt: '2026-08-01T10:00:00' },
      ],
    })
    adjustSupplierDebt('SUP1', { remainingBalance: -200 }, repo)

    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.find(t => t.type === 'تسوية مديونية مورد')).toMatchObject({ debit: 0, credit: 1200 })
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]).toMatchObject({ remainingBalance: -200, paid: 1200 })

    recalculateTotals(repo)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]).toMatchObject({ remainingBalance: -200, paid: 1200 })
  })
})

describe('computeTreasury — إقصاء قيود تسوية مديونية العميل', () => {
  it('لا تحتسب التسويات وارداً ولا صادراً من الخزينة', () => {
    const payments = [
      { id: 'ADJ-1', entityType: 'customer', entityId: 'CUST1', type: 'customerDebtAdjustment', amount: 250 },
      { id: 'ADJ-2', entityType: 'customer', entityId: 'CUST1', type: 'customerDebtAdjustment', amount: -100 },
      { id: 'PAY-1', entityType: 'customer', entityId: 'CUST1', amount: 50 },
    ]
    const t = computeTreasury(payments, [])
    expect(t.totalInflow).toBe(50)
    expect(t.totalRefunds).toBe(0)
    expect(t.netTreasury).toBe(50)
  })
})
