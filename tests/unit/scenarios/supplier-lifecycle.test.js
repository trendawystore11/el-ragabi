// =============================================================================
// سيناريوهات دورة حياة المورد — مختبر سيناريوهات المحاسبة
// -----------------------------------------------------------------------------
// تحاكي كل مسار يمس دفتر المورد ومديونيته: تسجيل منتج ومخزون، شحنة توريد
// (بمصاريف تُوزَّع على التكلفة دون المساس بالمديونية)، تسديد دفعات، مرتجع
// تخفيض دين، مرتجع كاش، عجز مخزون من فاتورة ثم إلغاؤه، وتحصيل نقدية من مورد
// مدين لنا (رصيد سالب) حتى تصفير. الثابت الحديدي بعد كل خطوة:
//   رصيد المورد = صافي دفتره (مدين − دائن) = مشترياته − مدفوعه.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { createProduct, addStockShipment } from '@/domain/inventory/products'
import { createSupplierReturn } from '@/domain/inventory/supplierReturns'
import { createPaymentRecord } from '@/domain/accounting/payments'
import { createOrder, updateOrderStatus } from '@/domain/orders/orderRepository'
import {
  seedStore, item, customerInfo, STORAGE_KEYS,
  expectSupplierConsistent, expectOrderMoneyConsistent, expectStockTies, treasuryReport,
} from './helpers'

describe('سيناريو مورد أ — شحنة + تسديد + مرتجع كاش يصفّر المديونية ويسترد الفائض', () => {
  it('دفتر المورد والرصيد والخزينة يتطابقون في كل خطوة', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD0', code: 'FAB', stock: 300, purchasePrice: 100, sellingPrice: 150 } })

    // 1) تسجيل منتج بمخزون 300 من المورد → مديونية 30,000
    const prod = createProduct({ name: 'قماش', code: 'FAB-001', purchasePrice: 100, sellingPrice: 150, stock: 300, supplierId: 'SUP1', supplierName: 'مورد أ' }, repo)
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 300)
    let supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ totalPurchases: 30000, paid: 0, remainingBalance: 30000 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    // 2) تسديد دفعة 15,000 → مديونية 15,000
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 15000, date: '2026-08-02', paymentMethod: 'cash', notes: 'تسديد جزئي' }, repo)
    supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ totalPurchases: 30000, paid: 15000, remainingBalance: 15000 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    // 3) مرتجع كاش لكامل الكمية (30,000) — خصم المدين 15,000 + استرداد فائض 15,000
    const rec = await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 300, unitCost: 100 }], refundType: 'cash' }, repo)
    expect(rec).toMatchObject({ debtOffset: 15000, cashRefund: 15000, excessAsCredit: 0 })
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 0)
    supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ totalPurchases: 0, paid: 0, remainingBalance: 0 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    // 4) تحقق نهائي: الفائض المسترد وارد خزينة (treasuryInflow)، ودفعُ المورد 15,000
    //    الذي سبق وأن خرج يُستردّ كاملاً → صافي الخزينة صفر
    const t = treasuryReport(db)
    expect(t).toMatchObject({ treasuryInflow: 15000, totalInflow: 0, totalSupplierPayments: 15000, netTreasury: 0 })
    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(x => x.type === 'مرتجع مشتريات' && x.credit === 30000)).toBe(true)
    expect(txns.some(x => x.type === 'مرتجع نقدي' && x.debit === 15000)).toBe(true)
  })
})

