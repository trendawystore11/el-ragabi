// =============================================================================
// اختبارات تعديل/حذف/عكس قيود الدفعات + تعديل المديونية يدوياً — V3.63
// -----------------------------------------------------------------------------
// تغطية: عكس أثر الدفعة على أرصدة العميل/المورد وعلى تخصيص الطلبات، حذف القيود،
// إعادة إنشاء القيد بنفس المعرّف عند التعديل، حجب الدفعات المرتبطة بفاتورة،
// والتعديل المباشر لحقول المديونية.
// =============================================================================
import { describe, it, expect } from 'vitest'
import {
  createPaymentRecord,
  reversePaymentRecord,
  deletePaymentRecord,
  updatePaymentRecord,
} from '@/domain/accounting/payments'
import { adjustCustomerDebt } from '@/domain/customers/customers'
import { adjustSupplierDebt } from '@/domain/suppliers/suppliers'
import { freshSystem, seedCustomer, seedSupplier, STORAGE_KEYS } from '../helpers/fakeRepo'

function customerWithOrder(overrides = {}) {
  return freshSystem({
    [STORAGE_KEYS.CUSTOMERS]: [seedCustomer({ id: 'CUST1', totalPurchases: 1000, paid: 0, remainingBalance: 1000, ...overrides })],
    [STORAGE_KEYS.ORDERS]: [
      { id: 'ORD1', customerId: 'CUST1', status: 'delivered', totalAmount: 1000, downPayment: 0, remainingBalance: 1000, createdAt: '2026-08-01T10:00:00' },
    ],
  })
}

describe('deletePaymentRecord — عكس أثر دفعة عميل وحذفها', () => {
  it('يعيد رصيد العميل ويُلغي تخصيص الطلب ويحذف القيد', async () => {
    const { db, repo } = customerWithOrder()
    const pay = createPaymentRecord({ entityType: 'customer', entityId: 'CUST1', entityName: 'عميل', amount: 400, date: '2026-08-10' }, repo)

    let customer = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customer).toMatchObject({ paid: 400, remainingBalance: 600 })
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0]).toMatchObject({ downPayment: 400, remainingBalance: 600, paidInFull: false })

    await deletePaymentRecord(pay.id, repo)

    customer = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customer).toMatchObject({ paid: 0, remainingBalance: 1000 })
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0]).toMatchObject({ downPayment: 0, remainingBalance: 1000, paidInFull: false })
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS)).toHaveLength(0)
  })
})

describe('reversePaymentRecord — حجب الدفعات المرتبطة بفاتورة', () => {
  it('يرفض عكس قيد يحمل refOrderId', async () => {
    const { repo } = freshSystem({
      [STORAGE_KEYS.PAYMENTS]: [
        { id: 'PAY-ORD', entityType: 'customer', entityId: 'CUST1', entityName: 'عميل', amount: 200, refOrderId: 'ORD1', cycleKey: 'deposit' },
      ],
    })
    expect(() => reversePaymentRecord('PAY-ORD', repo)).toThrow(/مرتبطة بفاتورة/)
    await expect(updatePaymentRecord('PAY-ORD', { amount: 300 }, repo)).rejects.toThrow(/مرتبطة بفاتورة/)
  })
})

describe('updatePaymentRecord — تعديل مورّد مع عكس الأثر القديم', () => {
  it('يُعيد إنشاء القيد بنفس المعرّف وتاريخ الإنشاء ويصحّح الرصيد', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', totalPurchases: 1000, paid: 0 })],
    })
    const pay = createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد', amount: 300, date: '2026-08-10' }, repo)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]).toMatchObject({ paid: 300, remainingBalance: 700 })
    expect(db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)).toHaveLength(1)

    const created = await updatePaymentRecord(pay.id, { amount: 500, notes: 'تعديل المبلغ' }, repo)

    expect(created.id).toBe(pay.id)
    expect(created.createdAt).toBe(pay.createdAt)
    expect(created.amount).toBe(500)
    expect(created.notes).toBe('تعديل المبلغ')
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS)).toHaveLength(1)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]).toMatchObject({ paid: 500, remainingBalance: 500 })
    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns).toHaveLength(1)
    expect(txns[0]).toMatchObject({ refId: pay.id, credit: 500 })
  })

  it('يعكس ويحذف قيد دفتر المورد القديم قبل تطبيق الجديد', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', totalPurchases: 1000, paid: 0 })],
    })
    const pay = createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد', amount: 300, date: '2026-08-10' }, repo)
    await deletePaymentRecord(pay.id, repo)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]).toMatchObject({ paid: 0, remainingBalance: 1000 })
    expect(db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)).toHaveLength(0)
  })
})

describe('adjustCustomerDebt — تعديل مباشر للمسدد والمتبقي', () => {
  it('يكتب فوق الرصيدين دون المساس بالطلبات', () => {
    const { db, repo } = customerWithOrder()
    adjustCustomerDebt('CUST1', { paid: 250, remainingBalance: 750 }, repo)
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]).toMatchObject({ paid: 250, remainingBalance: 750 })
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0]).toMatchObject({ downPayment: 0, remainingBalance: 1000 })
  })

  it('يرفض الرصيد السالب للعميل ويُطَبّق صفراً', () => {
    const { db, repo } = customerWithOrder()
    adjustCustomerDebt('CUST1', { paid: 100, remainingBalance: -50 }, repo)
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0].remainingBalance).toBe(0)
  })
})

describe('adjustSupplierDebt — تعديل مباشر مع السماح برصيد سالب', () => {
  it('يسمح برصيد سالب (مستحق لنا من المورد)', () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', totalPurchases: 1000, paid: 0 })] })
    adjustSupplierDebt('SUP1', { paid: 1200, remainingBalance: -200 }, repo)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]).toMatchObject({ paid: 1200, remainingBalance: -200 })
  })
})
