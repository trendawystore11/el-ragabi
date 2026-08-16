// =============================================================================
// سيناريوهات الشحن المباشر والمختلط — مختبر سيناريوهات المحاسبة
// -----------------------------------------------------------------------------
// الشحن المباشر يسجّل شحنة توريد على المورد دون لمس مخزن الطرف الثالث،
// ومرجوعه يجعل البضاعة مخزوناً، وإلغاؤه لا يلمس المورد (لا شحنة سُجّلت أصلاً)،
// والطلبات المختلطة (مباشر + مخزن) تجمع شحنة ومديونية عجز معاً.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { createOrder, updateOrderStatus } from '@/domain/orders/orderRepository'
import { freshSystem, seedProduct, seedSupplier, STORAGE_KEYS } from './helpers'
import {
  expectSupplierConsistent, expectOrderMoneyConsistent, expectStockTies,
} from './helpers'
import { item, customerInfo } from './helpers'

describe('سيناريو شحن مباشر 1 — شحنة توريد بلا مساس بمخزن الطرف الثالث', () => {
  it('المخزن كما هو والمديونية تتكون والدفتر يغلق', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 })],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })],
    })

    const order = await createOrder({
      customerInfo: customerInfo({ phone: '01012345005' }),
      items: [item({ quantity: 3, purchasePrice: 100 })],
      downPayment: 0,
      status: 'delivered',
      directShipping: true,
    }, repo)

    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 10)
    expect(order.items[0].consumed).toBe(0)
    const persisted = db.getCollection(STORAGE_KEYS.ORDERS)[0]
    expect(persisted.supplierShipments).toHaveLength(1)
    expect(persisted.supplierShipments[0]).toMatchObject({ units: 3, amount: 300 })

    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ totalPurchases: 300, paid: 0, remainingBalance: 300 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))
    expect(db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS).some(x => x.type === 'شحنة توريد' && x.debit === 300)).toBe(true)
    db.getCollection(STORAGE_KEYS.ORDERS).forEach(expectOrderMoneyConsistent)
  })
})

describe('سيناريو شحن مباشر 2 — مرتجع الشحن المباشر يجعل البضاعة مخزوناً ويُبقي الدَّين', () => {
  it('مخزن +3 والدَّين للمورد يبقى كما هو', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 })],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })],
    })
    const order = await createOrder({ customerInfo: customerInfo({ phone: '01012345006' }), items: [item({ quantity: 3, purchasePrice: 100 })], downPayment: 0, status: 'delivered', directShipping: true }, repo)

    await updateOrderStatus(order.id, 'returned', 0, 0, repo)

    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 13)
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ totalPurchases: 300, paid: 0, remainingBalance: 300 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0]).toMatchObject({ status: 'returned', remainingBalance: 0 })
  })
})

describe('سيناريو شحن مباشر 3 — إلغاء طلب «جديد» لا يلمس المورد', () => {
  it('لا شحنة سُجّلت في المرحلة الجديدة فلا يوجد ما يُعكس', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 })],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })],
    })
    const order = await createOrder({ customerInfo: customerInfo({ phone: '01012345007' }), items: [item({ quantity: 3, purchasePrice: 100 })], downPayment: 0, status: 'new', directShipping: true }, repo)

    await updateOrderStatus(order.id, 'cancelled', 0, 0, repo)

    expectStockTies(db.getCollection(STORAGE_KEYS.PRODUCTS)[0], 10)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]).toMatchObject({ totalPurchases: 0, paid: 0, remainingBalance: 0 })
    expect(db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)).toHaveLength(0)
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0]).toMatchObject({ status: 'cancelled', remainingBalance: 0 })
  })
})

describe('سيناريو شحن مباشر 4 — طلب مختلط: شحنة + عجز معاً ثم مرتجع كامل', () => {
  it('المسار المختلط يحسب المورد 750، والمرتجع يلغي العجز ويستعيد المخزونات', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [
        seedProduct({ id: 'PRD1', name: 'منتج أ', stock: 10, purchasePrice: 100, sellingPrice: 250 }),
        seedProduct({ id: 'PRD2', name: 'منتج ب', stock: 2, purchasePrice: 150, sellingPrice: 300 }),
      ],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })],
    })

    const order = await createOrder({
      customerInfo: customerInfo({ phone: '01012345008' }),
      items: [
        item({ productId: 'PRD1', productName: 'منتج أ', quantity: 3, purchasePrice: 100, isDirectShip: true }),
        item({ productId: 'PRD2', productName: 'منتج ب', quantity: 5, purchasePrice: 150 }),
      ],
      downPayment: 0,
      status: 'delivered',
    }, repo)

    const products = db.getCollection(STORAGE_KEYS.PRODUCTS)
    expectStockTies(products.find(p => p.id === 'PRD1'), 10)
    expectStockTies(products.find(p => p.id === 'PRD2'), 0)

    const persisted = db.getCollection(STORAGE_KEYS.ORDERS)[0]
    expect(persisted.supplierShipments).toHaveLength(1)
    expect(persisted.supplierDeficits).toHaveLength(1)
    expect(persisted.supplierDeficits[0]).toMatchObject({ units: 3, amount: 450 })

    let supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier).toMatchObject({ totalPurchases: 750, paid: 0, remainingBalance: 750 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))

    await updateOrderStatus(order.id, 'returned', 0, 0, repo)

    products.forEach(p => {
      expect(p.id === 'PRD1' ? expectStockTies(p, 13) : expectStockTies(p, 2))
    })
    supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    // العجز أُلغي (450) والشحنة المباشرة بقيت (300) لأن البضاعة أصبحت مخزوناً
    expect(supplier).toMatchObject({ totalPurchases: 300, paid: 0, remainingBalance: 300 })
    expectSupplierConsistent(supplier, db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS))
    expect(db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS).some(x => x.type === 'إلغاء مديونية عجز' && x.credit === 450)).toBe(true)
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0]).toMatchObject({ status: 'returned', remainingBalance: 0 })
    db.getCollection(STORAGE_KEYS.ORDERS).forEach(expectOrderMoneyConsistent)
  })
})