describe('سيناريو مورد ب — رصيد سالب (المورد مدين لنا) + تحصيل على دفعتين حتى التصفير', () => {
  it('التحصيل يرفع الرصيد نحو الصفر والدفتر يتبع صافي الحركات', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD0', code: 'FAB', stock: 300, purchasePrice: 100, sellingPrice: 150 } })

    // 1) مديونية 30,000 ثم تسديد 20,000 → متبقٍّ 10,000
    const prod = createProduct({ name: 'قماش', code: 'FAB-001', purchasePrice: 100, sellingPrice: 150, stock: 300, supplierId: 'SUP1', supplierName: 'مورد أ' }, repo)
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 20000, date: '2026-08-02', paymentMethod: 'cash', notes: 'تسديد جزئي' }, repo)
    let supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.remainingBalance).toBe(10000)
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    // 2) مرتجع تخفيض دين 30,000 → الفائض 20,000 رصيداً دائناً لصالحنا (−20,000)
    await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 300, unitCost: 100 }], refundType: 'debt' }, repo)
    supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ totalPurchases: 0, paid: 20000, remainingBalance: -20000 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    // 3) تحصيل 8,000 من المورد المدين لنا → −12,000
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 8000, date: '2026-08-05', paymentMethod: 'cash', notes: 'تحصيل جزء من المبلغ المستحق لنا', isCollection: true }, repo)
    supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ paid: 12000, remainingBalance: -12000 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    // 4) تحصيل الباقي 12,000 → تصفير كامل
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 12000, date: '2026-08-06', paymentMethod: 'cash', notes: 'تحصيل كامل المبلغ المستحق لنا', isCollection: true }, repo)
    supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ paid: 0, remainingBalance: 0 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    // 5) تحقق نهائي: التحصيلات واردة خزينة (20,000) والدفع المدفوع للمورد خرج 20,000
    const t = treasuryReport(db)
    expect(t).toMatchObject({ totalInflow: 20000, totalSupplierPayments: 20000, netTreasury: 0 })
  })
})

describe('سيناريو مورد ج — شحنة توريد بمصاريف تُوزَّع على التكلفة دون مساس بالمديونية', () => {
  it('addStockShipment يرفع المخزون والمديونية بقيمة البضاعة فقط', () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })

    addStockShipment('PRD1', 100, 'SUP1', 120, 'توريد دفعة جديدة', { shippingCost: 500, suppliesCost: 0 }, repo)

    // المخزون 110 وتكلفة الوحدة المتوسطة (10×100 + 100×120 + 500)/110 = 122.73
    const product = db.getCollection(STORAGE_KEYS.PRODUCTS)[0]
    expectStockTies(product, 110)
    expect(product.purchasePrice).toBe(122.73)
    expect(product.shipmentExtrasTotal).toBe(500)

    // المديونية زادت 12,000 فقط (قيمة البضاعة) لا المصاريف
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ totalPurchases: 12000, paid: 0, remainingBalance: 12000 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))
    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(x => x.type === 'شحنة توريد' && x.debit === 12000)).toBe(true)
  })
})

describe('سيناريو مورد د — عجز مخزون من فاتورة ثم إرجاع الفاتورة يعكس العجز', () => {
  it('إرجاع الفاتورة يلغي مديونية العجز تماماً ويعيد المخزون المستهلك فقط', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 2, purchasePrice: 150, sellingPrice: 300 } })

    // 1) بيع 5 والمخزن 2 → عجز 3 = 450 مديونية للمورد
    const order = await createOrder({ customerInfo: customerInfo({ phone: '01066677788' }), items: [item({ quantity: 5, sellingPrice: 300, purchasePrice: 150 })], downPayment: 0, status: 'delivered' }, repo)
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 0)
    let supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ totalPurchases: 450, remainingBalance: 450 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    // 2) إرجاع الفاتورة → عكس العجز + إعادة الوحدات المستهلكة (2 فقط)
    await updateOrderStatus(order.id, 'returned', 0, 0, repo)
    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 2)
    supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ totalPurchases: 0, paid: 0, remainingBalance: 0 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0]).toMatchObject({ status: 'returned', remainingBalance: 0 })
    db.getCollection(STORAGE_KEYS.ORDERS).forEach(expectOrderMoneyConsistent)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS).some(x => x.type === 'إلغاء مديونية عجز' && x.credit === 450)).toBe(true)
  })
})
