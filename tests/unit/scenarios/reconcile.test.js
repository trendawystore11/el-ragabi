// =============================================================================
// سيناريوهات إعادة الحساب والمطابقة — مختبر سيناريوهات المحاسبة
// -----------------------------------------------------------------------------
// محركات المطابقة غير المدمرة: recalculateTotals لا يضاعف القيود ولا يغير
// الأرصدة المتسقة (idempotent)، وrecalculateAllCustomerBalances يعيد بناء
// رصيد العميل من المصادر ويترك الحقول السليمة كما هي.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { createOrder } from '@/domain/orders/orderRepository'
import { createProduct } from '@/domain/inventory/products'
import { createSupplierReturn, recalculateTotals } from '@/domain/inventory/supplierReturns'
import { recalculateAllCustomerBalances } from '@/domain/customers/customers'
import { createPaymentRecord } from '@/domain/accounting/payments'
import {
  seedStore, item, customerInfo, STORAGE_KEYS,
  expectSupplierConsistent, expectCustomerLedgerTies,
} from './helpers'

describe('سيناريو مطابقة 1 — recalculateTotals idempotent بعد دورة مورد كاملة', () => {
  it('لا يضاعف قيداً ولا يحرّك رصيداً متسقاً', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD0', code: 'FAB', stock: 300, purchasePrice: 100, sellingPrice: 150 } })

    const prod = createProduct({ name: 'قماش', code: 'FAB-001', purchasePrice: 100, sellingPrice: 150, stock: 300, supplierId: 'SUP1', supplierName: 'مورد أ' }, repo)
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 15000, date: '2026-08-02', paymentMethod: 'cash', notes: 'تسديد جزئي' }, repo)
    await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 300, unitCost: 100 }], refundType: 'cash' }, repo)

    expect(recalculateTotals(repo)).toBe(0)
    expect(recalculateTotals(repo)).toBe(0)

    expectSupplierConsistent(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0], db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS).filter(p => p.type === 'supplierCashRefund')).toHaveLength(1)
  })
})

describe('سيناريو مطابقة 2 — recalculateAllCustomerBalances بعد دورة بيع', () => {
  it('يعيد البناء من المصادر ويترك الحقول السليمة بلا تغيير', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })

    await createOrder({ customerInfo: customerInfo({ phone: '01012345012' }), items: [item({ quantity: 2 })], downPayment: 500, status: 'delivered' }, repo)
    const before = { ...db.getCollection(STORAGE_KEYS.CUSTOMERS)[0] }

    recalculateAllCustomerBalances(repo)

    const after = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(after.paid).toBe(before.paid)
    expect(after.totalPurchases).toBe(before.totalPurchases)
    expect(after.remainingBalance).toBe(before.remainingBalance)
    expect(after.ordersCount).toBe(before.ordersCount)
    expect(after).toMatchObject({ paid: 500, totalPurchases: 500, remainingBalance: 0 })
    expectCustomerLedgerTies(after, db.getCollection(STORAGE_KEYS.ORDERS), db.getCollection(STORAGE_KEYS.PAYMENTS))
  })
})
