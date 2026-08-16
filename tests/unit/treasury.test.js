import { describe, it, expect } from 'vitest'
import { computeTreasury } from '@/state/reportsStore'
import { createPaymentRecord } from '@/domain/accounting/payments'
import { freshSystem, seedSupplier, STORAGE_KEYS } from '../helpers/fakeRepo'

const cairoDate = () => new Date().toISOString().replace('T', ' ').split(' ')[0]

function pay(overrides = {}) {
  return {
    id: overrides.id || 'PAY-1',
    entityType: overrides.entityType || 'customer',
    entityId: overrides.entityId || 'CUST1',
    entityName: overrides.entityName || 'عميل اختبار',
    amount: overrides.amount ?? 0,
    paymentMethod: 'cash',
    notes: '',
    isDownPayment: !!overrides.isDownPayment,
    refOrderId: overrides.refOrderId || '',
    type: overrides.type || '',
    createdAt: overrides.createdAt || cairoDate(),
  }
}

describe('computeTreasury — إدارة وتعديل الخزينة (V3.54)', () => {
  it('وارد الخزينة = عربونات (مقيدة بسقف الفاتورة) + تحصيلات مباشرة + مردودات نقدية كمستردة', () => {
    const payments = [
      pay({ id: 'P1', entityType: 'customer', amount: 500, isDownPayment: true, refOrderId: 'ORD-1' }),
      pay({ id: 'P2', entityType: 'customer', amount: 700, isDownPayment: true, refOrderId: 'ORD-2' }),
      pay({ id: 'P3', entityType: 'customer', amount: 300 }),
      pay({ id: 'P4', entityType: 'treasury', amount: 150, type: 'supplierCashRefund' }),
    ]
    const orders = [
      { id: 'ORD-1', totalAmount: 500 },
      { id: 'ORD-2', totalAmount: 400 },
    ]
    const t = computeTreasury(payments, orders)
    // العربون المكرر لـ ORD-2 مقصوص إلى 400، وكل التحصيلات والمردودات النقدية تدخل الصافي
    expect(t.totalInflow).toBe(500 + 400 + 300)
    expect(t.treasuryInflow).toBe(150)
    expect(t.netTreasury).toBe(500 + 400 + 300 + 150)
  })

  it('المرتجع النقدي الجديد (entityType: treasury) وارد خزينة مستقل ولا يُحتسب ضمن مقبوضات العملاء أو إيصالات المورد السالبة', () => {
    const payments = [
      pay({ id: 'LEGACY', entityType: 'supplier', amount: -100 }),
      pay({ id: 'NEW', entityType: 'treasury', amount: 150, type: 'supplierCashRefund' }),
      pay({ id: 'PAID', entityType: 'supplier', amount: 1000 }),
    ]
    const t = computeTreasury(payments, [])
    // legacy: إيصال مورد سالب لا يزال مقبوضاً ضمن الوارد؛ الجديد حركة خزينة مستقلة
    expect(t.totalInflow).toBe(100)
    expect(t.treasuryInflow).toBe(150)
    expect(t.totalSupplierPayments).toBe(1000)
    expect(t.netTreasury).toBe(100 + 150 - 1000)
  })

  it('تحصيل نقدية من مورد مدين لنا (قيد سالب supplierCollection) يُحتسب وارداً بالخزينة', () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.SUPPLIERS]: [{ id: 'SUP1', name: 'مورد أ', totalPurchases: 20000, paid: 35000, remainingBalance: -15000 }],
    })
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 7000, date: cairoDate(), paymentMethod: 'cash', notes: 'تحصيل جزء من المبلغ المستحق لنا', isCollection: true }, repo)
    const t = computeTreasury(db.getCollection(STORAGE_KEYS.PAYMENTS), [])
    // القيد السالب يُحتسب في supplierCashBack (وارد) وليس ضمن مدفوعات المورد (صادر)
    expect(t.totalInflow).toBe(7000)
    expect(t.totalSupplierPayments).toBe(0)
    expect(t.netTreasury).toBe(7000)
  })

  it('تسوية يدوية: الفرق الموجب وارد والفارق السالب صادر، ولا يمس أرصدة العملاء/الموردين', () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ', totalPurchases: 500, paid: 200 })],
    })
    const t1 = computeTreasury([], [])
    expect(t1.netTreasury).toBe(0)

    const adj = createPaymentRecord(
      { entityType: 'treasury', entityId: 'TREASURY', entityName: 'الخزينة العامة', amount: 850, date: cairoDate(), paymentMethod: 'cash', notes: 'تسوية يدوية: الجرد الفعلي يزيد عن الدفتري', type: 'treasuryAdjustment' },
      repo
    )
    expect(adj.type).toBe('treasuryAdjustment')
    const t2 = computeTreasury(db.getCollection(STORAGE_KEYS.PAYMENTS), [])
    expect(t2.treasuryInflow).toBe(850)
    expect(t2.treasuryOutflow).toBe(0)
    expect(t2.netTreasury).toBe(850)

    // لا تمس أرصدة المورد (مشتريات 500 − تسديد 200 = 300)
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.remainingBalance).toBe(300)
  })

  it('عجز فعلي سالب: تسوية صادرة تُطرح من الصافي', () => {
    const { db, repo } = freshSystem()
    createPaymentRecord(
      { entityType: 'treasury', entityId: 'TREASURY', entityName: 'الخزينة العامة', amount: -120, date: cairoDate(), paymentMethod: 'cash', notes: 'تسوية يدوية: عجز بالجرد الفعلي', type: 'treasuryAdjustment' },
      repo
    )
    const t = computeTreasury(db.getCollection(STORAGE_KEYS.PAYMENTS), [])
    expect(t.treasuryOutflow).toBe(120)
    expect(t.netTreasury).toBe(-120)
  })
})
